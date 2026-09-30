// Planning a massive strike: which missile flies from which field at what.
// Strategies only assign origins and targets; the fire-control computer
// still solves every missile.

import { MISSILES, type MissileSpec, vincentyInverse } from '../physics';
import { LAUNCH_SITES, type LaunchSite, type Side, type Target, targetsFor } from './sites';

export interface SalvoPlan {
  spec: MissileSpec;
  launch: LaunchSite;
  /** First target is the booster's primary; the bus delivers the rest. */
  targets: Target[];
}

export type Strategy = 'random';

/** A MIRV bus cannot throw warheads much further than this from its primary [m]. */
export const MIRV_SPREAD = 800_000;
/** Keep aimed shots inside this fraction of the weapon's range. */
const RANGE_MARGIN = 0.95;

const distance = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  vincentyInverse(a.lat, a.lon, b.lat, b.lon).distance;

const pick = <T>(xs: T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)];

/**
 * Random strategy: each missile comes from a random field of `side` (a
 * weapon actually based there), its primary is a random enemy target in
 * range, and any further RVs go to random targets near that primary
 * (the same target again if nothing else is close).
 */
export function randomSalvo(side: Side, count: number, rng: () => number = Math.random): SalvoPlan[] {
  const fields = LAUNCH_SITES.filter((s) => s.side === side && !s.scenario);
  const enemy = targetsFor(side);
  const plans: SalvoPlan[] = [];
  for (let n = 0; n < count; n++) {
    const launch = pick(fields, rng);
    const weapon = pick(launch.weapons, rng);
    const spec = MISSILES.find((m) => m.id === weapon)!;
    const inRange = enemy.filter((t) => distance(launch, t) < spec.rangeKm * 1000 * RANGE_MARGIN);
    if (!inRange.length) continue;
    const primary = pick(inRange, rng);
    const near = inRange.filter((t) => distance(primary, t) < MIRV_SPREAD);
    const targets = [primary];
    while (targets.length < spec.bus.rvCount) targets.push(pick(near, rng));
    plans.push({ spec, launch, targets });
  }
  return plans;
}

export function planSalvo(strategy: Strategy, side: Side, count: number, rng?: () => number): SalvoPlan[] {
  switch (strategy) {
    case 'random':
      return randomSalvo(side, count, rng);
  }
}
