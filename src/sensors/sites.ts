import { DEG, OMEGA_EARTH } from '../physics/constants';
import { geodeticToEcef } from '../physics/wgs84';
import { type KeplerOrbit, gmst, semiMajorAxis } from './orbits';

export type Side = 'USA' | 'USSR';

export interface Radar {
  id: string;
  name: string;
  side: Side;
  lat: number;
  lon: number;
  /** Centre of the coverage sector [deg from north] and half-width [deg]; 180 = all round */
  boresight: number;
  halfWidth: number;
  /** Detection range against a 1 m^2 target [m]; scales with RCS^(1/4) */
  range1m2: number;
  /** Lowest usable elevation [deg] */
  minElevation: number;
}

/**
 * Early-warning radars of the early 1980s (approximate positions and
 * coverage). Ranges follow the radar equation: R ~ RCS^(1/4).
 */
export const RADARS: Radar[] = [
  { id: 'thule', name: 'Thule BMEWS', side: 'USA', lat: 76.531, lon: -68.703, boresight: 0, halfWidth: 60, range1m2: 4_800_000, minElevation: 2 },
  { id: 'clear', name: 'Clear BMEWS', side: 'USA', lat: 64.29, lon: -149.19, boresight: 320, halfWidth: 60, range1m2: 4_800_000, minElevation: 2 },
  { id: 'fylingdales', name: 'Fylingdales BMEWS', side: 'USA', lat: 54.36, lon: -0.67, boresight: 50, halfWidth: 60, range1m2: 4_800_000, minElevation: 2 },
  { id: 'capecod', name: 'Cape Cod PAVE PAWS', side: 'USA', lat: 41.75, lon: -70.54, boresight: 60, halfWidth: 60, range1m2: 5_500_000, minElevation: 3 },
  { id: 'beale', name: 'Beale PAVE PAWS', side: 'USA', lat: 39.14, lon: -121.35, boresight: 300, halfWidth: 60, range1m2: 5_500_000, minElevation: 3 },
  { id: 'cavalier', name: 'Cavalier PARCS', side: 'USA', lat: 48.72, lon: -97.9, boresight: 8, halfWidth: 65, range1m2: 3_300_000, minElevation: 2 },
  { id: 'pechora', name: 'Pechora Daryal', side: 'USSR', lat: 65.21, lon: 57.3, boresight: 0, halfWidth: 55, range1m2: 6_000_000, minElevation: 2 },
  { id: 'olenegorsk', name: 'Olenegorsk Dnepr', side: 'USSR', lat: 68.11, lon: 33.91, boresight: 330, halfWidth: 45, range1m2: 4_000_000, minElevation: 2 },
  { id: 'skrunda', name: 'Skrunda Dnepr', side: 'USSR', lat: 56.72, lon: 21.97, boresight: 300, halfWidth: 45, range1m2: 4_000_000, minElevation: 2 },
  { id: 'mishelevka', name: 'Mishelevka Dnepr', side: 'USSR', lat: 52.87, lon: 103.23, boresight: 60, halfWidth: 50, range1m2: 4_000_000, minElevation: 2 },
  { id: 'sevastopol', name: 'Sevastopol Dnepr', side: 'USSR', lat: 44.58, lon: 33.39, boresight: 230, halfWidth: 45, range1m2: 4_000_000, minElevation: 2 },
  { id: 'moscow', name: 'Moscow ABM (Don-2N)', side: 'USSR', lat: 56.17, lon: 37.77, boresight: 0, halfWidth: 180, range1m2: 2_000_000, minElevation: 3 },
];

export const radarEcef = (r: Radar) => geodeticToEcef(r.lat, r.lon, 0);

export interface Satellite {
  id: string;
  name: string;
  side: Side;
  /** 'look-down' sees plumes against the Earth; 'limb' only against space (Oko) */
  sensor: 'look-down' | 'limb';
  /** Geostationary longitude [deg], or a Kepler orbit */
  geoLon?: number;
  orbit?: KeplerOrbit;
}

/** US Defense Support Program: IR telescopes in geostationary orbit. */
const DSP: Satellite[] = [
  { id: 'dsp-io', name: 'DSP Indian Ocean', side: 'USA', sensor: 'look-down', geoLon: 69 },
  { id: 'dsp-atl', name: 'DSP Atlantic', side: 'USA', sensor: 'look-down', geoLon: -35 },
  { id: 'dsp-pac', name: 'DSP Pacific', side: 'USA', sensor: 'look-down', geoLon: -135 },
];

/**
 * Soviet Oko (US-K): nine satellites in 12-hour Molniya orbits whose apogees
 * repeat over the same two longitudes, so that one of them always watches US
 * silo fields near the Earth's limb. Their early IR sensors could only pick
 * out a plume against the black of space, not against the Earth.
 */
const OKO_EPOCH = Date.UTC(1983, 8, 26); // the night of the Serpukhov-15 false alarm
/** Longitude of one apogee; the other lies 180 deg away. */
export const OKO_APOGEE_LON = -24;
const halfSiderealDay = Math.PI / OMEGA_EARTH;
const OKO: Satellite[] = Array.from({ length: 9 }, (_, k) => ({
  id: `oko-${k + 1}`,
  name: `Oko-${k + 1}`,
  side: 'USSR',
  sensor: 'limb',
  orbit: {
    a: semiMajorAxis(halfSiderealDay),
    e: 0.72,
    i: 63.4,
    // With argp 270 deg the apogee is the orbit's northernmost point, at
    // inertial longitude raan + 90 deg. Satellite 0 is at apogee at epoch;
    // each next one is 40 deg on in node and 80 deg back in anomaly, so it
    // reaches the same apogee point 2h40m later: continuous coverage.
    raan: OKO_APOGEE_LON + gmst(OKO_EPOCH) / DEG - 90 + 40 * k,
    argp: 270,
    m0: 180 - 80 * k,
    epochMs: OKO_EPOCH,
  },
}));

export const SATELLITES: Satellite[] = [...DSP, ...OKO];

export const GEO_RADIUS = semiMajorAxis(2 * halfSiderealDay);
