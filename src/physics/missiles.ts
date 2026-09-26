export interface Stage {
  name: string;
  /** Propellant mass [kg] */
  propellant: number;
  /** Structural mass dropped at staging [kg] */
  dry: number;
  /** Vacuum specific impulse [s] */
  isp: number;
  /** Burn duration [s] */
  burnTime: number;
}

/** Post-boost vehicle ("bus") that carries and individually aims the RVs. */
export interface BusSpec {
  /** Re-entry vehicles carried */
  rvCount: number;
  /** Mass of one RV [kg] */
  rvMass: number;
  /** Bus structure, guidance and engine [kg] */
  dry: number;
  /** Bus propellant [kg] */
  propellant: number;
  /** Bus engine specific impulse [s] */
  isp: number;
  /** Seconds after booster burnout until the first RV is released */
  firstRelease: number;
  /** Seconds between successive RV releases */
  releaseInterval: number;
}

/**
 * Penetration aids released with each RV. Decoys are light replicas that fly
 * exactly like RVs in vacuum; chaff is a cloud of dipoles that hides whatever
 * is inside it from radar. The atmosphere strips both before the RVs land.
 */
export interface PenaidSpec {
  decoysPerRv: number;
  /** Decoy ballistic coefficient [kg/m^2]; far lower than an RV's */
  decoyBeta: number;
  chaffPerRv: number;
  /** Chaff cloud ballistic coefficient [kg/m^2]; dipoles are stripped very high */
  chaffBeta: number;
  /** Chaff cloud radius growth [m/s] */
  chaffExpansion: number;
  /** Separation speed pushing decoys away from their RV [m/s] */
  separation: number;
}

/** Radar cross-sections [m^2], broadside-averaged, for early-warning radar ranges. */
export interface RcsSpec {
  booster: number;
  /** Spent final stage tumbling through midcourse */
  stage: number;
  bus: number;
  rv: number;
  /** Decoys are built to match the RV's radar return */
  decoy: number;
  /** A fully bloomed chaff cloud */
  chaff: number;
}

export interface MissileSpec {
  id: string;
  name: string;
  side: 'USA' | 'USSR';
  stages: Stage[];
  bus: BusSpec;
  penaids: PenaidSpec;
  rcs: RcsSpec;
  /** Spent final-stage ballistic coefficient [kg/m^2] */
  stageBeta: number;
  /** Booster drag area Cd*A [m^2] */
  cdA: number;
  /** Re-entry vehicle ballistic coefficient m/(Cd*A) [kg/m^2]; slender RVs keep more speed */
  rvBeta: number;
  /** Seconds of vertical rise before pitch-over */
  verticalRise: number;
  /** Pitch from vertical reached at 1st-stage burnout by the open-loop program [deg] */
  stage1EndPitch: number;
  /**
   * 1-sigma velocity error per axis at burnout [m/s], lumping gyro drift,
   * accelerometer bias and platform misalignment of the inertial system.
   */
  guidanceSigma: number;
  /** Published circular error probable, for display [m] */
  cep: number;
  /** Maximum range this model's guidance achieves (min-energy, single RV) [km] */
  rangeKm: number;
}

/**
 * LGM-30G Minuteman III: three solid stages (M55, SR19, SR73) with an NS-20
 * inertial platform. Masses and burn times are public figures; vacuum Isp is
 * calibrated so the simulated guidance reaches ~11,000 km with a full bus.
 */
export const MINUTEMAN_III: MissileSpec = {
  id: 'mm3',
  name: 'LGM-30G Minuteman III',
  side: 'USA',
  stages: [
    { name: 'M55 1st stage', propellant: 20780, dry: 2292, isp: 285, burnTime: 61 },
    { name: 'SR19 2nd stage', propellant: 6237, dry: 795, isp: 300, burnTime: 66 },
    { name: 'SR73 3rd stage', propellant: 3306, dry: 431, isp: 305, burnTime: 61 },
  ],
  // Mk12A bus: 3 RVs, PSRE bipropellant engine.
  bus: { rvCount: 3, rvMass: 180, dry: 250, propellant: 110, isp: 235, firstRelease: 30, releaseInterval: 40 },
  penaids: { decoysPerRv: 2, decoyBeta: 300, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 10, stage: 3, bus: 1, rv: 0.05, decoy: 0.05, chaff: 200 },
  stageBeta: 150,
  cdA: 0.55,
  rvBeta: 12000,
  verticalRise: 8,
  stage1EndPitch: 65,
  guidanceSigma: 0.07,
  cep: 200,
  rangeKm: 11000, // published: ~13,000 km
};

/**
 * R-36M (SS-18 "Satan"): two liquid stages, very large throw-weight.
 * Liquid engines can be shut down precisely on guidance command.
 */
export const R36M: MissileSpec = {
  id: 'r36m',
  name: 'R-36M (SS-18 Satan)',
  side: 'USSR',
  stages: [
    { name: 'RD-264 1st stage', propellant: 147900, dry: 8000, isp: 318, burnTime: 120 },
    { name: 'RD-0228 2nd stage', propellant: 37600, dry: 3000, isp: 345, burnTime: 190 },
  ],
  // Mod 4 bus: 10 RVs on a large liquid-fuelled bus.
  bus: { rvCount: 10, rvMass: 450, dry: 2000, propellant: 1500, isp: 300, firstRelease: 30, releaseInterval: 25 },
  penaids: { decoysPerRv: 1, decoyBeta: 400, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 40, stage: 15, bus: 5, rv: 0.1, decoy: 0.1, chaff: 300 },
  stageBeta: 150,
  cdA: 2.4,
  rvBeta: 9000,
  verticalRise: 10,
  stage1EndPitch: 65,
  guidanceSigma: 0.1,
  cep: 400,
  rangeKm: 11000, // published: 11,000-16,000 km depending on payload
};

/** Everything above the booster stages: bus, its propellant and all RVs [kg]. */
export const payloadMass = (spec: MissileSpec): number =>
  spec.bus.dry + spec.bus.propellant + spec.bus.rvCount * spec.bus.rvMass;

export const MISSILES: MissileSpec[] = [MINUTEMAN_III, R36M];
