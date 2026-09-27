import type { GeoPoint } from '../physics';

export type Side = 'USA' | 'USSR';

export interface Target extends GeoPoint {
  side: Side;
}

export type SiteKind = 'silo' | 'sub' | 'airbase';

export interface LaunchSite extends Target {
  /** Silo field, submarine patrol area, or bomber base */
  kind: SiteKind;
  /** Missile or bomber ids based here (see physics/missiles.ts, physics/aircraft.ts) */
  weapons: string[];
  /** Operating unit and silo count, early-to-mid 1980s */
  note: string;
  /** Radius of the silo field or patrol area [km] */
  fieldRadius: number;
  /** Not a real missile field (the game's opening scenario) */
  scenario?: boolean;
}

/**
 * ICBM silo fields of the early-to-mid 1980s. Positions are the support base
 * or field centre (approximate); individual silos were dispersed over the
 * surrounding area, typically 10-20 km apart.
 */
export const LAUNCH_SITES: LaunchSite[] = [
  // --- United States: Strategic Air Command -------------------------------
  { kind: 'silo', side: 'USA', name: 'Malmstrom AFB, Montana', lat: 47.505, lon: -111.187, weapons: ['mm2', 'mm3'], note: '341st SMW · 150 MM II + 50 MM III', fieldRadius: 150 },
  { kind: 'silo', side: 'USA', name: 'Minot AFB, North Dakota', lat: 48.416, lon: -101.358, weapons: ['mm3'], note: '91st SMW · 150 MM III', fieldRadius: 90 },
  { kind: 'silo', side: 'USA', name: 'Grand Forks AFB, North Dakota', lat: 47.961, lon: -97.401, weapons: ['mm3'], note: '321st SMW · 150 MM III', fieldRadius: 90 },
  { kind: 'silo', side: 'USA', name: 'Ellsworth AFB, South Dakota', lat: 44.145, lon: -103.104, weapons: ['mm2'], note: '44th SMW · 150 MM II', fieldRadius: 110 },
  { kind: 'silo', side: 'USA', name: 'F.E. Warren AFB, Wyoming', lat: 41.133, lon: -104.867, weapons: ['mm3', 'mx'], note: '90th SMW · 200 MM III (50 Peacekeeper from 1986)', fieldRadius: 110 },
  { kind: 'silo', side: 'USA', name: 'Whiteman AFB, Missouri', lat: 38.727, lon: -93.548, weapons: ['mm2'], note: '351st SMW · 150 MM II', fieldRadius: 90 },
  { kind: 'silo', side: 'USA', name: 'Davis-Monthan AFB, Arizona', lat: 32.166, lon: -110.883, weapons: ['titan2'], note: '390th SMW · 18 Titan II (to 1984)', fieldRadius: 60 },
  { kind: 'silo', side: 'USA', name: 'McConnell AFB, Kansas', lat: 37.623, lon: -97.268, weapons: ['titan2'], note: '381st SMW · 18 Titan II (to 1986)', fieldRadius: 60 },
  { kind: 'silo', side: 'USA', name: 'Little Rock AFB, Arkansas', lat: 34.917, lon: -92.15, weapons: ['titan2'], note: '308th SMW · 18 Titan II (to 1987)', fieldRadius: 60 },
  { kind: 'silo', side: 'USA', name: 'Rural Wisconsin (scenario)', lat: 44.5, lon: -90.0, weapons: ['mm3', 'mm2', 'mx'], note: 'Fictional field — the opening scenario', fieldRadius: 60, scenario: true },

  // --- Soviet Union: Strategic Rocket Forces (RVSN) ------------------------
  { kind: 'silo', side: 'USSR', name: 'Dombarovsky', lat: 51.09, lon: 59.84, weapons: ['r36m'], note: '13th Missile Division · 64 SS-18', fieldRadius: 70 },
  { kind: 'silo', side: 'USSR', name: 'Kartaly', lat: 53.05, lon: 60.65, weapons: ['r36m'], note: '59th Missile Division · 46 SS-18', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Uzhur', lat: 55.32, lon: 89.83, weapons: ['r36m'], note: '62nd Missile Division · 64 SS-18', fieldRadius: 70 },
  { kind: 'silo', side: 'USSR', name: 'Aleysk', lat: 52.52, lon: 82.43, weapons: ['r36m'], note: '41st Missile Division · 30 SS-18', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Zhangiz-Tobe', lat: 49.25, lon: 81.35, weapons: ['r36m'], note: '57th Missile Division · 52 SS-18', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Derzhavinsk', lat: 51.07, lon: 66.32, weapons: ['r36m'], note: '38th Missile Division · 52 SS-18', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Kozelsk', lat: 54.03, lon: 35.78, weapons: ['ur100n'], note: '28th Guards Missile Division · 60 SS-19', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Tatishchevo', lat: 51.67, lon: 45.57, weapons: ['ur100n'], note: '60th Missile Division · 110 SS-19', fieldRadius: 80 },
  { kind: 'silo', side: 'USSR', name: 'Pervomaysk', lat: 48.04, lon: 30.85, weapons: ['ur100n'], note: '46th Missile Division · 70 SS-19', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Khmelnytskyi', lat: 49.43, lon: 26.98, weapons: ['ur100n'], note: '19th Missile Division · 90 SS-19', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Yedrovo', lat: 57.98, lon: 33.23, weapons: ['mrur100'], note: '7th Guards Missile Division · SS-17', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Vypolzovo', lat: 57.88, lon: 33.66, weapons: ['mrur100'], note: 'SS-17', fieldRadius: 50 },
  { kind: 'silo', side: 'USSR', name: 'Bershet', lat: 57.7, lon: 56.3, weapons: ['ur100'], note: '52nd Missile Division · SS-11', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Drovyanaya', lat: 51.53, lon: 113.03, weapons: ['ur100'], note: '4th Missile Division · SS-11', fieldRadius: 60 },
  { kind: 'silo', side: 'USSR', name: 'Svobodny', lat: 51.38, lon: 128.13, weapons: ['ur100'], note: '27th Missile Division · SS-11', fieldRadius: 60 },

  // --- Ballistic-missile submarine patrol areas (approximate, illustrative) --
  { kind: 'sub', side: 'USA', name: 'SSBN patrol — Norwegian Sea', lat: 68.0, lon: 2.0, weapons: ['poseidon', 'trident1'], note: 'Poseidon / Trident I boats', fieldRadius: 300 },
  { kind: 'sub', side: 'USA', name: 'SSBN patrol — North Atlantic', lat: 55.0, lon: -25.0, weapons: ['poseidon', 'trident1'], note: 'Poseidon / Trident I boats', fieldRadius: 400 },
  { kind: 'sub', side: 'USA', name: 'SSBN patrol — Mediterranean', lat: 35.0, lon: 18.0, weapons: ['poseidon'], note: 'Poseidon boats', fieldRadius: 300 },
  { kind: 'sub', side: 'USA', name: 'SSBN patrol — North Pacific', lat: 45.0, lon: 170.0, weapons: ['trident1'], note: 'Trident I boats', fieldRadius: 400 },
  { kind: 'sub', side: 'USSR', name: 'SSBN bastion — Barents Sea', lat: 74.0, lon: 40.0, weapons: ['r29', 'r29r'], note: 'Delta I–III boats', fieldRadius: 300 },
  { kind: 'sub', side: 'USSR', name: 'SSBN bastion — Sea of Okhotsk', lat: 54.0, lon: 148.0, weapons: ['r29', 'r29r'], note: 'Delta I–III boats', fieldRadius: 300 },
  { kind: 'sub', side: 'USSR', name: 'SSBN patrol — Northwest Atlantic', lat: 50.0, lon: -40.0, weapons: ['r29'], note: 'Delta I boats', fieldRadius: 400 },

  // --- Strategic bomber bases -----------------------------------------------
  { kind: 'airbase', side: 'USA', name: 'Fairchild AFB, Washington', lat: 47.615, lon: -117.656, weapons: ['b52'], note: 'B-52 wing', fieldRadius: 15 },
  { kind: 'airbase', side: 'USA', name: 'Barksdale AFB, Louisiana', lat: 32.502, lon: -93.663, weapons: ['b52'], note: 'B-52 wing', fieldRadius: 15 },
  { kind: 'airbase', side: 'USA', name: 'Loring AFB, Maine', lat: 46.95, lon: -67.886, weapons: ['b52'], note: 'B-52 wing', fieldRadius: 15 },
  { kind: 'airbase', side: 'USA', name: 'Minot AFB (bombers), North Dakota', lat: 48.416, lon: -101.358, weapons: ['b52'], note: 'B-52H wing', fieldRadius: 15 },
  { kind: 'airbase', side: 'USSR', name: 'Engels Air Base', lat: 51.48, lon: 46.2, weapons: ['tu95'], note: 'Long-Range Aviation · Tu-95', fieldRadius: 15 },
  { kind: 'airbase', side: 'USSR', name: 'Uzin Air Base', lat: 49.8, lon: 30.4, weapons: ['tu95'], note: 'Long-Range Aviation · Tu-95', fieldRadius: 15 },
  { kind: 'airbase', side: 'USSR', name: 'Dolon Air Base', lat: 50.54, lon: 79.19, weapons: ['tu95'], note: 'Long-Range Aviation · Tu-95', fieldRadius: 15 },
  { kind: 'airbase', side: 'USSR', name: 'Ukrainka Air Base', lat: 51.17, lon: 128.43, weapons: ['tu95'], note: 'Long-Range Aviation · Tu-95', fieldRadius: 15 },
];

/** Cities, command centres and naval bases (silo fields are added as targets automatically). */
export const TARGETS: Target[] = [
  { side: 'USSR', name: 'Moscow', lat: 55.7558, lon: 37.6173 },
  { side: 'USSR', name: 'Tula', lat: 54.1931, lon: 37.6173 },
  { side: 'USSR', name: 'Vladimir', lat: 56.1291, lon: 40.4066 },
  { side: 'USSR', name: 'Kalinin', lat: 56.8587, lon: 35.9176 },
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
  { side: 'USA', name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { side: 'USA', name: 'Norfolk (Atlantic Fleet)', lat: 36.8508, lon: -76.2859 },
  { side: 'USA', name: 'Denver', lat: 39.7392, lon: -104.9903 },
  { side: 'USA', name: 'Colorado Springs', lat: 38.8339, lon: -104.8214 },
];

/** Everything `side` can aim at: the enemy's cities and bases, then its silo fields. */
export function targetsFor(side: Side): Target[] {
  const fields = LAUNCH_SITES.filter((s) => s.side !== side && s.kind === 'silo' && !s.scenario).map((s) => ({
    side: s.side,
    name: `${s.name} missile field`,
    lat: s.lat,
    lon: s.lon,
  }));
  return [...TARGETS.filter((t) => t.side !== side), ...fields];
}
