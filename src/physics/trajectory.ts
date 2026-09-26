import { airDensity } from './atmosphere';
import { G0 } from './constants';
import { gravityJ2 } from './gravity';
import { lambert } from './lambert';
import { type MissileSpec, payloadMass } from './missiles';
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

export type FlightPhase = 'boost' | 'bus' | 'midcourse' | 'terminal';

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
  kind: 'launch' | 'pitchover' | 'staging' | 'burnout' | 'release' | 'apogee' | 'reentry' | 'impact';
  label: string;
  /** Re-entry vehicle index, for per-RV events */
  rv?: number;
}

export interface RvResult {
  /** Index into the target list */
  index: number;
  /** False if the bus lacked the delta-v to put this RV on its trajectory */
  released: boolean;
  releaseT: number;
  /** Bus velocity change this RV needs [m/s]; NaN if the bus never got to evaluate it */
  busDv: number;
  /** Planned impact time chosen by the bus computer [s since launch] */
  plannedImpactT: number;
  samples: TrajectorySample[];
  apogee: { t: number; alt: number };
  impact: { t: number; ecef: Vec3; geo: Geodetic; speed: number } | null;
}

export type PenaidKind = 'stage' | 'decoy' | 'chaff';

/** A non-RV object on a ballistic path: spent stage, decoy or chaff cloud. */
export interface BallisticObject {
  /** e.g. 'STAGE', 'DCY-A1', 'CHF-A' */
  id: string;
  kind: PenaidKind;
  /** RV this penaid was released with */
  rv?: number;
  /** Ballistic coefficient [kg/m^2] */
  beta: number;
  samples: TrajectorySample[];
  /** How the object's flight ended: hit the ground or broke up / dispersed in the air */
  end: { t: number; reason: 'impact' | 'breakup'; alt: number } | null;
  /** Chaff cloud radius [m] = r0 + rate * (t - release time) */
  chaff?: { r0: number; rate: number };
}

export interface SimResult {
  /** Launch to booster burnout */
  booster: TrajectorySample[];
  /** Post-boost vehicle, burnout to last RV release */
  bus: TrajectorySample[];
  rvs: RvResult[];
  /** Spent stage, decoys and chaff (penaids only when `SimOptions.penaids`) */
  objects: BallisticObject[];
  events: FlightEvent[];
  /** Booster guidance achieved the required velocity before propellant ran out */
  feasible: boolean;
  /** Velocity still missing at booster propellant exhaustion [m/s] */
  residualVgo: number;
  burnout: { t: number; alt: number; speed: number; flightPathAngle: number };
  /** Order in which the bus released RVs (indices into the target list) */
  releaseOrder: number[];
  /** Bus delta-v spent [m/s] and propellant used [kg] of `spec.bus.propellant` */
  busDvUsed: number;
  busPropellantUsed: number;
}

export interface SimOptions {
  /** 1-sigma per-axis velocity error at each RV release [m/s]; 0 = perfect guidance */
  guidanceSigma?: number;
  /** Uniform [0,1) random source, for reproducible dispersion */
  rng?: () => number;
  /**
   * Fixed RV release order. When omitted the bus computer sequences greedily,
   * always serving the target that costs the least delta-v next.
   */
  releaseOrder?: number[];
  /** Release decoys and chaff with each RV (skipped by the fire-control solver for speed) */
  penaids?: boolean;
}

interface State {
  t: number;
  r: Vec3;
  v: Vec3;
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

const sampleOf = (s: State, phase: FlightPhase): TrajectorySample => ({
  t: s.t,
  ecef: eciToEcef(s.r, s.t),
  alt: altitude(s.r),
  speed: norm(s.v),
  phase,
});

/**
 * Booster flight, the way 1970s-80s inertial guidance actually worked:
 *   1. vertical rise out of the silo,
 *   2. an open-loop pitch program toward the target azimuth (1st stage),
 *   3. closed-loop "velocity-to-be-gained" steering on the upper stages:
 *      every guidance cycle solves Lambert's problem for the velocity
 *      required to coast to the (Earth-rotated) aim point by the planned
 *      impact time, thrusts along the difference, and commands thrust
 *      termination when that difference reaches zero.
 */
function flyBoost(
  spec: MissileSpec,
  launchEcef: Vec3,
  aimEcef: Vec3,
  plannedTof: number,
  samples: TrajectorySample[],
  events: FlightEvent[],
): { state: State; feasible: boolean; residualVgo: number } {
  const launchGeo = ecefToGeodetic(launchEcef);
  const aimGeo = ecefToGeodetic(aimEcef);
  const aimEci = ecefToEci(aimEcef, plannedTof);

  // Directions are frozen in inertial space at launch, as a gyro-stabilised platform holds them.
  const enu = enuBasis(launchGeo.lat, launchGeo.lon);
  const dLon = ((aimGeo.lon - launchGeo.lon) * Math.PI) / 180;
  const la1 = (launchGeo.lat * Math.PI) / 180;
  const la2 = (aimGeo.lat * Math.PI) / 180;
  const az = Math.atan2(
    Math.sin(dLon) * Math.cos(la2),
    Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon),
  );
  const horiz = add(scale(enu.north, Math.cos(az)), scale(enu.east, Math.sin(az)));
  const pitchDir = (pitchDeg: number): Vec3 => {
    const p = (pitchDeg * Math.PI) / 180;
    return add(scale(enu.up, Math.cos(p)), scale(horiz, Math.sin(p)));
  };
  const stage1Burn = spec.stages[0].burnTime;

  const s: State = { t: 0, r: [...launchEcef], v: earthRotationVelocity(launchEcef) };
  let mass = payloadMass(spec) + spec.stages.reduce((m, st) => m + st.propellant + st.dry, 0);
  let stageIdx = 0;
  let stageTime = 0;
  let residualVgo = 0;
  let pitchedOver = false;
  samples.push(sampleOf(s, 'boost'));

  while (stageIdx < spec.stages.length) {
    const stage = spec.stages[stageIdx];
    const mdot = stage.propellant / stage.burnTime;
    const dt = Math.min(BOOST_DT, stage.burnTime - stageTime);
    const thrustAcc = (mdot * stage.isp * G0) / (mass - (mdot * dt) / 2);

    let dir: Vec3;
    if (stageIdx === 0) {
      if (s.t < spec.verticalRise) {
        dir = enu.up;
      } else {
        if (!pitchedOver) {
          events.push({ t: s.t, kind: 'pitchover', label: 'Pitch-over' });
          pitchedOver = true;
        }
        // Open-loop pitch program: tilt linearly from vertical to the programmed
        // angle by 1st-stage burnout, keeping loads low in the dense atmosphere.
        const f = (s.t + dt / 2 - spec.verticalRise) / (stage1Burn - spec.verticalRise);
        dir = pitchDir(f * spec.stage1EndPitch);
      }
    } else {
      const req = lambert(s.r, aimEci, plannedTof - s.t);
      if (!req) break;
      const vgo = sub(req.v1, s.v);
      residualVgo = norm(vgo);
      if (residualVgo <= thrustAcc * dt) {
        // Thrust termination: the last fraction of a guidance cycle closes the gap exactly.
        s.v = req.v1;
        events.push({ t: s.t, kind: 'burnout', label: 'Thrust termination — bus separation' });
        return { state: s, feasible: true, residualVgo: 0 };
      }
      dir = scale(vgo, 1 / residualVgo);
    }

    [s.r, s.v] = rk4(s.r, s.v, dt, mass / spec.cdA, scale(dir, thrustAcc));
    s.t += dt;
    mass -= mdot * dt;
    stageTime += dt;
    if (altitude(s.r) < -1) return { state: s, feasible: false, residualVgo };
    if (stageTime >= stage.burnTime - 1e-9) {
      mass -= stage.dry;
      stageIdx++;
      stageTime = 0;
      events.push({ t: s.t, kind: 'staging', label: `${stage.name} burnout / separation` });
    }
    samples.push(sampleOf(s, 'boost'));
  }
  events.push({ t: s.t, kind: 'burnout', label: 'Propellant exhausted' });
  return { state: s, feasible: false, residualVgo };
}

/** Coast (gravity + drag) from `s` to time `until`, recording samples. Mutates `s`. */
function coastTo(s: State, until: number, beta: number, samples: TrajectorySample[], phase: FlightPhase) {
  while (s.t < until - 1e-9) {
    const dt = Math.min(COAST_DT, until - s.t);
    [s.r, s.v] = rk4(s.r, s.v, dt, beta, [0, 0, 0]);
    s.t += dt;
    samples.push(sampleOf(s, phase));
  }
}

/** Ballistic flight of a released RV until it meets the ellipsoid. */
function flyRv(start: State, beta: number, maxT: number, rv: RvResult, events: FlightEvent[]) {
  const s: State = { t: start.t, r: start.r, v: start.v };
  const samples = rv.samples;
  samples.push(sampleOf(s, 'midcourse'));
  let apogee = { t: s.t, alt: altitude(s.r) };
  let pastApogee = false;
  let reentered = false;
  const tag = String.fromCharCode(65 + rv.index);

  while (s.t < maxT) {
    const alt0 = altitude(s.r);
    const dt = alt0 > 150_000 ? COAST_DT : REENTRY_DT;
    const r0 = s.r;
    const v0 = s.v;
    [s.r, s.v] = rk4(s.r, s.v, dt, beta, [0, 0, 0]);
    s.t += dt;
    const alt = altitude(s.r);

    if (alt > apogee.alt) apogee = { t: s.t, alt };
    else if (!pastApogee) {
      pastApogee = true;
      events.push({ t: apogee.t, kind: 'apogee', label: `RV-${tag} apogee ${(apogee.alt / 1000).toFixed(0)} km`, rv: rv.index });
    }
    if (pastApogee && !reentered && alt < REENTRY_ALT) {
      reentered = true;
      events.push({ t: s.t, kind: 'reentry', label: `RV-${tag} re-entry`, rv: rv.index });
    }
    if (alt <= 0) {
      // Interpolate the exact surface crossing within the last step.
      const f = alt0 / (alt0 - alt);
      s.t = s.t - dt + f * dt;
      s.r = addScaled(r0, sub(s.r, r0), f);
      s.v = addScaled(v0, sub(s.v, v0), f);
      const ecef = eciToEcef(s.r, s.t);
      rv.impact = { t: s.t, ecef, geo: ecefToGeodetic(ecef), speed: norm(s.v) };
      events.push({ t: s.t, kind: 'impact', label: `RV-${tag} impact`, rv: rv.index });
      samples.push(sampleOf(s, 'terminal'));
      break;
    }
    samples.push(sampleOf(s, pastApogee && alt < REENTRY_ALT ? 'terminal' : 'midcourse'));
  }
  rv.apogee = apogee;
}

/**
 * Ballistic flight of a stage, decoy or chaff cloud. It ends on impact, or
 * when dynamic pressure exceeds `breakupQ` [Pa]: balloons tear, casings
 * break up and chaff disperses. In vacuum it moves exactly like an RV.
 */
function flyObject(start: State, beta: number, maxT: number, breakupQ: number, obj: BallisticObject) {
  const s: State = { t: start.t, r: start.r, v: start.v };
  obj.samples.push(sampleOf(s, 'midcourse'));
  let pastApogee = false;
  let prevAlt = altitude(s.r);
  while (s.t < maxT) {
    const dt = prevAlt > 150_000 ? COAST_DT : REENTRY_DT;
    [s.r, s.v] = rk4(s.r, s.v, dt, beta, [0, 0, 0]);
    s.t += dt;
    const alt = altitude(s.r);
    if (alt < prevAlt) pastApogee = true;
    prevAlt = alt;
    const phase: FlightPhase = pastApogee && alt < REENTRY_ALT ? 'terminal' : 'midcourse';
    obj.samples.push(sampleOf(s, phase));
    if (alt <= 0) {
      obj.end = { t: s.t, reason: 'impact', alt: 0 };
      return;
    }
    const vRel = sub(s.v, earthRotationVelocity(s.r));
    if (0.5 * airDensity(alt) * dot(vRel, vRel) > breakupQ) {
      obj.end = { t: s.t, reason: 'breakup', alt };
      return;
    }
  }
}

/** Breakup dynamic pressures [Pa]. */
const Q_CHAFF = 50; // dipoles scattered almost as soon as the air thickens (~95 km)
const Q_DECOY = 5_000; // light balloons / replicas (~60 km)
const Q_STAGE = 20_000; // empty motor casing

/** Random unit vector. */
function randomDir(rng: () => number): Vec3 {
  return unit([gaussian(rng), gaussian(rng), gaussian(rng)]);
}

/** Bus delta-v needed to move from `s` onto a path hitting `aimEcef` at time T. */
function busDvFor(s: State, aimEcef: Vec3, T: number): { dv: number; v: Vec3 } | null {
  const sol = lambert(s.r, ecefToEci(aimEcef, T), T - s.t);
  return sol ? { dv: norm(sub(sol.v1, s.v)), v: sol.v1 } : null;
}

/** The bus computer picks each RV's impact time to minimise the delta-v it costs. */
function cheapestImpactTime(s: State, aimEcef: Vec3, guess: number): number {
  const cost = (T: number) => busDvFor(s, aimEcef, T)?.dv ?? Infinity;
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = Math.max(s.t + 120, guess - 900);
  let b = guess + 900;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = cost(c);
  let fd = cost(d);
  for (let i = 0; i < 40; i++) {
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
 * Fly a MIRVed missile from `launchEcef` against one or more aim points.
 *
 * The booster steers the post-boost vehicle ("bus") onto a trajectory to the
 * first aim point, arriving `plannedTof` seconds after launch, and releases
 * that RV. It then coasts above the atmosphere and, at fixed intervals, makes
 * a small burn (solved with Lambert's problem, with the impact time chosen to
 * minimise delta-v) that puts itself exactly on the next RV's trajectory, and
 * releases that RV. Each burn draws on the bus's propellant
 * (rocket equation, with the bus getting lighter as RVs leave), which is what
 * limits the "footprint" a MIRV bus can cover. Released RVs are purely
 * ballistic: J2 gravity plus drag, integrated with RK4, until they meet the
 * ellipsoid.
 *
 * All integration is done in an inertial frame aligned with ECEF at t = 0.
 */
export function simulate(
  spec: MissileSpec,
  launchEcef: Vec3,
  aimEcefs: Vec3[],
  plannedTof: number,
  opts: SimOptions = {},
): SimResult {
  const booster: TrajectorySample[] = [];
  const bus: TrajectorySample[] = [];
  const events: FlightEvent[] = [{ t: 0, kind: 'launch', label: 'Launch' }];
  const b = spec.bus;
  const rvs: RvResult[] = aimEcefs.map((_, index) => ({
    index,
    released: false,
    releaseT: 0,
    busDv: NaN,
    plannedImpactT: 0,
    samples: [],
    apogee: { t: 0, alt: 0 },
    impact: null,
  }));

  const boost = flyBoost(spec, launchEcef, aimEcefs[0], plannedTof, booster, events);
  const s = boost.state;
  const speed = norm(s.v);
  const burnout = {
    t: s.t,
    alt: altitude(s.r),
    speed,
    flightPathAngle: (Math.asin(dot(unit(s.r), s.v) / speed) * 180) / Math.PI,
  };
  let busMass = payloadMass(spec);
  let propellant = b.propellant;
  const exhaustV = b.isp * G0;
  let busDvUsed = 0;
  const releaseOrder: number[] = [];

  const objects: BallisticObject[] = [];
  if (boost.feasible) {
    bus.push(sampleOf(s, 'bus'));
    const rng = opts.rng ?? Math.random;
    // The spent final stage backs away from the bus and tumbles along behind it.
    const stage: BallisticObject = { id: 'STAGE', kind: 'stage', beta: spec.stageBeta, samples: [], end: null };
    flyObject({ t: s.t, r: s.r, v: addScaled(s.v, unit(s.v), -3) }, spec.stageBeta, plannedTof * 2 + 900, Q_STAGE, stage);
    objects.push(stage);
    const sigma = opts.guidanceSigma ?? 0;
    const maxT = plannedTof * 2 + 900;
    const remaining = aimEcefs.map((_, i) => i).filter((i) => i !== 0);
    for (let slot = 0; slot < aimEcefs.length; slot++) {
      coastTo(s, burnout.t + b.firstRelease + slot * b.releaseInterval, spec.rvBeta, bus, 'bus');

      // Candidate burns: the booster's own target first, then the fixed or cheapest next one.
      let pick: { k: number; T: number; dv: number; v: Vec3 } | null = null;
      const candidates = slot === 0 ? [0] : opts.releaseOrder ? [opts.releaseOrder[slot]] : remaining;
      for (const k of candidates) {
        const T = k === 0 ? plannedTof : cheapestImpactTime(s, aimEcefs[k], plannedTof + slot * b.releaseInterval);
        const burn = busDvFor(s, aimEcefs[k], T);
        rvs[k].plannedImpactT = T;
        rvs[k].busDv = burn?.dv ?? Infinity;
        if (burn && (!pick || burn.dv < pick.dv)) pick = { k, T, dv: burn.dv, v: burn.v };
      }
      if (!pick) break;
      const needed = busMass * (1 - Math.exp(-pick.dv / exhaustV));
      if (needed > propellant) break; // the rest lie outside the footprint: RVs stay on the bus
      const k = pick.k;
      if (remaining.includes(k)) remaining.splice(remaining.indexOf(k), 1);
      propellant -= needed;
      busMass -= needed;
      busDvUsed += pick.dv;
      s.v = pick.v;
      // Inertial measurement errors: each RV leaves with a slightly wrong velocity.
      const v: Vec3 =
        sigma > 0 ? add(s.v, [gaussian(rng) * sigma, gaussian(rng) * sigma, gaussian(rng) * sigma]) : s.v;
      const rv = rvs[k];
      rv.released = true;
      rv.releaseT = s.t;
      releaseOrder.push(k);
      busMass -= b.rvMass;
      events.push({
        t: s.t,
        kind: 'release',
        label: `RV-${String.fromCharCode(65 + k)} released (bus Δv ${pick.dv.toFixed(0)} m/s)`,
        rv: k,
      });
      flyRv({ t: s.t, r: s.r, v }, spec.rvBeta, maxT, rv, events);

      if (opts.penaids) {
        const p = spec.penaids;
        const L = String.fromCharCode(65 + k);
        for (let d = 0; d < p.decoysPerRv; d++) {
          const decoy: BallisticObject = { id: `DCY-${L}${d + 1}`, kind: 'decoy', rv: k, beta: p.decoyBeta, samples: [], end: null };
          const dv = scale(randomDir(rng), p.separation * (0.5 + 0.5 * rng()));
          flyObject({ t: s.t, r: s.r, v: add(v, dv) }, p.decoyBeta, maxT, Q_DECOY, decoy);
          objects.push(decoy);
        }
        for (let c = 0; c < p.chaffPerRv; c++) {
          const id = p.chaffPerRv > 1 ? `CHF-${L}${c + 1}` : `CHF-${L}`;
          const cloud: BallisticObject = {
            id,
            kind: 'chaff',
            rv: k,
            beta: p.chaffBeta,
            samples: [],
            end: null,
            chaff: { r0: 50, rate: p.chaffExpansion },
          };
          flyObject({ t: s.t, r: s.r, v: add(v, scale(randomDir(rng), 0.2)) }, p.chaffBeta, maxT, Q_CHAFF, cloud);
          objects.push(cloud);
        }
      }
    }
  }

  events.sort((a, c) => a.t - c.t);
  return {
    booster,
    bus,
    rvs,
    objects,
    events,
    feasible: boost.feasible,
    residualVgo: boost.residualVgo,
    burnout,
    releaseOrder,
    busDvUsed,
    busPropellantUsed: b.propellant - propellant,
  };
}
