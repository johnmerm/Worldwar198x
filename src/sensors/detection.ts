import type { MissileSpec } from '../physics/missiles';
import type { SimResult, TrajectorySample } from '../physics/trajectory';
import { type Vec3, dot, norm, sub } from '../physics/vec3';
import { ecefToGeodetic, enuBasis, geodeticToEcef } from '../physics/wgs84';
import { lineOfSight, orbitEcef, spaceBackground } from './orbits';
import { GEO_RADIUS, RADARS, type Radar, SATELLITES, type Satellite, type Side } from './sites';

export type ObjectKind = 'booster' | 'bus' | 'stage' | 'rv' | 'decoy' | 'chaff';

/**
 * What the defender can say about an object.
 * - 'unknown': an RV-sized midcourse object; RV or decoy cannot be told apart
 * - 'rv' / 'decoy': sorted by atmospheric drag below DISCRIMINATION_ALT
 * - others: obvious from the size of the radar return
 */
export type TrackClass = 'unknown' | 'rv' | 'decoy' | 'chaff' | 'booster' | 'bus' | 'stage';

export interface TrackedObject {
  id: string;
  kind: ObjectKind;
  rv?: number;
  rcs: number;
  samples: TrajectorySample[];
  /** seen[i]: some radar holds this object at samples[i] */
  seen: boolean[];
  firstSeen: { t: number; by: string } | null;
  /** When the defender could classify it (see TrackClass) */
  classifiedT: number | null;
  chaff?: { r0: number; rate: number };
}

export interface SensorEvent {
  t: number;
  sensor: string;
  kind: 'ir-launch' | 'radar-contact' | 'rv-identified' | 'decoy-identified';
  text: string;
  objectId?: string;
  /** Where an IR detection places the launch */
  at?: Vec3;
}

export interface SensorReport {
  observer: Side;
  objects: TrackedObject[];
  events: SensorEvent[];
  /** First warning of any kind / first radar track [s after launch] */
  firstWarningT: number | null;
  firstRadarT: number | null;
}

/** Below this altitude drag separates heavy RVs from light decoys. */
export const DISCRIMINATION_ALT = 80_000;
/** IR plumes are hidden by cloud and haze until the missile climbs above this. */
const PLUME_MIN_ALT = 12_000;
/** Consecutive IR looks needed before a launch is reported (DSP spun at ~6 rpm). */
const IR_CONFIRM_S = 10;

export const opponent = (side: Side): Side => (side === 'USA' ? 'USSR' : 'USA');

export function satelliteEcef(sat: Satellite, unixMs: number): Vec3 {
  if (sat.orbit) return orbitEcef(sat.orbit, unixMs);
  const lon = ((sat.geoLon ?? 0) * Math.PI) / 180;
  return [GEO_RADIUS * Math.cos(lon), GEO_RADIUS * Math.sin(lon), 0];
}

/** Can this satellite see a booster plume at `p` right now? */
export function satelliteSeesPlume(sat: Satellite, satPos: Vec3, p: Vec3): boolean {
  if (!lineOfSight(satPos, p)) return false;
  return sat.sensor === 'look-down' || spaceBackground(satPos, p);
}

/** Detection range of a radar against a target of the given RCS [m]. */
export const radarRange = (radar: Radar, rcs: number) => radar.range1m2 * Math.pow(rcs, 0.25);

const radarGeometry = RADARS.map((r) => ({ radar: r, pos: geodeticToEcef(r.lat, r.lon, 0), enu: enuBasis(r.lat, r.lon) }));

/** Is `p` inside this radar's coverage (horizon, sector, range for `rcs`)? */
export function radarSees(radar: Radar, p: Vec3, rcs: number): boolean {
  const g = radarGeometry.find((x) => x.radar === radar)!;
  const rel = sub(p, g.pos);
  const range = norm(rel);
  if (range > radarRange(radar, rcs)) return false;
  const up = dot(rel, g.enu.up);
  if (Math.asin(up / range) < (radar.minElevation * Math.PI) / 180) return false;
  if (radar.halfWidth >= 180) return true;
  const az = (Math.atan2(dot(rel, g.enu.east), dot(rel, g.enu.north)) * 180) / Math.PI;
  const off = Math.abs(((az - radar.boresight + 540) % 360) - 180);
  return off <= radar.halfWidth;
}

/** Linear interpolation of an object's position at time t (null outside its flight). */
function positionAt(samples: TrajectorySample[], t: number): Vec3 | null {
  if (!samples.length || t < samples[0].t || t > samples[samples.length - 1].t) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return [a.ecef[0] + (b.ecef[0] - a.ecef[0]) * f, a.ecef[1] + (b.ecef[1] - a.ecef[1]) * f, a.ecef[2] + (b.ecef[2] - a.ecef[2]) * f];
}

export const chaffRadius = (o: { chaff?: { r0: number; rate: number }; samples: TrajectorySample[] }, t: number) =>
  o.chaff ? o.chaff.r0 + o.chaff.rate * (t - o.samples[0].t) : 0;

/** Collect every radar-visible object of a flight with its RCS. */
function objectsOf(sim: SimResult, spec: MissileSpec): TrackedObject[] {
  const make = (id: string, kind: ObjectKind, rcs: number, samples: TrajectorySample[], rv?: number, chaff?: TrackedObject['chaff']): TrackedObject => ({
    id,
    kind,
    rv,
    rcs,
    samples,
    seen: new Array(samples.length).fill(false),
    firstSeen: null,
    classifiedT: null,
    chaff,
  });
  const out = [make('BOOSTER', 'booster', spec.rcs.booster, sim.booster)];
  if (sim.bus.length > 1) out.push(make('BUS', 'bus', spec.rcs.bus, sim.bus));
  sim.rvs.forEach((rv) => {
    if (rv.released) out.push(make(`RV-${String.fromCharCode(65 + rv.index)}`, 'rv', spec.rcs.rv, rv.samples, rv.index));
  });
  for (const o of sim.objects) {
    const rcs = o.kind === 'stage' ? spec.rcs.stage : o.kind === 'decoy' ? spec.rcs.decoy : spec.rcs.chaff;
    out.push(make(o.id, o.kind, rcs, o.samples, o.rv, o.chaff));
  }
  return out;
}

const fmtLatLon = (p: Vec3) => {
  const g = ecefToGeodetic(p);
  return `${Math.abs(g.lat).toFixed(1)}°${g.lat >= 0 ? 'N' : 'S'} ${Math.abs(g.lon).toFixed(1)}°${g.lon >= 0 ? 'E' : 'W'}`;
};

/**
 * Run the defender's sensor network over a whole flight.
 *
 * - Early-warning satellites look for the booster plume (boost phase only).
 *   DSP looks straight down; Oko needs the plume silhouetted against space.
 * - Radars track any object above their horizon, inside their sector and
 *   within the range its radar cross-section allows. Objects inside a
 *   blooming chaff cloud are hidden; the cloud itself shows as clutter.
 * - RVs and decoys look identical in vacuum. Only once they are tracked below
 *   DISCRIMINATION_ALT does drag give away which is which.
 */
export function evaluateSensors(sim: SimResult, spec: MissileSpec, launchUnixMs: number): SensorReport {
  const observer = opponent(spec.side);
  const objects = objectsOf(sim, spec);
  const events: SensorEvent[] = [];
  const radars = RADARS.filter((r) => r.side === observer);
  const sats = SATELLITES.filter((s) => s.side === observer);
  const clouds = objects.filter((o) => o.kind === 'chaff');

  // --- Infrared launch detection -----------------------------------------
  let firstIr: number | null = null;
  for (const sat of sats) {
    let firstLook: number | null = null;
    for (const s of sim.booster) {
      if (s.alt < PLUME_MIN_ALT) continue;
      const satPos = satelliteEcef(sat, launchUnixMs + s.t * 1000);
      if (!satelliteSeesPlume(sat, satPos, s.ecef)) {
        firstLook = null;
        continue;
      }
      firstLook ??= s.t;
      if (s.t - firstLook >= IR_CONFIRM_S) {
        events.push({
          t: s.t,
          sensor: sat.name,
          kind: 'ir-launch',
          text: `IR launch detection near ${fmtLatLon(sim.booster[0].ecef)}`,
          at: sim.booster[0].ecef,
        });
        firstIr = firstIr === null ? s.t : Math.min(firstIr, s.t);
        break;
      }
    }
  }

  // --- Radar tracking -----------------------------------------------------
  const contact = new Map<string, number>();
  for (const o of objects) {
    o.samples.forEach((s, i) => {
      const masked =
        o.kind !== 'chaff' &&
        clouds.some((c) => {
          const cp = positionAt(c.samples, s.t);
          return cp !== null && norm(sub(s.ecef, cp)) < chaffRadius(c, s.t);
        });
      if (masked) return;
      const by = radars.find((r) => radarSees(r, s.ecef, o.rcs));
      if (!by) return;
      o.seen[i] = true;
      if (!o.firstSeen) o.firstSeen = { t: s.t, by: by.name };
      if (!contact.has(by.name) || s.t < contact.get(by.name)!) contact.set(by.name, s.t);
      if (o.classifiedT === null) {
        const obvious = o.kind !== 'rv' && o.kind !== 'decoy';
        if (obvious || s.alt < DISCRIMINATION_ALT) {
          o.classifiedT = s.t;
          if (o.kind === 'rv' || o.kind === 'decoy') {
            events.push({
              t: s.t,
              sensor: by.name,
              kind: o.kind === 'rv' ? 'rv-identified' : 'decoy-identified',
              text: o.kind === 'rv' ? `${o.id} identified as re-entry vehicle` : `${o.id} identified as decoy`,
              objectId: o.id,
            });
          }
        }
      }
    });
  }
  for (const [name, t] of contact) {
    events.push({ t, sensor: name, kind: 'radar-contact', text: 'radar contact — incoming raid' });
  }

  events.sort((a, b) => a.t - b.t);
  const firstRadarT = contact.size ? Math.min(...contact.values()) : null;
  const warnings = [firstIr, firstRadarT].filter((x): x is number => x !== null);
  return {
    observer,
    objects,
    events,
    firstWarningT: warnings.length ? Math.min(...warnings) : null,
    firstRadarT,
  };
}

/** What class the defender assigns to an object at time t (null if not yet tracked). */
export function trackClassAt(o: TrackedObject, t: number): TrackClass | null {
  if (!o.firstSeen || t < o.firstSeen.t) return null;
  if (o.classifiedT !== null && t >= o.classifiedT) return o.kind;
  return 'unknown';
}
