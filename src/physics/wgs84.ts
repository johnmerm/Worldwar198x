import { DEG, E2, OMEGA_EARTH, RE } from './constants';
import { type Vec3, rotZ } from './vec3';

export interface Geodetic {
  /** Geodetic latitude [deg] */
  lat: number;
  /** Longitude [deg], east positive */
  lon: number;
  /** Height above the WGS-84 ellipsoid [m] */
  h: number;
}

/** Prime-vertical radius of curvature at geodetic latitude phi [rad]. */
const primeVertical = (phi: number) => RE / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);

/** Geodetic (lat/lon/height) to Earth-Centred Earth-Fixed cartesian [m]. */
export function geodeticToEcef(lat: number, lon: number, h = 0): Vec3 {
  const phi = lat * DEG;
  const lam = lon * DEG;
  const n = primeVertical(phi);
  const cp = Math.cos(phi);
  return [(n + h) * cp * Math.cos(lam), (n + h) * cp * Math.sin(lam), (n * (1 - E2) + h) * Math.sin(phi)];
}

/** ECEF [m] to geodetic. Iterative; converges to sub-millimetre in a few passes. */
export function ecefToGeodetic(r: Vec3): Geodetic {
  const [x, y, z] = r;
  const p = Math.hypot(x, y);
  const lam = Math.atan2(y, x);
  let phi = Math.atan2(z, p * (1 - E2));
  for (let i = 0; i < 6; i++) {
    const n = primeVertical(phi);
    const h = p * Math.cos(phi) + z * Math.sin(phi) - RE * Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
    phi = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }
  const h = p * Math.cos(phi) + z * Math.sin(phi) - RE * Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  return { lat: phi / DEG, lon: lam / DEG, h };
}

/**
 * Height above the ellipsoid. Invariant under rotation about Z, so it can be
 * evaluated directly on inertial (ECI) positions too.
 */
export const altitude = (r: Vec3): number => ecefToGeodetic(r).h;

/** Local East / North / Up unit vectors at a geodetic point (in ECEF). */
export function enuBasis(lat: number, lon: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const phi = lat * DEG;
  const lam = lon * DEG;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const sl = Math.sin(lam);
  const cl = Math.cos(lam);
  return {
    east: [-sl, cl, 0],
    north: [-sp * cl, -sp * sl, cp],
    up: [cp * cl, cp * sl, sp],
  };
}

/**
 * Frames. The inertial frame used by the simulator is aligned with ECEF at the
 * moment of launch (t = 0) and shares its Z axis, so the transform is a single
 * rotation by the Earth rotation angle omega * t.
 */
export const ecefToEci = (r: Vec3, t: number): Vec3 => rotZ(r, OMEGA_EARTH * t);
export const eciToEcef = (r: Vec3, t: number): Vec3 => rotZ(r, -OMEGA_EARTH * t);

/** Velocity of a point co-rotating with the Earth (omega x r). */
export const earthRotationVelocity = (r: Vec3): Vec3 => [-OMEGA_EARTH * r[1], OMEGA_EARTH * r[0], 0];

/** Project a point to the ellipsoid surface directly below/above it. */
export function projectToSurface(r: Vec3): Vec3 {
  const g = ecefToGeodetic(r);
  return geodeticToEcef(g.lat, g.lon, 0);
}
