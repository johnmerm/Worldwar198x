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
  /** Short tag for flights, e.g. 'MM-III' */
  short: string;
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
  short: 'MM-III',
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
  short: 'SS-18',
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

/** Single-warhead missiles still get a "bus": the guidance section, with no propellant to retarget. */
const SINGLE_RV = { firstRelease: 20, releaseInterval: 20, propellant: 0, isp: 250, rvCount: 1 } as const;

/** LGM-30F Minuteman II: M55 / SR19 / M57 solids, one Mk11C RV. */
export const MINUTEMAN_II: MissileSpec = {
  id: 'mm2',
  short: 'MM-II',
  name: 'LGM-30F Minuteman II',
  side: 'USA',
  stages: [
    { name: 'M55 1st stage', propellant: 20780, dry: 2292, isp: 285, burnTime: 61 },
    { name: 'SR19 2nd stage', propellant: 6237, dry: 795, isp: 300, burnTime: 66 },
    { name: 'M57 3rd stage', propellant: 1660, dry: 350, isp: 300, burnTime: 60 },
  ],
  bus: { ...SINGLE_RV, rvMass: 450, dry: 150 },
  penaids: { decoysPerRv: 2, decoyBeta: 300, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 10, stage: 2, bus: 0.5, rv: 0.08, decoy: 0.08, chaff: 200 },
  stageBeta: 150,
  cdA: 0.55,
  rvBeta: 9000,
  verticalRise: 8,
  stage1EndPitch: 55,
  guidanceSigma: 0.12,
  cep: 370,
  rangeKm: 12000, // published: 11,300 km
};

/** LGM-25C Titan II: two hypergolic liquid stages, one 9 Mt Mk6 RV. Retired 1987. */
export const TITAN_II: MissileSpec = {
  id: 'titan2',
  short: 'TITAN-II',
  name: 'LGM-25C Titan II',
  side: 'USA',
  stages: [
    { name: 'LR87 1st stage', propellant: 118000, dry: 4300, isp: 296, burnTime: 156 },
    { name: 'LR91 2nd stage', propellant: 27000, dry: 2300, isp: 316, burnTime: 180 },
  ],
  bus: { ...SINGLE_RV, rvMass: 3700, dry: 200 },
  penaids: { decoysPerRv: 2, decoyBeta: 300, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 40, stage: 12, bus: 1, rv: 0.5, decoy: 0.5, chaff: 300 },
  stageBeta: 150,
  cdA: 2.5,
  rvBeta: 6000,
  verticalRise: 10,
  stage1EndPitch: 65,
  guidanceSigma: 0.45,
  cep: 1300,
  rangeKm: 13000, // published: 15,000 km
};

/** LGM-118A Peacekeeper (MX), from 1986: three solid stages and a liquid bus with 10 Mk21 RVs. */
export const PEACEKEEPER: MissileSpec = {
  id: 'mx',
  short: 'MX',
  name: 'LGM-118A Peacekeeper',
  side: 'USA',
  stages: [
    { name: 'SR118 1st stage', propellant: 44300, dry: 4000, isp: 308, burnTime: 57 },
    { name: 'SR119 2nd stage', propellant: 24200, dry: 2000, isp: 324, burnTime: 61 },
    { name: 'SR120 3rd stage', propellant: 7000, dry: 900, isp: 324, burnTime: 72 },
  ],
  bus: { rvCount: 10, rvMass: 250, dry: 1000, propellant: 450, isp: 300, firstRelease: 30, releaseInterval: 25 },
  penaids: { decoysPerRv: 1, decoyBeta: 300, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 20, stage: 4, bus: 2, rv: 0.04, decoy: 0.04, chaff: 200 },
  stageBeta: 150,
  cdA: 1.2,
  rvBeta: 14000,
  verticalRise: 8,
  stage1EndPitch: 65,
  guidanceSigma: 0.04,
  cep: 100,
  rangeKm: 10000, // published: 9,600 km
};

/** UR-100N (SS-19 Stiletto): two liquid stages, six RVs. */
export const UR100N: MissileSpec = {
  id: 'ur100n',
  short: 'SS-19',
  name: 'UR-100N (SS-19 Stiletto)',
  side: 'USSR',
  stages: [
    { name: 'RD-0233 1st stage', propellant: 77000, dry: 5000, isp: 329, burnTime: 120 },
    { name: 'RD-0235 2nd stage', propellant: 14000, dry: 1500, isp: 350, burnTime: 180 },
  ],
  bus: { rvCount: 6, rvMass: 350, dry: 1500, propellant: 750, isp: 300, firstRelease: 30, releaseInterval: 30 },
  penaids: { decoysPerRv: 1, decoyBeta: 400, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 30, stage: 10, bus: 3, rv: 0.1, decoy: 0.1, chaff: 300 },
  stageBeta: 150,
  cdA: 1.9,
  rvBeta: 9000,
  verticalRise: 10,
  stage1EndPitch: 75,
  guidanceSigma: 0.1,
  cep: 350,
  rangeKm: 10000,
};

/** MR-UR-100 (SS-17 Spanker): two liquid stages, four RVs. */
export const MR_UR100: MissileSpec = {
  id: 'mrur100',
  short: 'SS-17',
  name: 'MR-UR-100 (SS-17 Spanker)',
  side: 'USSR',
  stages: [
    { name: '15D83 1st stage', propellant: 53000, dry: 4000, isp: 322, burnTime: 120 },
    { name: '15D84 2nd stage', propellant: 9000, dry: 1200, isp: 343, burnTime: 150 },
  ],
  bus: { rvCount: 4, rvMass: 400, dry: 700, propellant: 250, isp: 300, firstRelease: 30, releaseInterval: 30 },
  penaids: { decoysPerRv: 1, decoyBeta: 400, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 25, stage: 8, bus: 2, rv: 0.1, decoy: 0.1, chaff: 300 },
  stageBeta: 150,
  cdA: 1.9,
  rvBeta: 9000,
  verticalRise: 10,
  stage1EndPitch: 75,
  guidanceSigma: 0.19,
  cep: 420,
  rangeKm: 10000,
};

/** UR-100 (SS-11 Sego): the most numerous Soviet ICBM of the 1970s, one RV. */
export const UR100: MissileSpec = {
  id: 'ur100',
  short: 'SS-11',
  name: 'UR-100 (SS-11 Sego)',
  side: 'USSR',
  stages: [
    { name: '8D84 1st stage', propellant: 30000, dry: 2500, isp: 300, burnTime: 100 },
    { name: '8D84 2nd stage', propellant: 7000, dry: 800, isp: 320, burnTime: 150 },
  ],
  bus: { ...SINGLE_RV, rvMass: 900, dry: 150 },
  penaids: { decoysPerRv: 1, decoyBeta: 400, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 15, stage: 5, bus: 1, rv: 0.2, decoy: 0.2, chaff: 300 },
  stageBeta: 150,
  cdA: 1.6,
  rvBeta: 7000,
  verticalRise: 10,
  stage1EndPitch: 65,
  guidanceSigma: 0.35,
  cep: 1100,
  rangeKm: 10300, // published: 10,600 km
};

/** UGM-73 Poseidon C3 (SLBM): two solid stages, up to 10 small Mk3 RVs. Stellar-aided inertial guidance. */
export const POSEIDON: MissileSpec = {
  id: 'poseidon',
  short: 'C3',
  name: 'UGM-73 Poseidon C3',
  side: 'USA',
  stages: [
    { name: 'Poseidon 1st stage', propellant: 15500, dry: 1500, isp: 285, burnTime: 55 },
    { name: 'Poseidon 2nd stage', propellant: 6500, dry: 700, isp: 295, burnTime: 60 },
  ],
  bus: { rvCount: 10, rvMass: 80, dry: 400, propellant: 200, isp: 280, firstRelease: 25, releaseInterval: 20 },
  penaids: { decoysPerRv: 1, decoyBeta: 300, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 8, stage: 2, bus: 1, rv: 0.03, decoy: 0.03, chaff: 200 },
  stageBeta: 150,
  cdA: 0.8,
  rvBeta: 9000,
  verticalRise: 8,
  stage1EndPitch: 65,
  guidanceSigma: 0.2,
  cep: 550,
  rangeKm: 4600,
};

/** UGM-96 Trident I C4 (SLBM), from 1979: three solid stages, eight Mk4 RVs, stellar-inertial guidance. */
export const TRIDENT_I: MissileSpec = {
  id: 'trident1',
  short: 'C4',
  name: 'UGM-96 Trident I C4',
  side: 'USA',
  stages: [
    { name: 'Trident 1st stage', propellant: 17500, dry: 1500, isp: 290, burnTime: 65 },
    { name: 'Trident 2nd stage', propellant: 8000, dry: 700, isp: 300, burnTime: 65 },
    { name: 'Trident 3rd stage', propellant: 2000, dry: 250, isp: 300, burnTime: 40 },
  ],
  bus: { rvCount: 8, rvMass: 90, dry: 400, propellant: 200, isp: 280, firstRelease: 25, releaseInterval: 20 },
  penaids: { decoysPerRv: 1, decoyBeta: 300, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 8, stage: 2, bus: 1, rv: 0.03, decoy: 0.03, chaff: 200 },
  stageBeta: 150,
  cdA: 0.8,
  rvBeta: 10000,
  verticalRise: 8,
  stage1EndPitch: 55,
  guidanceSigma: 0.13,
  cep: 380,
  rangeKm: 7400,
};

/** R-29 (SS-N-8 Sawfly) SLBM on Delta I/II submarines: two liquid stages, one RV, stellar-inertial guidance. */
export const R29: MissileSpec = {
  id: 'r29',
  short: 'SS-N-8',
  name: 'R-29 (SS-N-8 Sawfly)',
  side: 'USSR',
  stages: [
    { name: 'R-29 1st stage', propellant: 22000, dry: 2000, isp: 312, burnTime: 90 },
    { name: 'R-29 2nd stage', propellant: 5500, dry: 700, isp: 333, burnTime: 120 },
  ],
  bus: { ...SINGLE_RV, rvMass: 1100, dry: 150 },
  penaids: { decoysPerRv: 1, decoyBeta: 400, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 12, stage: 4, bus: 1, rv: 0.2, decoy: 0.2, chaff: 300 },
  stageBeta: 150,
  cdA: 1.4,
  rvBeta: 7000,
  verticalRise: 10,
  stage1EndPitch: 65,
  guidanceSigma: 0.3,
  cep: 900,
  rangeKm: 7800,
};

/** R-29R (SS-N-18 Stingray) SLBM on Delta III submarines: two liquid stages, three RVs. */
export const R29R: MissileSpec = {
  id: 'r29r',
  short: 'SS-N-18',
  name: 'R-29R (SS-N-18 Stingray)',
  side: 'USSR',
  stages: [
    { name: 'R-29R 1st stage', propellant: 23500, dry: 2000, isp: 312, burnTime: 90 },
    { name: 'R-29R 2nd stage', propellant: 6000, dry: 700, isp: 333, burnTime: 120 },
  ],
  bus: { rvCount: 3, rvMass: 350, dry: 450, propellant: 150, isp: 290, firstRelease: 25, releaseInterval: 25 },
  penaids: { decoysPerRv: 1, decoyBeta: 400, chaffPerRv: 1, chaffBeta: 1, chaffExpansion: 5, separation: 2 },
  rcs: { booster: 12, stage: 4, bus: 1, rv: 0.15, decoy: 0.15, chaff: 300 },
  stageBeta: 150,
  cdA: 1.4,
  rvBeta: 8000,
  verticalRise: 10,
  stage1EndPitch: 65,
  guidanceSigma: 0.3,
  cep: 900,
  rangeKm: 6500,
};

/** Everything above the booster stages: bus, its propellant and all RVs [kg]. */
export const payloadMass = (spec: MissileSpec): number =>
  spec.bus.dry + spec.bus.propellant + spec.bus.rvCount * spec.bus.rvMass;

export const MISSILES: MissileSpec[] = [
  MINUTEMAN_III,
  MINUTEMAN_II,
  PEACEKEEPER,
  TITAN_II,
  POSEIDON,
  TRIDENT_I,
  R36M,
  UR100N,
  MR_UR100,
  UR100,
  R29,
  R29R,
];
