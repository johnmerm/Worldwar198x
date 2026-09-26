/**
 * Piecewise-exponential standard atmosphere (after Vallado, "Fundamentals of
 * Astrodynamics and Applications", table 8-4). Base altitude [km], base
 * density [kg/m^3], scale height [km].
 */
const TABLE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1.225, 7.249],
  [25, 3.899e-2, 6.349],
  [30, 1.774e-2, 6.682],
  [40, 3.972e-3, 7.554],
  [50, 1.057e-3, 8.382],
  [60, 3.206e-4, 7.714],
  [70, 8.77e-5, 6.549],
  [80, 1.905e-5, 5.799],
  [90, 3.396e-6, 5.382],
  [100, 5.297e-7, 5.877],
  [110, 9.661e-8, 7.263],
  [120, 2.438e-8, 9.473],
  [130, 8.484e-9, 12.636],
  [140, 3.845e-9, 16.149],
  [150, 2.07e-9, 22.523],
  [180, 5.464e-10, 29.74],
  [200, 2.789e-10, 37.105],
];

/** Air density [kg/m^3] at geometric altitude h [m]. */
export function airDensity(h: number): number {
  const km = Math.max(0, h / 1000);
  if (km > 1000) return 0;
  let i = TABLE.length - 1;
  while (i > 0 && km < TABLE[i][0]) i--;
  const [h0, rho0, scaleH] = TABLE[i];
  return rho0 * Math.exp(-(km - h0) / scaleH);
}
