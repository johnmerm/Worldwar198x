/** WGS-84 / EGM constants, SI units. */
export const MU = 3.986004418e14; // Earth gravitational parameter [m^3/s^2]
export const RE = 6378137.0; // WGS-84 equatorial radius [m]
export const FLATTENING = 1 / 298.257223563;
export const RP = RE * (1 - FLATTENING); // polar radius [m] (~6356752 m)
export const E2 = FLATTENING * (2 - FLATTENING); // first eccentricity squared
export const J2 = 1.08262668e-3; // second zonal harmonic (oblateness)
export const OMEGA_EARTH = 7.292115e-5; // sidereal rotation rate [rad/s]
export const G0 = 9.80665; // standard gravity [m/s^2]
export const DEG = Math.PI / 180;
