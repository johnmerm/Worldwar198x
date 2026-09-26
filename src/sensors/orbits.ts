import { DEG, MU, RE, RP } from '../physics/constants';
import { type Vec3, dot, norm, rotZ, sub } from '../physics/vec3';

/** Greenwich mean sidereal angle [rad] at a Unix time [ms]. */
export function gmst(unixMs: number): number {
  const d = unixMs / 86_400_000 + 2440587.5 - 2451545.0;
  const deg = (280.46061837 + 360.98564736629 * d) % 360;
  return (deg < 0 ? deg + 360 : deg) * DEG;
}

export interface KeplerOrbit {
  /** Semi-major axis [m] */
  a: number;
  e: number;
  /** Inclination, right ascension of ascending node, argument of perigee [deg] */
  i: number;
  raan: number;
  argp: number;
  /** Mean anomaly at epoch [deg] */
  m0: number;
  epochMs: number;
}

/**
 * Two-body propagation to an inertial (equatorial, equinox-aligned) position.
 * Operational early-warning satellites were station-kept to hold their ground
 * tracks, so perturbation drift is deliberately left out.
 */
export function orbitEci(o: KeplerOrbit, unixMs: number): Vec3 {
  const n = Math.sqrt(MU / o.a ** 3);
  const M = o.m0 * DEG + n * ((unixMs - o.epochMs) / 1000);
  let E = M;
  for (let k = 0; k < 12; k++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
  const xp = o.a * (Math.cos(E) - o.e);
  const yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const [cw, sw] = [Math.cos(o.argp * DEG), Math.sin(o.argp * DEG)];
  const [ci, si] = [Math.cos(o.i * DEG), Math.sin(o.i * DEG)];
  const [cO, sO] = [Math.cos(o.raan * DEG), Math.sin(o.raan * DEG)];
  const x1 = cw * xp - sw * yp;
  const y1 = sw * xp + cw * yp;
  return [cO * x1 - sO * ci * y1, sO * x1 + cO * ci * y1, si * y1];
}

/** Earth-fixed position of an orbiting satellite. */
export const orbitEcef = (o: KeplerOrbit, unixMs: number): Vec3 => rotZ(orbitEci(o, unixMs), -gmst(unixMs));

/** Semi-major axis of an orbit with the given period [s]. */
export const semiMajorAxis = (period: number) => Math.cbrt(MU * (period / (2 * Math.PI)) ** 2);

/** Scale Z so the WGS-84 ellipsoid becomes a sphere of radius RE. */
const toSphere = (p: Vec3): Vec3 => [p[0], p[1], (p[2] * RE) / RP];

/**
 * Closest approach of the infinite line p + s (q - p) to Earth's centre, in
 * ellipsoid-normalised space: returns the line parameter and the distance.
 */
function closestApproach(p: Vec3, q: Vec3): { s: number; d: number } {
  const P = toSphere(p);
  const D = sub(toSphere(q), P);
  const s = -dot(P, D) / dot(D, D);
  return { s, d: norm([P[0] + D[0] * s, P[1] + D[1] * s, P[2] + D[2] * s]) };
}

/** True if the straight line of sight from `a` to `b` clears the Earth. */
export function lineOfSight(a: Vec3, b: Vec3): boolean {
  const { s, d } = closestApproach(a, b);
  return !(s > 0 && s < 1 && d < RE - 100);
}

/**
 * True if, seen from `observer`, the target `b` appears against the black of
 * space rather than the Earth (plus a band of bright limb/atmosphere).
 */
export function spaceBackground(observer: Vec3, target: Vec3, limbBand = 50_000): boolean {
  const { s, d } = closestApproach(observer, target);
  return !(s > 1 && d < RE + limbBand);
}
