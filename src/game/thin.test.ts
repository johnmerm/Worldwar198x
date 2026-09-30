import { describe, expect, it } from 'vitest';
import { R36M, flySolution, solveFiringSolution } from '../physics';
import { evaluateSensors } from '../sensors';
import { thinFlight, withoutTracks } from './thin';

describe('thinning a flight for the page', () => {
  const sol = solveFiringSolution(R36M, { name: 'Dombarovsky', lat: 51.09, lon: 59.84 }, [
    { name: 'Minot', lat: 48.42, lon: -101.36 },
    { name: 'Grand Forks', lat: 47.96, lon: -97.4 },
  ]);
  const sim = flySolution(sol);
  const report = evaluateSensors(sim, R36M, Date.UTC(2026, 8, 30, 12));
  const thin = thinFlight(sim, report);
  const count = (r: typeof report) => r.objects.reduce((n, o) => n + o.samples.length, 0);

  it('keeps a fraction of the points', () => {
    expect(count(thin.report)).toBeLessThan(0.6 * count(report));
  });

  it('keeps every moment radar gains or loses an object', () => {
    thin.report.objects.forEach((o, i) => {
      const full = report.objects[i];
      const edges = (x: typeof o) => x.samples.filter((_, k) => k > 0 && x.seen[k] !== x.seen[k - 1]).map((s) => s.t);
      expect(edges(o)).toEqual(edges(full));
      expect(o.samples.at(-1)!.t).toBe(full.samples.at(-1)!.t);
    });
  });

  it('keeps the flight and its sensor picture on the same arrays', () => {
    expect(thin.report.objects[0].samples).toBe(thin.sim.booster);
    expect(thin.sim.rvs[0].impact).toEqual(sim.rvs[0].impact);
  });

  it('flies a solution without its predicted tracks the same way', () => {
    const light = withoutTracks(sol);
    expect(light.nominal.booster).toHaveLength(0);
    expect(flySolution(light, () => 0.5).rvs.map((r) => r.impact?.t)).toEqual(flySolution(sol, () => 0.5).rvs.map((r) => r.impact?.t));
  });
});
