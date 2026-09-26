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

export interface TargetSolution {
  target: GeoPoint;
  /** Where the bus actually aims this RV, compensating J2 and drag [ECEF m] */
  aimEcef: Vec3;
  /** Distance between aim point and true target [m] */
  aimOffset: number;
  /** Great-ellipse surface range from the launch site [m] and launch azimuth [deg] */
  range: number;
  azimuth: number;
  /** Nominal (error-free) miss distance after convergence [m] */
  nominalMiss: number;
  /** Inside the bus footprint and converged */
  feasible: boolean;
}

export interface FiringSolution {
  spec: MissileSpec;
  launch: GeoPoint;
  profile: TrajectoryProfile;
  /** Planned flight time to the first target [s] */
  plannedTof: number;
  targets: TargetSolution[];
  iterations: number;
  /** Booster reaches the first target and every RV is inside the footprint */
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

/** Released RVs in bus order, then any left on the bus (they fail the same way again). */
const fixedOrder = (sim: SimResult): number[] => [
  ...sim.releaseOrder,
  ...sim.rvs.map((rv) => rv.index).filter((i) => !sim.releaseOrder.includes(i)),
];

/**
 * The fire-control computer. Kepler/Lambert guidance ignores Earth's
 * oblateness (J2) and air drag, so aiming straight at a target misses by
 * kilometres. We fly the full simulation, measure each RV's miss, move each
 * aim point the opposite way, and repeat ("shooting method") until every
 * nominal impact lands within a few metres of its target.
 *
 * The first target is the booster's; the rest are reached by bus manoeuvres.
 */
export function solveFiringSolution(
  spec: MissileSpec,
  launch: GeoPoint,
  targets: GeoPoint[],
  profile: TrajectoryProfile = 'minimum-energy',
): FiringSolution {
  if (targets.length < 1 || targets.length > spec.bus.rvCount) {
    throw new RangeError(`${spec.name} carries 1-${spec.bus.rvCount} RVs, got ${targets.length} targets`);
  }
  const launchEcef = geodeticToEcef(launch.lat, launch.lon, 0);
  const targetEcefs = targets.map((t) => geodeticToEcef(t.lat, t.lon, 0));
  const plannedTof = minimumEnergyTof(launchEcef, targetEcefs[0]) * PROFILE_TOF_FACTOR[profile];

  const aims = [...targetEcefs];
  const missOf = (sim: SimResult, k: number) => {
    const impact = sim.rvs[k].impact;
    return impact ? sub(impact.ecef, targetEcefs[k]) : null;
  };
  let nominal = simulate(spec, launchEcef, aims, plannedTof);
  let iterations = 0;
  for (; iterations < 12; iterations++) {
    if (!nominal.feasible) break;
    let worst = 0;
    targetEcefs.forEach((_, k) => {
      const err = missOf(nominal, k);
      if (!err || !nominal.rvs[k].released) return;
      worst = Math.max(worst, norm(err));
      aims[k] = projectToSurface(sub(aims[k], err));
    });
    if (worst < 5) break;
    // Freeze the bus's release sequence so the aim-point iteration converges.
    nominal = simulate(spec, launchEcef, aims, plannedTof, { releaseOrder: fixedOrder(nominal) });
  }

  const solved: TargetSolution[] = targets.map((target, k) => {
    const geo = vincentyInverse(launch.lat, launch.lon, target.lat, target.lon);
    const err = missOf(nominal, k);
    const miss = err ? norm(err) : Infinity;
    return {
      target,
      aimEcef: aims[k],
      aimOffset: norm(sub(aims[k], targetEcefs[k])),
      range: geo.distance,
      azimuth: geo.azimuth,
      nominalMiss: miss,
      feasible: nominal.feasible && nominal.rvs[k].released && miss < 1000,
    };
  });

  return {
    spec,
    launch,
    profile,
    plannedTof,
    targets: solved,
    iterations,
    feasible: solved.every((t) => t.feasible),
    nominal,
  };
}

/** Fly the solution for real, with inertial-guidance errors. */
export function flySolution(sol: FiringSolution, rng: () => number = Math.random): SimResult {
  const launchEcef = geodeticToEcef(sol.launch.lat, sol.launch.lon, 0);
  const aims = sol.targets.map((t) => t.aimEcef);
  return simulate(sol.spec, launchEcef, aims, sol.plannedTof, {
    releaseOrder: fixedOrder(sol.nominal),
    penaids: true,
    guidanceSigma: sol.spec.guidanceSigma,
    rng,
  });
}
