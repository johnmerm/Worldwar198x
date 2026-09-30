// Lighter copies of flights and solutions for passing between threads and
// keeping dozens of them in memory.

import type { FiringSolution, SimResult, TrajectorySample } from '../physics';
import type { SensorReport, TrackedObject } from '../sensors';

/** Spacing of the points sent back [s]. The physics steps down to 0.1 s; the page draws and reports every 4 s. */
const KEEP_EVERY_S = 4;

/** Thin a tracked object, keeping every point where radar gains or loses it. */
export function thinTracked(o: TrackedObject): TrackedObject {
  const samples: TrajectorySample[] = [];
  const seen: boolean[] = [];
  let last = -Infinity;
  const n = o.samples.length;
  o.samples.forEach((s, i) => {
    const edge = i === 0 || i === n - 1 || o.seen[i] !== o.seen[i - 1] || o.seen[i] !== o.seen[i + 1];
    if (edge || s.t - last >= KEEP_EVERY_S) {
      samples.push(s);
      seen.push(o.seen[i]);
      last = s.t;
    }
  });
  return { ...o, samples, seen };
}

/** The flight and the enemy's view of it, thinned consistently (they share sample arrays). */
export function thinFlight(sim: SimResult, report: SensorReport): { sim: SimResult; report: SensorReport } {
  const objects = report.objects.map(thinTracked);
  const thinned = new Map(report.objects.map((o, i) => [o.samples, objects[i].samples]));
  const get = (a: TrajectorySample[]) => thinned.get(a) ?? a;
  return {
    sim: {
      ...sim,
      booster: get(sim.booster),
      bus: get(sim.bus),
      rvs: sim.rvs.map((rv) => ({ ...rv, samples: get(rv.samples) })),
      objects: sim.objects.map((o) => ({ ...o, samples: get(o.samples) })),
    },
    report: { ...report, objects },
  };
}

/**
 * A solution without its predicted tracks: flying it needs only the bus's
 * release order, and a salvo holds dozens of solutions.
 */
export function withoutTracks(sol: FiringSolution): FiringSolution {
  const n = sol.nominal;
  return {
    ...sol,
    nominal: { ...n, booster: [], bus: [], objects: [], rvs: n.rvs.map((rv) => ({ ...rv, samples: [] })) },
  };
}
