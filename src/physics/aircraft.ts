import { DEG } from './constants';
import { vincentyInverse } from './geodesy';
import type { GeoPoint } from './targeting';
import type { TrajectorySample } from './trajectory';
import { geodeticToEcef } from './wgs84';

export interface BomberSpec {
  id: string;
  name: string;
  short: string;
  side: 'USA' | 'USSR';
  /** True airspeed at cruise [m/s] */
  cruiseSpeed: number;
  /** Cruise altitude [m] */
  cruiseAlt: number;
  /** Time to climb from take-off to cruise altitude [s] */
  climbTime: number;
  /** Unrefuelled one-way range [km] */
  rangeKm: number;
  /** Targets one sortie can visit in turn */
  maxTargets: number;
  /** Radar cross-section [m^2]; large airframes are easy radar targets */
  rcs: number;
}

export const B52H: BomberSpec = {
  id: 'b52',
  name: 'B-52H Stratofortress',
  short: 'B-52',
  side: 'USA',
  cruiseSpeed: 236, // ~850 km/h
  cruiseAlt: 11_000,
  climbTime: 1200,
  rangeKm: 14_000,
  maxTargets: 4,
  rcs: 100,
};

export const TU95: BomberSpec = {
  id: 'tu95',
  name: 'Tu-95 Bear',
  short: 'TU-95',
  side: 'USSR',
  cruiseSpeed: 228, // ~820 km/h
  cruiseAlt: 11_000,
  climbTime: 1200,
  rangeKm: 15_000,
  maxTargets: 2,
  rcs: 100,
};

export const BOMBERS: BomberSpec[] = [B52H, TU95];

export interface BomberFlight {
  samples: TrajectorySample[];
  /** Arrival over each target in turn [s after take-off] */
  legs: { target: GeoPoint; t: number; distance: number }[];
  /** Total route length [m] */
  distance: number;
  /** Route fits within the aircraft's range */
  feasible: boolean;
}

/** Point a fraction `f` of the way along the great circle from a to b. */
function greatCircle(a: GeoPoint, b: GeoPoint, f: number): { lat: number; lon: number } {
  const toVec = (p: GeoPoint) => [Math.cos(p.lat * DEG) * Math.cos(p.lon * DEG), Math.cos(p.lat * DEG) * Math.sin(p.lon * DEG), Math.sin(p.lat * DEG)];
  const va = toVec(a);
  const vb = toVec(b);
  const omega = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  if (omega < 1e-9) return { lat: a.lat, lon: a.lon };
  const ka = Math.sin((1 - f) * omega) / Math.sin(omega);
  const kb = Math.sin(f * omega) / Math.sin(omega);
  const v = [ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]];
  return { lat: Math.asin(v[2]) / DEG, lon: Math.atan2(v[1], v[0]) / DEG };
}

const SAMPLE_DT = 60;

/**
 * A bomber sortie: take off, climb to cruise altitude, then fly great-circle
 * legs through each target in turn at constant cruise speed. Leg lengths use
 * Vincenty distances on the WGS-84 ellipsoid.
 */
export function flyBomber(spec: BomberSpec, base: GeoPoint, targets: GeoPoint[]): BomberFlight {
  const points = [base, ...targets];
  const legs: BomberFlight['legs'] = [];
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const d = vincentyInverse(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon).distance;
    distance += d;
    legs.push({ target: points[i], t: distance / spec.cruiseSpeed, distance: d });
  }

  const samples: TrajectorySample[] = [];
  const total = distance / spec.cruiseSpeed;
  for (let t = 0; ; t = Math.min(total, t + SAMPLE_DT)) {
    // Which leg are we on, and how far along it?
    let travelled = t * spec.cruiseSpeed;
    let leg = 0;
    while (leg < legs.length - 1 && travelled > legs[leg].distance) travelled -= legs[leg++].distance;
    const f = legs.length ? Math.min(1, travelled / legs[leg].distance) : 0;
    const p = legs.length ? greatCircle(points[leg], points[leg + 1], f) : base;
    const alt = spec.cruiseAlt * Math.min(1, t / spec.climbTime);
    samples.push({ t, ecef: geodeticToEcef(p.lat, p.lon, alt), alt, speed: spec.cruiseSpeed, phase: 'cruise' });
    if (t >= total) break;
  }
  return { samples, legs, distance, feasible: distance <= spec.rangeKm * 1000 };
}
