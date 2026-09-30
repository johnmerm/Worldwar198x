// Who is left. The war is decided when a nation reaches zero: if the other
// follows within MUTUAL_WINDOW_MS (the missiles already in the air), nobody
// wins; otherwise the survivor "wins".

import type { Side } from './sites';

/** Two collapses this close together [ms] are one outcome: nobody wins. About one ICBM flight. */
export const MUTUAL_WINDOW_MS = 30 * 60_000;
/** Extra world time before deciding, for reports still in transit between the windows [ms]. */
export const DECISION_GRACE_MS = 5 * 60_000;

export type Outcome =
  /** A nation has fallen; the other may still follow before `decideAt` */
  | { kind: 'pending'; fallen: Side; at: number; decideAt: number }
  | { kind: 'nobody'; at: Record<Side, number> }
  | { kind: 'victory'; winner: Side; loser: Side; at: number };

const other = (s: Side): Side => (s === 'USA' ? 'USSR' : 'USA');

/** The outcome at world time `now` [unix ms], given when each nation reached zero; null while both stand. */
export function decideOutcome(collapsed: Record<Side, number | null>, now: number): Outcome | null {
  const fallen = (['USA', 'USSR'] as Side[]).filter((s) => collapsed[s] !== null).sort((a, b) => collapsed[a]! - collapsed[b]!);
  if (!fallen.length) return null;
  const first = fallen[0];
  const t = collapsed[first]!;
  const second = collapsed[other(first)];
  if (second !== null && second - t <= MUTUAL_WINDOW_MS) return { kind: 'nobody', at: collapsed as Record<Side, number> };
  const decideAt = t + MUTUAL_WINDOW_MS + DECISION_GRACE_MS;
  if (now < decideAt) return { kind: 'pending', fallen: first, at: t, decideAt };
  return { kind: 'victory', winner: other(first), loser: first, at: t };
}
