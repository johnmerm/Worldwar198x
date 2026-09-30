import { describe, expect, it } from 'vitest';
import { MISSILES, solveFiringSolution } from '../physics';
import { LAUNCH_SITES, targetsFor } from './sites';

const MOSCOW = { name: 'Moscow', lat: 55.7558, lon: 37.6173 };
const WASHINGTON = { name: 'Washington, D.C.', lat: 38.8977, lon: -77.0365 };

describe('silo fields', () => {
  it('only list weapons that exist and belong to their side', () => {
    for (const site of LAUNCH_SITES) {
      expect(site.weapons.length).toBeGreaterThan(0);
      for (const id of site.weapons) {
        const spec = MISSILES.find((m) => m.id === id);
        expect(spec, `${site.name}: ${id}`).toBeDefined();
        expect(spec!.side).toBe(site.side);
      }
    }
  });

  it('can hold the other capital at risk with every weapon based there', () => {
    for (const site of LAUNCH_SITES) {
      for (const id of site.weapons) {
        const spec = MISSILES.find((m) => m.id === id)!;
        const capital = site.side === 'USA' ? MOSCOW : WASHINGTON;
        const sol = solveFiringSolution(spec, site, [capital]);
        expect(sol.feasible, `${spec.short} from ${site.name} to ${capital.name}`).toBe(true);
      }
    }
    // ~30 full firing solutions: several seconds.
  }, 30_000);

  it('offers the enemy silo fields as counterforce targets', () => {
    const usTargets = targetsFor('USA').map((t) => t.name);
    expect(usTargets).toContain('Dombarovsky missile field');
    expect(usTargets).not.toContain('Minot AFB, North Dakota missile field');
    expect(targetsFor('USSR').map((t) => t.name)).toContain('Minot AFB, North Dakota missile field');
    expect(targetsFor('USSR').some((t) => t.name.includes('scenario'))).toBe(false);
  });
});
