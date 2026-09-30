// A small pool of fire-control workers (see fireControl.worker.ts).

import type { FiringSolution, GeoPoint, SimResult, TrajectoryProfile } from '../physics';
import type { SensorReport } from '../sensors';
import type { FireControlRequest } from './fireControl.worker';
import { withoutTracks } from './thin';
// Inlined: published builds are one classic script served from githack, where worker URLs are unreliable.
import FireControlWorker from './fireControl.worker?worker&inline';

type Pending = { resolve: (v: never) => void; reject: (e: unknown) => void };
type Request = FireControlRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const workers = Array.from({ length: size }, () => new FireControlWorker());
const pending = new Map<number, Pending>();
const load = workers.map(() => 0);
let nextId = 0;

workers.forEach((w, i) => {
  w.onmessage = (e: MessageEvent<{ id: number }>) => {
    load[i]--;
    pending.get(e.data.id)?.resolve(e.data as never);
    pending.delete(e.data.id);
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  };
});

function call<T>(req: Request): Promise<T> {
  const id = ++nextId;
  const i = load.indexOf(Math.min(...load));
  load[i]++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    workers[i].postMessage({ ...req, id } as FireControlRequest);
  });
}

export const solveInWorker = (weapon: string, launch: GeoPoint, targets: GeoPoint[], profile: TrajectoryProfile) =>
  call<{ sol: FiringSolution }>({ kind: 'solve', weapon, launch, targets, profile }).then((r) => r.sol);

export const flyInWorker = (sol: FiringSolution, launchMs: number) =>
  call<{ sim: SimResult; report: SensorReport }>({ kind: 'fly', sol: withoutTracks(sol), launchMs });
