import { describe, expect, it } from 'vitest';
import {
  MINUTEMAN_III,
  R36M,
  RE,
  RP,
  altitude,
  ecefToGeodetic,
  flySolution,
  geodeticToEcef,
  lambert,
  norm,
  solveFiringSolution,
  sub,
  vincentyInverse,
} from './index';

const WISCONSIN = { name: 'Rural Wisconsin', lat: 44.5, lon: -90.0 };
const MOSCOW = { name: 'Moscow', lat: 55.7558, lon: 37.6173 };

/** Deterministic PRNG (mulberry32) so dispersion tests are reproducible. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('WGS-84 ellipsoid', () => {
  it('has the right equatorial and polar radii', () => {
    expect(norm(geodeticToEcef(0, 0, 0))).toBeCloseTo(RE, 3);
    expect(norm(geodeticToEcef(90, 0, 0))).toBeCloseTo(RP, 3);
    expect(RE - RP).toBeCloseTo(21384.7, 0);
  });

  it('round-trips geodetic <-> ECEF to sub-millimetre', () => {
    for (const [lat, lon, h] of [
      [44.5, -90, 0],
      [55.7558, 37.6173, 150],
      [-33.9, 151.2, 1_000_000],
      [89.99, 10, 5000],
    ]) {
      const g = ecefToGeodetic(geodeticToEcef(lat, lon, h));
      expect(g.lat).toBeCloseTo(lat, 9);
      expect(g.lon).toBeCloseTo(lon, 9);
      expect(g.h).toBeCloseTo(h, 3);
    }
  });

  it('measures Wisconsin -> Moscow along the ellipsoid', () => {
    const { distance, azimuth } = vincentyInverse(WISCONSIN.lat, WISCONSIN.lon, MOSCOW.lat, MOSCOW.lon);
    expect(distance / 1000).toBeCloseTo(7858, -1);
    expect(azimuth).toBeCloseTo(28.2, 0);
  });
});

describe('Lambert solver', () => {
  it('matches Curtis example 5.2 (orbital mechanics textbook)', () => {
    const mu = 398600; // km^3/s^2
    const sol = lambert([5000, 10000, 2100], [-14600, 2500, 7000], 3600, mu)!;
    expect(sol.v1[0]).toBeCloseTo(-5.9925, 3);
    expect(sol.v1[1]).toBeCloseTo(1.9254, 3);
    expect(sol.v1[2]).toBeCloseTo(3.2456, 3);
    expect(sol.v2[0]).toBeCloseTo(-3.3125, 3);
    expect(sol.v2[1]).toBeCloseTo(-4.1966, 3);
    expect(sol.v2[2]).toBeCloseTo(-0.38529, 3);
  });
});

describe('Wisconsin -> Moscow firing solution', () => {
  const sol = solveFiringSolution(MINUTEMAN_III, WISCONSIN, MOSCOW, 'minimum-energy');
  const n = sol.nominal;

  it('converges onto the target', () => {
    expect(sol.feasible).toBe(true);
    expect(sol.nominalMiss).toBeLessThan(10);
    expect(n.impact!.geo.lat).toBeCloseTo(MOSCOW.lat, 3);
    expect(n.impact!.geo.lon).toBeCloseTo(MOSCOW.lon, 3);
  });

  it('flies a realistic ICBM profile', () => {
    expect(n.burnout.t).toBeGreaterThan(150);
    expect(n.burnout.t).toBeLessThan(200);
    expect(n.burnout.speed).toBeGreaterThan(6300);
    expect(n.burnout.speed).toBeLessThan(7000);
    expect(n.apogee.alt / 1000).toBeGreaterThan(800);
    expect(n.apogee.alt / 1000).toBeLessThan(1400);
    expect(n.impact!.t / 60).toBeGreaterThan(25);
    expect(n.impact!.t / 60).toBeLessThan(33);
  });

  it('crosses the Arctic', () => {
    const maxLat = Math.max(...n.samples.map((s) => ecefToGeodetic(s.ecef).lat));
    expect(maxLat).toBeGreaterThan(70);
  });

  it('needs J2 + drag compensation of several km', () => {
    // Pure Kepler guidance aimed at Moscow would miss by roughly this much.
    expect(sol.aimOffset / 1000).toBeGreaterThan(3);
    expect(sol.aimOffset / 1000).toBeLessThan(40);
  });

  it('never goes underground and lands on the ellipsoid', () => {
    for (const s of n.samples.slice(0, -1)) expect(s.alt).toBeGreaterThan(-1);
    expect(Math.abs(altitude(n.impact!.ecef))).toBeLessThan(1);
  });

  it('disperses real shots around the target at roughly the published CEP', () => {
    const rng = seeded(1983);
    const misses = Array.from({ length: 60 }, () => {
      const shot = flySolution(sol, rng);
      return norm(sub(shot.impact!.ecef, n.impact!.ecef));
    }).sort((a, b) => a - b);
    const cep = misses[30];
    expect(cep).toBeGreaterThan(MINUTEMAN_III.cep * 0.5);
    expect(cep).toBeLessThan(MINUTEMAN_III.cep * 2);
  });
});

describe('trajectory profiles', () => {
  for (const spec of [MINUTEMAN_III, R36M]) {
    it(`${spec.name}: lofted goes higher and slower than depressed`, () => {
      const lofted = solveFiringSolution(spec, WISCONSIN, MOSCOW, 'lofted');
      const depressed = solveFiringSolution(spec, WISCONSIN, MOSCOW, 'depressed');
      expect(lofted.feasible && depressed.feasible).toBe(true);
      expect(lofted.nominal.apogee.alt).toBeGreaterThan(depressed.nominal.apogee.alt * 2);
      expect(lofted.nominal.impact!.t).toBeGreaterThan(depressed.nominal.impact!.t);
    });
  }

  it('reports targets beyond range as infeasible', () => {
    // Wisconsin to the far side of the planet (antipode region, ~19,000 km).
    const sol = solveFiringSolution(MINUTEMAN_III, WISCONSIN, { name: 'Indian Ocean', lat: -44, lon: 88 });
    expect(sol.feasible).toBe(false);
  });
});
