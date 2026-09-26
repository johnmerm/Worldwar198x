import { MU } from './constants';
import { type Vec3, addScaled, dot, norm, scale } from './vec3';

function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}

function stumpffS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

export interface LambertSolution {
  v1: Vec3;
  v2: Vec3;
}

/**
 * Lambert's problem (universal-variable formulation, Bate/Mueller/White and
 * Curtis): find the Keplerian orbit that carries a body from r1 to r2 in
 * exactly `tof` seconds. Always takes the short way (< 180 deg transfer),
 * which is what a ballistic missile flies. Solved by bisection on the
 * universal variable z, which is monotonic in time of flight and never fails
 * to converge (unlike a bare Newton iteration).
 */
export function lambert(r1: Vec3, r2: Vec3, tof: number, mu = MU): LambertSolution | null {
  const R1 = norm(r1);
  const R2 = norm(r2);
  const cosD = Math.max(-1, Math.min(1, dot(r1, r2) / (R1 * R2)));
  const dTheta = Math.acos(cosD);
  if (dTheta < 1e-8 || Math.PI - dTheta < 1e-6 || tof <= 0) return null;
  const A = Math.sin(dTheta) * Math.sqrt((R1 * R2) / (1 - cosD));

  const y = (z: number) => R1 + R2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
  const timeOfFlight = (z: number) => {
    const yz = y(z);
    const x = Math.sqrt(yz / stumpffC(z));
    return (x * x * x * stumpffS(z) + A * Math.sqrt(yz)) / Math.sqrt(mu);
  };

  // Upper bound: single-revolution elliptic limit z -> (2 pi)^2.
  let hi = 4 * Math.PI * Math.PI - 1e-9;
  // Lower bound: y(z) must stay positive; walk down into hyperbolic space.
  let lo = -4 * Math.PI * Math.PI;
  if (y(lo) < 0) {
    // Find where y crosses zero and start just above it.
    let a = lo;
    let b = hi;
    for (let i = 0; i < 100; i++) {
      const m = 0.5 * (a + b);
      if (y(m) < 0) a = m;
      else b = m;
    }
    lo = b;
  }
  if (timeOfFlight(lo) > tof) return null; // would need a faster-than-hyperbolic bracket

  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (lo + hi);
    if (timeOfFlight(m) < tof) lo = m;
    else hi = m;
    if (hi - lo < 1e-12) break;
  }
  const z = 0.5 * (lo + hi);
  const yz = y(z);
  const f = 1 - yz / R1;
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1 - yz / R2;
  return {
    v1: scale(addScaled(r2, r1, -f), 1 / g),
    v2: scale(addScaled(scale(r2, gdot), r1, -1), 1 / g),
  };
}
