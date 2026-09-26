import type { GeoPoint } from '../physics';

export type Side = 'USA' | 'USSR';

export interface LaunchSite extends GeoPoint {
  side: Side;
}

/** Silo fields (approximate centres) plus the scenario's rural Wisconsin field. */
export const LAUNCH_SITES: LaunchSite[] = [
  { side: 'USA', name: 'Rural Wisconsin missile field', lat: 44.5, lon: -90.0 },
  { side: 'USA', name: 'Malmstrom AFB, Montana', lat: 47.505, lon: -111.187 },
  { side: 'USA', name: 'Minot AFB, North Dakota', lat: 48.416, lon: -101.358 },
  { side: 'USA', name: 'F.E. Warren AFB, Wyoming', lat: 41.133, lon: -104.867 },
  { side: 'USA', name: 'Whiteman AFB, Missouri', lat: 38.73, lon: -93.548 },
  { side: 'USSR', name: 'Kozelsk', lat: 54.03, lon: 35.78 },
  { side: 'USSR', name: 'Tatishchevo', lat: 51.67, lon: 45.57 },
  { side: 'USSR', name: 'Dombarovsky', lat: 51.09, lon: 59.84 },
  { side: 'USSR', name: 'Uzhur', lat: 55.32, lon: 89.83 },
  { side: 'USSR', name: 'Aleysk', lat: 52.52, lon: 82.43 },
];

export const TARGETS: LaunchSite[] = [
  { side: 'USSR', name: 'Moscow', lat: 55.7558, lon: 37.6173 },
  { side: 'USSR', name: 'Tula', lat: 54.1931, lon: 37.6173 },
  { side: 'USSR', name: 'Vladimir', lat: 56.1291, lon: 40.4066 },
  { side: 'USSR', name: 'Kalinin', lat: 56.8587, lon: 35.9176 },
  { side: 'USSR', name: 'Kozelsk ICBM field', lat: 54.03, lon: 35.78 },
  { side: 'USSR', name: 'Leningrad', lat: 59.9343, lon: 30.3351 },
  { side: 'USSR', name: 'Kiev', lat: 50.4501, lon: 30.5234 },
  { side: 'USSR', name: 'Murmansk (Northern Fleet)', lat: 68.9585, lon: 33.0827 },
  { side: 'USSR', name: 'Novosibirsk', lat: 55.0084, lon: 82.9357 },
  { side: 'USSR', name: 'Vladivostok (Pacific Fleet)', lat: 43.1198, lon: 131.8869 },
  { side: 'USSR', name: 'Baikonur Cosmodrome', lat: 45.9646, lon: 63.3052 },
  { side: 'USA', name: 'Washington, D.C.', lat: 38.8977, lon: -77.0365 },
  { side: 'USA', name: 'New York', lat: 40.7128, lon: -74.006 },
  { side: 'USA', name: 'Offutt AFB (SAC HQ)', lat: 41.118, lon: -95.912 },
  { side: 'USA', name: 'Cheyenne Mountain (NORAD)', lat: 38.744, lon: -104.846 },
  { side: 'USA', name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { side: 'USA', name: 'Minot ICBM field', lat: 48.416, lon: -101.358 },
  { side: 'USA', name: 'F.E. Warren ICBM field', lat: 41.133, lon: -104.867 },
  { side: 'USA', name: 'Denver', lat: 39.7392, lon: -104.9903 },
  { side: 'USA', name: 'Colorado Springs', lat: 38.8339, lon: -104.8214 },
  { side: 'USA', name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { side: 'USA', name: 'Norfolk (Atlantic Fleet)', lat: 36.8508, lon: -76.2859 },
];
