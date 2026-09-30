// What the warheads do on the ground, and what is left of each nation.
//
// Radii follow the cube-root scaling of Glasstone & Dolan, "The Effects of
// Nuclear Weapons" (1977), for an optimum-height airburst. Casualties use
// early-1980s metro populations spread uniformly over a disc per city. Beyond
// the cities, fallout, fires and the collapse of food, power and medicine
// grow with the megatons on a nation's soil; at COLLAPSE_MT (game scale:
// real arsenals were some fifty times larger) the nation is gone. The
// long-term toll follows the 1983 TTAPS "nuclear winter" argument: smoke from
// burning cities cools the whole hemisphere, so it falls on both sides
// whoever fired. The constants are a game abstraction, not a forecast.

import { type Vec3, ecefToGeodetic, vincentyInverse } from '../physics';
import { LAUNCH_SITES, type Side } from './sites';

export interface Burst {
  /** Unix time [ms] */
  t: number;
  ecef: Vec3;
  yieldKt: number;
}

export interface DamageRadii {
  /** Fireball [m] */
  fireball: number;
  /** 5 psi overpressure: most buildings destroyed [m] */
  severe: number;
  /** Third-degree burns on exposed skin; fires start [m] */
  thermal: number;
  /** 1 psi: windows out, light damage [m] */
  light: number;
}

export function damageRadii(yieldKt: number): DamageRadii {
  const mt = yieldKt / 1000;
  return {
    fireball: 1_000 * mt ** 0.4,
    severe: 7_000 * mt ** (1 / 3),
    thermal: 11_000 * mt ** 0.41,
    light: 19_000 * mt ** (1 / 3),
  };
}

export interface City {
  side: Side;
  name: string;
  lat: number;
  lon: number;
  /** Metro population, early 1980s [millions] */
  pop: number;
}

/** National population, 1980 census / 1979 Soviet census [millions]. */
export const NATIONAL_POP: Record<Side, number> = { USA: 227, USSR: 262 };

export const CITIES: City[] = [
  { side: 'USA', name: 'New York', lat: 40.7128, lon: -74.006, pop: 16.1 },
  { side: 'USA', name: 'Los Angeles', lat: 34.0522, lon: -118.2437, pop: 11.5 },
  { side: 'USA', name: 'Chicago', lat: 41.8781, lon: -87.6298, pop: 7.9 },
  { side: 'USA', name: 'Philadelphia', lat: 39.9526, lon: -75.1652, pop: 5.7 },
  { side: 'USA', name: 'San Francisco', lat: 37.7749, lon: -122.4194, pop: 5.4 },
  { side: 'USA', name: 'Detroit', lat: 42.3314, lon: -83.0458, pop: 4.8 },
  { side: 'USA', name: 'Boston', lat: 42.3601, lon: -71.0589, pop: 4.0 },
  { side: 'USA', name: 'Washington, D.C.', lat: 38.8977, lon: -77.0365, pop: 3.3 },
  { side: 'USA', name: 'Houston', lat: 29.7604, lon: -95.3698, pop: 3.1 },
  { side: 'USA', name: 'Dallas', lat: 32.7767, lon: -96.797, pop: 3.0 },
  { side: 'USA', name: 'Cleveland', lat: 41.4993, lon: -81.6944, pop: 2.8 },
  { side: 'USA', name: 'Miami', lat: 25.7617, lon: -80.1918, pop: 2.6 },
  { side: 'USA', name: 'St. Louis', lat: 38.627, lon: -90.1994, pop: 2.4 },
  { side: 'USA', name: 'Pittsburgh', lat: 40.4406, lon: -79.9959, pop: 2.4 },
  { side: 'USA', name: 'Atlanta', lat: 33.749, lon: -84.388, pop: 2.1 },
  { side: 'USA', name: 'Seattle', lat: 47.6062, lon: -122.3321, pop: 2.1 },
  { side: 'USA', name: 'Minneapolis', lat: 44.9778, lon: -93.265, pop: 2.1 },
  { side: 'USA', name: 'Denver', lat: 39.7392, lon: -104.9903, pop: 1.6 },
  { side: 'USA', name: 'Norfolk', lat: 36.8508, lon: -76.2859, pop: 1.2 },
  { side: 'USA', name: 'Omaha', lat: 41.2565, lon: -95.9345, pop: 0.6 },
  { side: 'USA', name: 'Colorado Springs', lat: 38.8339, lon: -104.8214, pop: 0.3 },
  { side: 'USSR', name: 'Moscow', lat: 55.7558, lon: 37.6173, pop: 8.0 },
  { side: 'USSR', name: 'Leningrad', lat: 59.9343, lon: 30.3351, pop: 4.6 },
  { side: 'USSR', name: 'Kiev', lat: 50.4501, lon: 30.5234, pop: 2.1 },
  { side: 'USSR', name: 'Tashkent', lat: 41.2995, lon: 69.2401, pop: 1.8 },
  { side: 'USSR', name: 'Baku', lat: 40.4093, lon: 49.8671, pop: 1.5 },
  { side: 'USSR', name: 'Kharkov', lat: 49.9935, lon: 36.2304, pop: 1.4 },
  { side: 'USSR', name: 'Minsk', lat: 53.9006, lon: 27.559, pop: 1.3 },
  { side: 'USSR', name: 'Gorky', lat: 56.2965, lon: 43.9361, pop: 1.3 },
  { side: 'USSR', name: 'Novosibirsk', lat: 55.0084, lon: 82.9357, pop: 1.3 },
  { side: 'USSR', name: 'Sverdlovsk', lat: 56.8389, lon: 60.6057, pop: 1.2 },
  { side: 'USSR', name: 'Kuibyshev', lat: 53.1959, lon: 50.1002, pop: 1.2 },
  { side: 'USSR', name: 'Dnepropetrovsk', lat: 48.4647, lon: 35.0462, pop: 1.1 },
  { side: 'USSR', name: 'Tbilisi', lat: 41.7151, lon: 44.8271, pop: 1.1 },
  { side: 'USSR', name: 'Odessa', lat: 46.4825, lon: 30.7233, pop: 1.0 },
  { side: 'USSR', name: 'Chelyabinsk', lat: 55.1644, lon: 61.4368, pop: 1.0 },
  { side: 'USSR', name: 'Donetsk', lat: 48.0159, lon: 37.8028, pop: 1.0 },
  { side: 'USSR', name: 'Vladivostok', lat: 43.1198, lon: 131.8869, pop: 0.6 },
  { side: 'USSR', name: 'Tula', lat: 54.1931, lon: 37.6173, pop: 0.5 },
  { side: 'USSR', name: 'Kalinin', lat: 56.8587, lon: 35.9176, pop: 0.4 },
  { side: 'USSR', name: 'Murmansk', lat: 68.9585, lon: 33.0827, pop: 0.4 },
  { side: 'USSR', name: 'Vladimir', lat: 56.1291, lon: 40.4066, pop: 0.3 },
];

/** Radius of a city's built-up disc [m]: about 8 km per sqrt(million people). */
export const cityRadius = (c: City) => 8_000 * Math.sqrt(c.pop);

/** Fraction killed inside the 5 psi / thermal zone, and between it and the 1 psi ring. */
const LETHAL_KILL = 0.9;
const LIGHT_KILL = 0.25;
/** Megatons on a nation's soil that end it: everyone outside the cities is lost to fallout, fire and collapse. */
export const COLLAPSE_MT = 100;
/** Burned-out urban population [millions] that brings full nuclear winter. */
const WINTER_FULL_M = 40;
/** Fraction of survivors lost to famine and cold in a full nuclear winter. */
const WINTER_TOLL = 0.9;

/** Area of the intersection of two discs of radii r1, r2 whose centres are d apart. */
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}

const groundDistance = (ecef: Vec3, lat: number, lon: number) => {
  const g = ecefToGeodetic(ecef);
  return vincentyInverse(g.lat, g.lon, lat, lon).distance;
};

/** Fraction of a city's people killed by one burst. */
export function cityKill(c: City, b: Burst): number {
  const d = groundDistance(b.ecef, c.lat, c.lon);
  const rc = cityRadius(c);
  const r = damageRadii(b.yieldKt);
  const lethalR = Math.max(r.severe, r.thermal);
  const area = Math.PI * rc * rc;
  const lethal = lensArea(rc, lethalR, d) / area;
  const light = lensArea(rc, r.light, d) / area - lethal;
  return LETHAL_KILL * lethal + LIGHT_KILL * Math.max(0, light);
}

/** Whose soil a burst fell on: the side of the nearest city or silo field within 1,500 km. */
export function territoryOf(ecef: Vec3): Side | null {
  let best: { side: Side; d: number } | null = null;
  for (const p of [...CITIES, ...LAUNCH_SITES]) {
    const d = groundDistance(ecef, p.lat, p.lon);
    if (!best || d < best.d) best = { side: p.side, d };
  }
  return best && best.d < 1_500_000 ? best.side : null;
}

export interface NationHealth {
  /** Population alive now [millions] */
  alive: number;
  /** Alive a year on, after the nuclear winter [millions] */
  projected: number;
  total: number;
  /** Cities with at least 1% of their people killed, worst first */
  cities: { name: string; killed: number }[];
}

export interface WorldHealth {
  nations: Record<Side, NationHealth>;
  /** Urban population burned out, both sides [millions]: the smoke that makes the winter */
  burned: number;
  /** 0 (none) .. 1 (full nuclear winter) */
  winter: number;
  megatons: number;
}

/**
 * When each nation reached zero [unix ms], or null. Bursts are taken in time
 * order, so every window holding the same bursts gets the same answer.
 */
export function collapseTimes(bursts: Burst[]): Record<Side, number | null> {
  const sorted = [...bursts].sort((a, b) => a.t - b.t);
  const out: Record<Side, number | null> = { USA: null, USSR: null };
  for (let i = 0; i < sorted.length; i++) {
    const w = assessDamage(sorted.slice(0, i + 1));
    for (const s of ['USA', 'USSR'] as Side[]) if (out[s] === null && w.nations[s].alive <= 0) out[s] = sorted[i].t;
  }
  return out;
}

/** The state of both nations after the given bursts. Same bursts, same answer, in either window. */
export function assessDamage(bursts: Burst[]): WorldHealth {
  const survivors = CITIES.map(() => 1);
  let burned = 0;
  const mtOn: Record<Side, number> = { USA: 0, USSR: 0 };
  let megatons = 0;
  for (const b of bursts) {
    megatons += b.yieldKt / 1000;
    const side = territoryOf(b.ecef);
    if (side) mtOn[side] += b.yieldKt / 1000;
    CITIES.forEach((c, i) => {
      const k = cityKill(c, b);
      if (k <= 0) return;
      burned += c.pop * survivors[i] * k;
      survivors[i] *= 1 - k;
    });
  }
  const winter = Math.min(1, burned / WINTER_FULL_M);
  const nation = (side: Side): NationHealth => {
    const total = NATIONAL_POP[side];
    let dead = 0;
    const cities: NationHealth['cities'] = [];
    CITIES.forEach((c, i) => {
      if (c.side !== side) return;
      const killed = c.pop * (1 - survivors[i]);
      dead += killed;
      if (killed >= 0.01 * c.pop) cities.push({ name: c.name, killed });
    });
    const collapse = Math.min(1, mtOn[side] / COLLAPSE_MT) * (total - dead);
    const alive = Math.max(0, total - dead - collapse);
    return {
      alive,
      projected: alive * (1 - WINTER_TOLL * winter),
      total,
      cities: cities.sort((a, b) => b.killed - a.killed),
    };
  };
  return { nations: { USA: nation('USA'), USSR: nation('USSR') }, burned, winter, megatons };
}

/** A red glow on the globe as seen from orbit: fires, smoke and a dying country. */
export interface ScorchSpot {
  lat: number;
  lon: number;
  /** [km] */
  radius: number;
  /** 0..1 */
  intensity: number;
}

/**
 * What the planet looks like from space. Each burst leaves a fire and smoke
 * plume far wider than its blast; as a nation dies, glows spread from all its
 * cities and silo fields until its land is red. `haze` tints the whole planet
 * as the nuclear winter builds.
 */
export function scorchMap(bursts: Burst[], w: WorldHealth): { spots: ScorchSpot[]; haze: number } {
  const spots: ScorchSpot[] = bursts.map((b) => {
    const g = ecefToGeodetic(b.ecef);
    return { lat: g.lat, lon: g.lon, radius: 250 * (b.yieldKt / 1000) ** (1 / 3), intensity: 0.9 };
  });
  for (const side of ['USA', 'USSR'] as Side[]) {
    const n = w.nations[side];
    const loss = 1 - n.alive / n.total;
    if (loss < 0.01) continue;
    for (const p of [...CITIES, ...LAUNCH_SITES]) {
      if (p.side === side) spots.push({ lat: p.lat, lon: p.lon, radius: 250 + 650 * loss, intensity: 0.85 * loss });
    }
  }
  return { spots, haze: 0.35 * w.winter };
}
