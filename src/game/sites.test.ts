import { describe, expect, it } from 'vitest';
import { BOMBERS, MISSILES, flyBomber, solveFiringSolution } from '../physics';
import { LAUNCH_SITES, targetsFor } from './sites';

const MOSCOW = { name: 'Moscow', lat: 55.7558, lon: 37.6173 };
const WASHINGTON = { name: 'Washington, D.C.', lat: 38.8977, lon: -77.0365 };

describe('silo fields', () => {
  it('only list weapons that exist and belong to their side', () => {
    for (const site of LAUNCH_SITES) {
      expect(site.weapons.length).toBeGreaterThan(0);
      for (const id of site.weapons) {
        const spec = MISSILES.find((m) => m.id === id) ?? BOMBERS.find((b) => b.id === id);
        expect(spec, `${site.name}: ${id}`).toBeDefined();
        expect(spec!.side).toBe(site.side);
        // Bombers fly from airbases; missiles from silos and submarines.
        expect(BOMBERS.includes(spec as never)).toBe(site.kind === 'airbase');
      }
    }
  });

  it('can reach the other capital from every silo field and bomber base', () => {
    for (const site of LAUNCH_SITES.filter((s) => s.kind !== 'sub')) {
      const capital = site.side === 'USA' ? MOSCOW : WASHINGTON;
      for (const id of site.weapons) {
        const bomber = BOMBERS.find((b) => b.id === id);
        const ok = bomber
          ? flyBomber(bomber, site, [capital]).feasible
          : solveFiringSolution(MISSILES.find((m) => m.id === id)!, site, [capital]).feasible;
        expect(ok, `${id} from ${site.name} to ${capital.name}`).toBe(true);
      }
    }
  });

  it('gives every submarine patrol area something within reach of each missile', () => {
    for (const site of LAUNCH_SITES.filter((s) => s.kind === 'sub')) {
      for (const id of site.weapons) {
        const spec = MISSILES.find((m) => m.id === id)!;
        const reachable = targetsFor(site.side).some((t) => solveFiringSolution(spec, site, [t]).feasible);
        expect(reachable, `${spec.short} from ${site.name}`).toBe(true);
      }
    }
  });

  it('offers the enemy silo fields as counterforce targets', () => {
    const usTargets = targetsFor('USA').map((t) => t.name);
    expect(usTargets).toContain('Dombarovsky missile field');
    expect(usTargets).not.toContain('Minot AFB, North Dakota missile field');
    expect(targetsFor('USSR').map((t) => t.name)).toContain('Minot AFB, North Dakota missile field');
    expect(targetsFor('USSR').some((t) => t.name.includes('scenario'))).toBe(false);
  });
});
