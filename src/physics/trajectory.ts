import { airDensity } from './atmosphere';
import { G0 } from './constants';
import { gravityJ2 } from './gravity';
import { lambert } from './lambert';
import type { MissileSpec } from './missiles';
import { type Vec3, add, addScaled, dot, norm, scale, sub, unit } from './vec3';
import {
  altitude,
  earthRotationVelocity,
  ecefToEci,
  ecefToGeodetic,
  eciToEcef,
  enuBasis,
  type Geodetic,
} from './wgs84';

export type FlightPhase = 'boost' | 'midcourse' | 'terminal';

export interface TrajectorySample {
  /** Seconds since launch */
  t: number;
  /** Earth-fixed position [m] (what the globe renders) */
  ecef: Vec3;
  /** Height above WGS-84 ellipsoid [m] */
  alt: number;
  /** Inertial speed [m/s] */
  speed: number;
  phase: FlightPhase;
}

export interface FlightEvent {
  t: number;
  kind: 'launch' | 'pitchover' | 'staging' | 'burnout' | 'apogee' | 'reentry' | 'impact';
  label: string;
}

export interface SimResult {
  samples: TrajectorySample[];
  events: FlightEvent[];
  /** Guidance achieved the required velocity before propellant ran out */
  feasible: boolean;
  /** Velocity still missing at propellant exhaustion [m/s] (0 if feasible) */
  residualVgo: number;
  burnout: { t: number; alt: number; speed: number; flightPathAngle: number };
  apogee: { t: number; alt: number };
  impact: { t: number; ecef: Vec3; geo: Geodetic; speed: number } | null;
}

export interface SimOptions {
  /** 1-sigma per-axis burnout velocity error [m/s]; 0 = perfect guidance */
  guidanceSigma?: number;
  /** Uniform [0,1) random source, for reproducible dispersion */
  rng?: () => number;
}

const BOOST_DT = 0.5;
const COAST_DT = 2;
const REENTRY_DT = 0.1;
const REENTRY_ALT = 100_000;

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Aerodynamic drag against the co-rotating atmosphere, for ballistic coefficient beta [kg/m^2]. */
function dragAccel(r: Vec3, v: Vec3, beta: number): Vec3 {
  const rho = airDensity(altitude(r));
  if (rho === 0) return [0, 0, 0];
  const vRel = sub(v, earthRotationVelocity(r));
  return scale(vRel, (-0.5 * rho * norm(vRel)) / beta);
}

/** One RK4 step of r'' = gravity + drag + thrustAccel (thrust held constant over the step). */
function rk4(r: Vec3, v: Vec3, dt: number, beta: number, thrust: Vec3): [Vec3, Vec3] {
  const acc = (rr: Vec3, vv: Vec3) => add(add(gravityJ2(rr), dragAccel(rr, vv, beta)), thrust);
  const a1 = acc(r, v);
  const r2 = addScaled(r, v, dt / 2);
  const v2 = addScaled(v, a1, dt / 2);
  const a2 = acc(r2, v2);
  const r3 = addScaled(r, v2, dt / 2);
  const v3 = addScaled(v, a2, dt / 2);
  const a3 = acc(r3, v3);
  const r4 = addScaled(r, v3, dt);
  const v4 = addScaled(v, a3, dt);
  const a4 = acc(r4, v4);
  const rn = addScaled(r, add(add(v, scale(add(v2, v3), 2)), v4), dt / 6);
  const vn = addScaled(v, add(add(a1, scale(add(a2, a3), 2)), a4), dt / 6);
  return [rn, vn];
}

/**
 * Fly a missile from `launchEcef` toward the aim point `aimEcef`, planned to
 * arrive `plannedTof` seconds after launch.
 *
 * Boost follows the way 1970s-80s inertial guidance actually worked:
 *   1. vertical rise out of the silo,
 *   2. an open-loop pitch program toward the target azimuth (1st stage),
 *   3. closed-loop "velocity-to-be-gained" steering on the upper stages:
 *      every guidance cycle solves Lambert's problem for the velocity
 *      required to coast to the (Earth-rotated) aim point by the planned
 *      impact time, thrusts along the difference, and commands thrust
 *      termination when that difference reaches zero.
 * After burnout the re-entry vehicle is purely ballistic: J2 gravity plus
 * atmospheric drag, integrated with RK4, until it meets the ellipsoid.
 *
 * All integration is done in an inertial frame aligned with ECEF at t = 0.
 */
export function simulate(
  spec: MissileSpec,
  launchEcef: Vec3,
  aimEcef: Vec3,
  plannedTof: number,
  opts: SimOptions = {},
): SimResult {
  const samples: TrajectorySample[] = [];
  const events: FlightEvent[] = [{ t: 0, kind: 'launch', label: 'Launch' }];

  const launchGeo = ecefToGeodetic(launchEcef);
  const aimGeo = ecefToGeodetic(aimEcef);
  const aimEci = ecefToEci(aimEcef, plannedTof);

  // Pitch-over direction: tilt from local vertical toward the aim azimuth.
  const enu = enuBasis(launchGeo.lat, launchGeo.lon);
  const dLon = ((aimGeo.lon - launchGeo.lon) * Math.PI) / 180;
  const la1 = (launchGeo.lat * Math.PI) / 180;
  const la2 = (aimGeo.lat * Math.PI) / 180;
  const az = Math.atan2(
    Math.sin(dLon) * Math.cos(la2),
    Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon),
  );
  const horiz = add(scale(enu.north, Math.cos(az)), scale(enu.east, Math.sin(az)));
  // Directions are frozen in inertial space at launch, as a gyro-stabilised platform holds them.
  const pitchDir = (pitchDeg: number): Vec3 => {
    const p = (pitchDeg * Math.PI) / 180;
    return add(scale(enu.up, Math.cos(p)), scale(horiz, Math.sin(p)));
  };
  const stage1Burn = spec.stages[0].burnTime;

  let r: Vec3 = [...launchEcef];
  let v: Vec3 = earthRotationVelocity(r);
  let t = 0;
  let mass = spec.payload + spec.stages.reduce((m, s) => m + s.propellant + s.dry, 0);
  let stageIdx = 0;
  let stageTime = 0;
  let residualVgo = 0;
  let feasible = false;
  let crashed = false;

  const record = (phase: FlightPhase) => {
    samples.push({ t, ecef: eciToEcef(r, t), alt: altitude(r), speed: norm(v), phase });
  };
  record('boost');

  // ---- Boost -------------------------------------------------------------
  let pitchedOver = false;
  while (stageIdx < spec.stages.length) {
    const stage = spec.stages[stageIdx];
    const mdot = stage.propellant / stage.burnTime;
    const thrustForce = mdot * stage.isp * G0;
    const dt = Math.min(BOOST_DT, stage.burnTime - stageTime);
    const midMass = mass - (mdot * dt) / 2;
    const thrustAcc = thrustForce / midMass;

    let dir: Vec3;
    if (stageIdx === 0) {
      if (t < spec.verticalRise) {
        dir = enu.up;
      } else {
        if (!pitchedOver) {
          events.push({ t, kind: 'pitchover', label: 'Pitch-over' });
          pitchedOver = true;
        }
        // Open-loop pitch program: tilt linearly from vertical to the programmed
        // angle by 1st-stage burnout, keeping loads low in the dense atmosphere.
        const s = (t + dt / 2 - spec.verticalRise) / (stage1Burn - spec.verticalRise);
        dir = pitchDir(s * spec.stage1EndPitch);
      }
    } else {
      const req = lambert(r, aimEci, plannedTof - t);
      if (!req) break;
      const vgo = sub(req.v1, v);
      residualVgo = norm(vgo);
      if (residualVgo <= thrustAcc * dt) {
        // Thrust termination: the last fraction of a guidance cycle closes the gap exactly.
        v = req.v1;
        residualVgo = 0;
        feasible = true;
        break;
      }
      dir = scale(vgo, 1 / residualVgo);
    }

    const beta = mass / spec.cdA;
    [r, v] = rk4(r, v, dt, beta, scale(dir, thrustAcc));
    t += dt;
    mass -= mdot * dt;
    stageTime += dt;
    if (altitude(r) < -1) {
      crashed = true;
      break;
    }
    if (stageTime >= stage.burnTime - 1e-9) {
      mass -= stage.dry;
      stageIdx++;
      stageTime = 0;
      events.push({ t, kind: 'staging', label: `${stage.name} burnout / separation` });
    }
    record('boost');
  }

  // Inertial guidance is never perfect: disperse the burnout velocity.
  const sigma = opts.guidanceSigma ?? 0;
  if (sigma > 0) {
    const rng = opts.rng ?? Math.random;
    v = add(v, [gaussian(rng) * sigma, gaussian(rng) * sigma, gaussian(rng) * sigma]);
  }

  const burnoutSpeed = norm(v);
  const burnout = {
    t,
    alt: altitude(r),
    speed: burnoutSpeed,
    flightPathAngle: (Math.asin(dot(unit(r), v) / burnoutSpeed) * 180) / Math.PI,
  };
  events.push({ t, kind: 'burnout', label: feasible ? 'Thrust termination — RV on ballistic path' : 'Propellant exhausted' });
  record('midcourse');

  // ---- Ballistic flight --------------------------------------------------
  let apogee = { t, alt: altitude(r) };
  let apogeeLogged = false;
  let reentryLogged = false;
  let impact: SimResult['impact'] = null;
  const maxT = plannedTof * 2 + 600;

  while (!crashed && t < maxT) {
    const alt0 = altitude(r);
    const dt = alt0 > 150_000 ? COAST_DT : REENTRY_DT;
    const r0 = r;
    const v0 = v;
    [r, v] = rk4(r, v, dt, spec.rvBeta, [0, 0, 0]);
    t += dt;
    const alt = altitude(r);

    if (alt > apogee.alt) apogee = { t, alt };
    else if (!apogeeLogged) {
      apogeeLogged = true;
      events.push({ t: apogee.t, kind: 'apogee', label: `Apogee ${(apogee.alt / 1000).toFixed(0)} km` });
    }
    if (apogeeLogged && !reentryLogged && alt < REENTRY_ALT) {
      reentryLogged = true;
      events.push({ t, kind: 'reentry', label: 'Atmospheric re-entry' });
    }

    if (alt <= 0) {
      // Interpolate the exact surface crossing within the last step.
      const f = alt0 / (alt0 - alt);
      const tImp = t - dt + f * dt;
      const rImp = addScaled(r0, sub(r, r0), f);
      const vImp = addScaled(v0, sub(v, v0), f);
      t = tImp;
      r = rImp;
      v = vImp;
      const ecef = eciToEcef(rImp, tImp);
      impact = { t: tImp, ecef, geo: ecefToGeodetic(ecef), speed: norm(vImp) };
      events.push({ t: tImp, kind: 'impact', label: 'Impact' });
      record('terminal');
      break;
    }
    record(apogeeLogged && alt < REENTRY_ALT ? 'terminal' : 'midcourse');
  }

  return { samples, events, feasible: feasible && !crashed, residualVgo, burnout, apogee, impact };
}
