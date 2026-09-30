import { describe, expect, it } from 'vitest';
import { solveFiringSolution, vincentyInverse } from '../physics';
import { MIRV_SPREAD, randomSalvo } from './salvo';

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('random salvo', () => {
  for (const side of ['USA', 'USSR'] as const) {
    const plans = randomSalvo(side, 40, seeded(side === 'USA' ? 1 : 2));

    it(`${side}: fields its own weapons from its own fields at the enemy`, () => {
      expect(plans).toHaveLength(40);
      for (const p of plans) {
        expect(p.launch.side).toBe(side);
        expect(p.launch.scenario).toBeFalsy();
        expect(p.spec.side).toBe(side);
        expect(p.launch.weapons).toContain(p.spec.id);
        expect(p.targets).toHaveLength(p.spec.bus.rvCount);
        for (const t of p.targets) expect(t.side).not.toBe(side);
      }
    });

    it(`${side}: keeps every RV within reach of its bus`, () => {
      for (const p of plans) {
        const [primary, ...rest] = p.targets;
        for (const t of rest) expect(vincentyInverse(primary.lat, primary.lon, t.lat, t.lon).distance).toBeLessThan(MIRV_SPREAD);
      }
    });

    it(`${side}: gives the fire-control computer solvable primaries`, () => {
      for (const p of plans.slice(0, 8)) {
        const sol = solveFiringSolution(p.spec, p.launch, [p.targets[0]]);
        expect(sol.targets[0].feasible, `${p.spec.short} ${p.launch.name} -> ${p.targets[0].name}`).toBe(true);
      }
    }, 60_000);
  }

  it('is different every time unless seeded', () => {
    const a = randomSalvo('USA', 10, seeded(5));
    const b = randomSalvo('USA', 10, seeded(5));
    expect(a).toEqual(b);
  });
});
