// The shared world clock. Both windows derive the time from the same state
// and the wall clock, so neither depends on the other's render loop (which
// the browser throttles when a window is hidden).

export interface ClockState {
  /** World time [unix ms] at `wallMs` */
  simMs: number;
  /** Wall-clock time [unix ms] of the anchor */
  wallMs: number;
  /** Time warp */
  rate: number;
  running: boolean;
}

export const worldTime = (c: ClockState, wallMs: number) => (c.running ? c.simMs + (wallMs - c.wallMs) * c.rate : c.simMs);

/** A new state continuing from `c` at `wallMs` with a changed warp or run state. */
export function retime(c: ClockState, wallMs: number, change: Partial<Pick<ClockState, 'rate' | 'running'>>): ClockState {
  return { simMs: worldTime(c, wallMs), wallMs, rate: change.rate ?? c.rate, running: change.running ?? c.running };
}
