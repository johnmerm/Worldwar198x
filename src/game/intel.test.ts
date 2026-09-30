import { describe, expect, it } from 'vitest';
import { MINUTEMAN_III, flySolution, solveFiringSolution } from '../physics';
import { evaluateSensors } from '../sensors';
import { IntelFeed, type IntelPacket } from './intel';
import { type ClockState, retime, worldTime } from '../net/clock';

const P = (name: string, lat: number, lon: number) => ({ name, lat, lon });

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('intel feed: Wisconsin -> Moscow as the Soviet player sees it', () => {
  const sol = solveFiringSolution(MINUTEMAN_III, P('Rural Wisconsin', 44.5, -90), [
    P('Moscow', 55.7558, 37.6173),
    P('Tula', 54.19, 37.62),
  ]);
  const sim = flySolution(sol, seeded(7));
  const launchMs = Date.UTC(2026, 8, 26, 0);
  const report = evaluateSensors(sim, MINUTEMAN_III, launchMs);
  const end = Math.max(...sim.rvs.map((r) => r.impact!.t)) + 60;

  const stepped = (step: number) => {
    const feed = new IntelFeed(report, sim, launchMs, MINUTEMAN_III.yieldKt, seeded(1));
    const packets: { elapsed: number; p: IntelPacket }[] = [];
    for (let e = 0; e <= end; e += step) {
      const p = feed.poll(e);
      if (p) packets.push({ elapsed: e, p });
    }
    return { feed, packets };
  };
  const { feed, packets } = stepped(7);

  it('reports nothing before the sensors have seen anything', () => {
    const first = packets[0];
    expect(first.elapsed).toBeGreaterThanOrEqual(report.firstWarningT!);
  });

  it('never reports anything ahead of the world clock', () => {
    for (const { elapsed, p } of packets) {
      const limit = launchMs + elapsed * 1000;
      for (const ev of p.events) expect(ev.t).toBeLessThanOrEqual(limit);
      for (const d of p.detonations) expect(d.t).toBeLessThanOrEqual(limit);
      for (const tr of p.tracks) for (const pt of tr.points) expect(pt.t).toBeLessThanOrEqual(limit);
    }
  });

  it('leaks no ground truth: no object names, weapon or targets', () => {
    const json = JSON.stringify(packets.map((x) => x.p));
    // ('Moscow' would match the defender's own Moscow ABM radar.)
    for (const word of ['BOOSTER', 'BUS', 'RV-', 'DCY-', 'CHF-', 'STAGE', 'Tula', 'Minuteman', 'MM-III', 'Wisconsin']) {
      expect(json).not.toContain(word);
    }
  });

  it('shows RVs and decoys as unknown until drag sorts them', () => {
    const rvTracks = new Set(
      packets.flatMap((x) => x.p.events).filter((e) => e.kind === 'rv-identified').map((e) => e.track),
    );
    expect(rvTracks.size).toBe(2);
    for (const id of rvTracks) {
      const points = packets.flatMap((x) => x.p.tracks).filter((t) => t.id === id).flatMap((t) => t.points);
      const early = points.filter((pt) => pt.cls === 'unknown');
      const late = points.filter((pt) => pt.cls === 'rv');
      expect(early.length).toBeGreaterThan(0);
      expect(late.length).toBeGreaterThan(0);
      expect(Math.max(...early.map((p) => p.t))).toBeLessThan(Math.min(...late.map((p) => p.t)));
    }
  });

  it('reports each detonation once, when it happens', () => {
    const dets = packets.flatMap((x) => x.p.detonations);
    expect(dets).toHaveLength(2);
    expect(feed.done).toBe(true);
  });

  it('delivers the same picture however often it is polled', () => {
    const flat = (ps: { p: IntelPacket }[]) =>
      ps
        .flatMap((x) => x.p.tracks.flatMap((t) => t.points.map((pt) => `${t.id}@${pt.t}:${pt.cls}`)))
        .sort();
    expect(flat(stepped(0.5).packets)).toEqual(flat(packets));
  });
});

describe('world clock', () => {
  const c: ClockState = { simMs: 1000, wallMs: 0, rate: 30, running: true };

  it('runs at the warp rate and stops when paused', () => {
    expect(worldTime(c, 2000)).toBe(61_000);
    const paused = retime(c, 2000, { running: false });
    expect(worldTime(paused, 99_000)).toBe(61_000);
  });

  it('keeps time continuous across a warp change', () => {
    const slow = retime(c, 2000, { rate: 1 });
    expect(worldTime(slow, 2000)).toBe(61_000);
    expect(worldTime(slow, 3000)).toBe(62_000);
  });
});
