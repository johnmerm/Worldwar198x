import { DEG, FLATTENING, RE, RP } from './constants';

export interface GeodesicInverse {
  /** Distance along the ellipsoid surface [m] */
  distance: number;
  /** Initial azimuth at the start point [deg, clockwise from north] */
  azimuth: number;
}

/**
 * Vincenty's inverse formula on the WGS-84 ellipsoid: shortest surface
 * distance and initial heading between two points. Accurate to ~0.5 mm.
 */
export function vincentyInverse(lat1: number, lon1: number, lat2: number, lon2: number): GeodesicInverse {
  const a = RE;
  const b = RP;
  const f = FLATTENING;
  const L = (lon2 - lon1) * DEG;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * DEG));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * DEG));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cosSqAlpha = 1;
  let cos2SigmaM = 0;
  let sinLambda = 0;
  let cosLambda = 1;
  for (let i = 0; i < 200; i++) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return { distance: 0, azimuth: 0 };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) break;
  }
  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  const distance = b * A * (sigma - deltaSigma);
  const az = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) / DEG;
  return { distance, azimuth: (az + 360) % 360 };
}
