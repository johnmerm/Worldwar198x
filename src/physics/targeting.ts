import { OMEGA_EARTH } from './constants';
import { vincentyInverse } from './geodesy';
import { lambert } from './lambert';
import type { MissileSpec } from './missiles';
import { type SimResult, simulate } from './trajectory';
import { type Vec3, norm, rotZ, sub } from './vec3';
import { earthRotationVelocity, geodeticToEcef, projectToSurface } from './wgs84';

export type TrajectoryProfile = 'minimum-energy' | 'lofted' | 'depressed';

export const PROFILE_TOF_FACTOR: Record<TrajectoryProfile, number> = {
  'minimum-energy': 1.0,
  lofted: 1.3,
  depressed: 0.82,
};

export interface GeoPoint {
  name: string;
  lat: number;
  lon: number;
}

export interface FiringSolution {
  spec: MissileSpec;
  launch: GeoPoint;
  target: GeoPoint;
  profile: TrajectoryProfile;
  /** Planned flight time [s] */
  plannedTof: number;
  /** Where guidance actually aims, compensating J2 and drag [ECEF m] */
  aimEcef: Vec3;
  /** Distance between aim point and true target [m] */
  aimOffset: number;
  /** Great-ellipse surface range [m] and launch azimuth [deg] */
  range: number;
  azimuth: number;
  iterations: number;
  /** Nominal (error-free) miss distance after convergence [m] */
  nominalMiss: number;
  feasible: boolean;
  nominal: SimResult;
}

/**
 * Flight time of the minimum-energy ballistic path: the transfer time that
 * minimises the velocity the missile must add to the Earth's own rotation
 * (golden-section search over Lambert solutions, target rotated with Earth).
 */
export function minimumEnergyTof(launchEcef: Vec3, targetEcef: Vec3): number {
  const v0 = earthRotationVelocity(launchEcef);
  const cost = (T: number) => {
    const sol = lambert(launchEcef, rotZ(targetEcef, OMEGA_EARTH * T), T);
    return sol ? norm(sub(sol.v1, v0)) : Infinity;
  };
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = 120;
  let b = 5400;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = cost(c);
  let fd = cost(d);
  for (let i = 0; i < 60; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = cost(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = cost(d);
    }
  }
  return 0.5 * (a + b);
}

/**
 * The fire-control computer. Kepler/Lambert guidance ignores Earth's
 * oblateness (J2) and air drag, so aiming straight at the target misses by
 * kilometres. We fly the full simulation, measure the miss, move the aim
 * point the opposite way, and repeat ("shooting method") until the nominal
 * impact lands within a few metres of the target.
 */
export function solveFiringSolution(
  spec: MissileSpec,
  launch: GeoPoint,
  target: GeoPoint,
  profile: TrajectoryProfile = 'minimum-energy',
): FiringSolution {
  const launchEcef = geodeticToEcef(launch.lat, launch.lon, 0);
  const targetEcef = geodeticToEcef(target.lat, target.lon, 0);
  const plannedTof = minimumEnergyTof(launchEcef, targetEcef) * PROFILE_TOF_FACTOR[profile];
  const geo = vincentyInverse(launch.lat, launch.lon, target.lat, target.lon);

  let aim = targetEcef;
  let nominal = simulate(spec, launchEcef, aim, plannedTof);
  let miss = Infinity;
  let iterations = 0;
  for (; iterations < 12; iterations++) {
    if (!nominal.impact || !nominal.feasible) break;
    const err = sub(nominal.impact.ecef, targetEcef);
    miss = norm(err);
    if (miss < 5) break;
    aim = projectToSurface(sub(aim, err));
    nominal = simulate(spec, launchEcef, aim, plannedTof);
  }
  if (nominal.impact) miss = norm(sub(nominal.impact.ecef, targetEcef));

  return {
    spec,
    launch,
    target,
    profile,
    plannedTof,
    aimEcef: aim,
    aimOffset: norm(sub(aim, targetEcef)),
    range: geo.distance,
    azimuth: geo.azimuth,
    iterations,
    nominalMiss: miss,
    feasible: nominal.feasible && miss < 1000,
    nominal,
  };
}

/** Fly the solution for real, with inertial-guidance errors. */
export function flySolution(sol: FiringSolution, rng: () => number = Math.random): SimResult {
  const launchEcef = geodeticToEcef(sol.launch.lat, sol.launch.lon, 0);
  return simulate(sol.spec, launchEcef, sol.aimEcef, sol.plannedTof, {
    guidanceSigma: sol.spec.guidanceSigma,
    rng,
  });
}
