import { J2, MU, RE } from './constants';
import type { Vec3 } from './vec3';

/**
 * Gravitational acceleration including the J2 zonal term, which captures the
 * dominant effect of Earth's equatorial bulge. Valid in any frame sharing the
 * Earth's polar axis as Z (both ECI and ECEF here).
 */
export function gravityJ2(r: Vec3): Vec3 {
  const [x, y, z] = r;
  const r2 = x * x + y * y + z * z;
  const rn = Math.sqrt(r2);
  const f = -MU / (r2 * rn);
  const k = (1.5 * J2 * RE * RE) / r2;
  const zz = (5 * z * z) / r2;
  const kxy = 1 + k * (1 - zz);
  return [f * x * kxy, f * y * kxy, f * z * (1 + k * (3 - zz))];
}
