// What one player learns about the other's missiles: only what their own
// sensors report, only once it has happened, and never the ground truth
// (weapon, launch site, targets, which object is which).

import type { SimResult, Vec3 } from '../physics';
import { type SensorEvent, type SensorReport, type TrackClass, chaffRadius, trackClassAt } from '../sensors';

export interface TrackPoint {
  /** Unix time [ms] */
  t: number;
  ecef: Vec3;
  /** How the defender classifies the object at this moment */
  cls: TrackClass;
  /** Chaff cloud radius [m] */
  radius?: number;
}

export interface TrackUpdate {
  /** Anonymous track number within the raid, e.g. 'T07' */
  id: string;
  points: TrackPoint[];
  /** The track was lost (left coverage, masked, burned up or impacted) at this time [unix ms] */
  lostT?: number;
}

export interface IntelEvent {
  t: number;
  sensor: string;
  kind: SensorEvent['kind'];
  text: string;
  track?: string;
  /** Where an IR detection places the launch */
  at?: Vec3;
}

/** A nuclear detonation: seen by the whole world, not just by sensors. */
export interface Detonation {
  t: number;
  ecef: Vec3;
  yieldKt: number;
}

export interface IntelPacket {
  /** Opaque key grouping the reports of one flight; carries no information itself */
  raid: string;
  events: IntelEvent[];
  tracks: TrackUpdate[];
  detonations: Detonation[];
}

/** Minimum spacing of track points sent to the defender [s]: a radar track update every few seconds. */
export const TRACK_POINT_SPACING = 4;

interface FeedObject {
  track: string;
  o: SensorReport['objects'][number];
  next: number;
  lastSentT: number;
  inRun: boolean;
}

/**
 * Turns one flight's sensor report into the defender's feed. Each `poll`
 * returns what became observable since the previous one, so the defender
 * never holds anything ahead of the world clock.
 */
export class IntelFeed {
  readonly raid: string;
  private objects: FeedObject[];
  private nextEvent = 0;
  private detonations: Detonation[];
  private nextDetonation = 0;

  constructor(
    private report: SensorReport,
    sim: SimResult,
    private launchMs: number,
    yieldKt: number,
    rng: () => number = Math.random,
  ) {
    this.raid = Math.floor(rng() * 2 ** 32).toString(36);
    // Shuffle so track numbers say nothing about what the object is.
    const order = report.objects.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const trackOf = new Map(order.map((idx, n) => [idx, `T${String(n + 1).padStart(2, '0')}`]));
    this.objects = report.objects.map((o, i) => ({ track: trackOf.get(i)!, o, next: 0, lastSentT: -Infinity, inRun: false }));
    this.detonations = sim.rvs
      .filter((rv) => rv.released && rv.impact)
      .map((rv) => ({ t: this.ms(rv.impact!.t), ecef: rv.impact!.ecef, yieldKt }))
      .sort((a, b) => a.t - b.t);
  }

  private ms(t: number) {
    return this.launchMs + t * 1000;
  }

  /** Everything observed up to `elapsed` seconds after launch and not yet reported, or null. */
  poll(elapsed: number): IntelPacket | null {
    const tracks: TrackUpdate[] = [];
    for (const f of this.objects) {
      const { samples, seen } = f.o;
      const update: TrackUpdate = { id: f.track, points: [] };
      while (f.next < samples.length && samples[f.next].t <= elapsed) {
        const i = f.next++;
        const s = samples[i];
        if (seen[i]) {
          const runEnd = i === samples.length - 1 || !seen[i + 1];
          if (!f.inRun || runEnd || s.t - f.lastSentT >= TRACK_POINT_SPACING) {
            update.points.push({
              t: this.ms(s.t),
              ecef: s.ecef,
              cls: trackClassAt(f.o, s.t) ?? 'unknown',
              radius: f.o.chaff ? chaffRadius(f.o, s.t) : undefined,
            });
            f.lastSentT = s.t;
          }
          f.inRun = true;
          if (i === samples.length - 1) {
            update.lostT = this.ms(s.t);
            f.inRun = false;
          }
        } else if (f.inRun) {
          update.lostT = this.ms(samples[i - 1].t);
          f.inRun = false;
        }
      }
      if (update.points.length || update.lostT !== undefined) tracks.push(update);
    }

    const events: IntelEvent[] = [];
    const evs = this.report.events;
    while (this.nextEvent < evs.length && evs[this.nextEvent].t <= elapsed) {
      const ev = evs[this.nextEvent++];
      const track = ev.objectId ? this.objects.find((f) => f.o.id === ev.objectId)?.track : undefined;
      events.push({
        t: this.ms(ev.t),
        sensor: ev.sensor,
        kind: ev.kind,
        text: track ? ev.text.replace(ev.objectId!, track) : ev.text,
        track,
        at: ev.at,
      });
    }

    const detonations: Detonation[] = [];
    while (this.nextDetonation < this.detonations.length && this.detonations[this.nextDetonation].t <= this.ms(elapsed)) {
      detonations.push(this.detonations[this.nextDetonation++]);
    }

    if (!tracks.length && !events.length && !detonations.length) return null;
    return { raid: this.raid, events, tracks, detonations };
  }

  /** Nothing left to report. */
  get done(): boolean {
    return (
      this.nextEvent >= this.report.events.length &&
      this.nextDetonation >= this.detonations.length &&
      this.objects.every((f) => f.next >= f.o.samples.length)
    );
  }
}
