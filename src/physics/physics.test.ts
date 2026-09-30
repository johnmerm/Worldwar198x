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
  const sol = solveFiringSolution(MINUTEMAN_III, WISCONSIN, [MOSCOW], 'minimum-energy');
  const n = sol.nominal;
  const rv = n.rvs[0];
  const t = sol.targets[0];

  it('converges onto the target', () => {
    expect(sol.feasible).toBe(true);
    expect(t.nominalMiss).toBeLessThan(10);
    expect(rv.impact!.geo.lat).toBeCloseTo(MOSCOW.lat, 3);
    expect(rv.impact!.geo.lon).toBeCloseTo(MOSCOW.lon, 3);
  });

  it('flies a realistic ICBM profile', () => {
    expect(n.burnout.t).toBeGreaterThan(150);
    expect(n.burnout.t).toBeLessThan(200);
    expect(n.burnout.speed).toBeGreaterThan(6300);
    expect(n.burnout.speed).toBeLessThan(7000);
    expect(rv.apogee.alt / 1000).toBeGreaterThan(800);
    expect(rv.apogee.alt / 1000).toBeLessThan(1400);
    expect(rv.impact!.t / 60).toBeGreaterThan(25);
    expect(rv.impact!.t / 60).toBeLessThan(33);
  });

  it('crosses the Arctic', () => {
    const maxLat = Math.max(...rv.samples.map((s) => ecefToGeodetic(s.ecef).lat));
    expect(maxLat).toBeGreaterThan(70);
  });

  it('needs J2 + drag compensation of several km', () => {
    // Pure Kepler guidance aimed at Moscow would miss by roughly this much.
    expect(t.aimOffset / 1000).toBeGreaterThan(3);
    expect(t.aimOffset / 1000).toBeLessThan(40);
  });

  it('never goes underground and lands on the ellipsoid', () => {
    for (const s of [...n.booster, ...rv.samples.slice(0, -1)]) expect(s.alt).toBeGreaterThan(-1);
    expect(Math.abs(altitude(rv.impact!.ecef))).toBeLessThan(1);
  });

  it('disperses real shots around the target at roughly the published CEP', () => {
    const rng = seeded(1983);
    const misses = Array.from({ length: 60 }, () => {
      const shot = flySolution(sol, rng);
      return norm(sub(shot.rvs[0].impact!.ecef, rv.impact!.ecef));
    }).sort((a, b) => a - b);
    const cep = misses[30];
    expect(cep).toBeGreaterThan(MINUTEMAN_III.cep * 0.5);
    expect(cep).toBeLessThan(MINUTEMAN_III.cep * 2);
    // 60 full flights: several seconds.
  }, 30_000);
});

describe('trajectory profiles', () => {
  for (const spec of [MINUTEMAN_III, R36M]) {
    it(`${spec.name}: lofted goes higher and slower than depressed`, () => {
      const lofted = solveFiringSolution(spec, WISCONSIN, [MOSCOW], 'lofted');
      const depressed = solveFiringSolution(spec, WISCONSIN, [MOSCOW], 'depressed');
      expect(lofted.feasible && depressed.feasible).toBe(true);
      expect(lofted.nominal.rvs[0].apogee.alt).toBeGreaterThan(depressed.nominal.rvs[0].apogee.alt * 2);
      expect(lofted.nominal.rvs[0].impact!.t).toBeGreaterThan(depressed.nominal.rvs[0].impact!.t);
    });
  }

  it('reports targets beyond range as infeasible', () => {
    // Wisconsin to the far side of the planet (antipode region, ~19,000 km).
    const sol = solveFiringSolution(MINUTEMAN_III, WISCONSIN, [{ name: 'Indian Ocean', lat: -44, lon: 88 }]);
    expect(sol.feasible).toBe(false);
  });
});

describe('MIRV bus', () => {
  const P = (name: string, lat: number, lon: number) => ({ name, lat, lon });

  it('Minuteman III puts three RVs on Moscow, Tula and Vladimir', () => {
    const targets = [MOSCOW, P('Tula', 54.19, 37.62), P('Vladimir', 56.13, 40.41)];
    const sol = solveFiringSolution(MINUTEMAN_III, WISCONSIN, targets);
    expect(sol.feasible).toBe(true);
    for (const t of sol.targets) expect(t.nominalMiss).toBeLessThan(10);
    const n = sol.nominal;
    expect(n.rvs.every((rv) => rv.released)).toBe(true);
    // Released one after another from the bus, above the atmosphere.
    const releases = n.rvs.map((rv) => rv.releaseT).sort((a, b) => a - b);
    expect(releases[1] - releases[0]).toBeCloseTo(MINUTEMAN_III.bus.releaseInterval, 0);
    for (const rv of n.rvs) expect(rv.samples[0].alt).toBeGreaterThan(200_000);
    expect(n.busPropellantUsed).toBeLessThanOrEqual(MINUTEMAN_III.bus.propellant);
  });

  it('downrange spread is cheap, crossrange is expensive', () => {
    // Leningrad lies ~630 km up-track of Moscow, Kiev ~760 km across it.
    const along = solveFiringSolution(MINUTEMAN_III, WISCONSIN, [MOSCOW, P('Leningrad', 59.93, 30.34)]);
    const across = solveFiringSolution(MINUTEMAN_III, WISCONSIN, [MOSCOW, P('Kiev', 50.45, 30.52)]);
    expect(along.feasible).toBe(true);
    expect(across.feasible).toBe(false);
    expect(across.targets[1].feasible).toBe(false);
    expect(across.targets[0].feasible).toBe(true); // the primary still flies
    expect(across.nominal.rvs[1].busDv).toBeGreaterThan(along.nominal.rvs[1].busDv * 2);
  });

  it('SS-18 spreads ten RVs along its track and sequences them itself', () => {
    const targets = [
      P('Minot AFB', 48.42, -101.36),
      P('Rapid City', 44.08, -103.23),
      P('Casper', 42.87, -106.31),
      P('F.E. Warren AFB', 41.13, -104.87),
      P('Denver', 39.74, -104.99),
      P('Colorado Springs', 38.83, -104.82),
      P('Cheyenne Mountain', 38.74, -104.85),
      P('Pueblo', 38.25, -104.61),
      P('Bismarck', 46.81, -100.78),
      P('Pierre', 44.37, -100.35),
    ];
    const sol = solveFiringSolution(R36M, { name: 'Dombarovsky', lat: 51.09, lon: 59.84 }, targets);
    expect(sol.targets.filter((t) => t.feasible).length).toBe(10);
    expect(new Set(sol.nominal.releaseOrder).size).toBe(10);
    expect(sol.nominal.releaseOrder[0]).toBe(0);
  });

  it('rejects more targets than the bus carries', () => {
    expect(() => solveFiringSolution(MINUTEMAN_III, WISCONSIN, [MOSCOW, MOSCOW, MOSCOW, MOSCOW])).toThrow(RangeError);
  });
});
