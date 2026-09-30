// Fire-control computer off the main thread: solving and flying a missile
// takes tenths of a second each, which a salvo of dozens would otherwise
// spend freezing the globe.

import { type FiringSolution, type GeoPoint, MISSILES, type TrajectoryProfile, flySolution, solveFiringSolution } from '../physics';
import { evaluateSensors } from '../sensors';
import { thinFlight, withoutTracks } from './thin';

export type FireControlRequest =
  | { id: number; kind: 'solve'; weapon: string; launch: GeoPoint; targets: GeoPoint[]; profile: TrajectoryProfile }
  | { id: number; kind: 'fly'; sol: FiringSolution; launchMs: number };

self.onmessage = (e: MessageEvent<FireControlRequest>) => {
  const req = e.data;
  if (req.kind === 'solve') {
    const spec = MISSILES.find((m) => m.id === req.weapon)!;
    self.postMessage({ id: req.id, sol: withoutTracks(solveFiringSolution(spec, req.launch, req.targets, req.profile)) });
  } else {
    const sim = flySolution(req.sol);
    self.postMessage({ id: req.id, ...thinFlight(sim, evaluateSensors(sim, req.sol.spec, req.launchMs)) });
  }
};
