import { describe, expect, it } from 'vitest';
import { MINUTEMAN_III, R36M, RE, flySolution, geodeticToEcef, ecefToGeodetic, norm, solveFiringSolution } from '../physics';
import {
  DISCRIMINATION_ALT,
  OKO_APOGEE_LON,
  RADARS,
  SATELLITES,
  evaluateSensors,
  lineOfSight,
  orbitEcef,
  radarSees,
  spaceBackground,
  trackClassAt,
} from './index';

const P = (name: string, lat: number, lon: number) => ({ name, lat, lon });
const WISCONSIN = P('Rural Wisconsin', 44.5, -90);
const MOSCOW = P('Moscow', 55.7558, 37.6173);

/** Deterministic PRNG (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('orbits and geometry', () => {
  const oko1 = SATELLITES.find((s) => s.id === 'oko-1')!;

  it('puts Oko on a 12-hour Molniya orbit with its apogee over the Atlantic', () => {
    const p = orbitEcef(oko1.orbit!, oko1.orbit!.epochMs);
    const g = ecefToGeodetic(p);
    expect(g.h / 1000).toBeGreaterThan(38_000);
    expect(g.h / 1000).toBeLessThan(41_000);
    expect(g.lat).toBeCloseTo(63.4, 0);
    expect(g.lon).toBeCloseTo(OKO_APOGEE_LON, 0);
  });

  it('repeats the ground track every sidereal day', () => {
    const t = oko1.orbit!.epochMs + 3.7e6;
    const a = orbitEcef(oko1.orbit!, t);
    const b = orbitEcef(oko1.orbit!, t + 86_164_091);
    expect(norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]])).toBeLessThan(20_000);
  });

  it('blocks lines of sight through the Earth', () => {
    expect(lineOfSight(geodeticToEcef(0, 0, 100_000), geodeticToEcef(0, 180, 100_000))).toBe(false);
    expect(lineOfSight(geodeticToEcef(0, 0, 100_000), geodeticToEcef(0, 5, 100_000))).toBe(true);
  });

  it('knows when a target is silhouetted against space', () => {
    const above: [number, number, number] = [0, 0, RE * 7];
    expect(spaceBackground(above, geodeticToEcef(90, 0, 200_000))).toBe(false); // looking straight down
    expect(spaceBackground(above, geodeticToEcef(0, 0, 500_000))).toBe(true); // at the limb
  });

  it('scales radar range with the fourth root of RCS', () => {
    const pechora = RADARS.find((r) => r.id === 'pechora')!;
    // 1,000 km altitude, ~3,700 km north of Pechora.
    const target = geodeticToEcef(85, 57.3, 1_000_000);
    expect(radarSees(pechora, target, 1)).toBe(true);
    expect(radarSees(pechora, target, 0.001)).toBe(false);
    // Behind the radar's face.
    expect(radarSees(pechora, geodeticToEcef(50, 57.3, 1_000_000), 1)).toBe(false);
  });
});

describe('Wisconsin -> Moscow as the Soviet sensors see it', () => {
  const sol = solveFiringSolution(MINUTEMAN_III, WISCONSIN, [MOSCOW, P('Tula', 54.19, 37.62)]);
  const sim = flySolution(sol, seeded(7));
  const report = evaluateSensors(sim, MINUTEMAN_III, Date.UTC(2026, 8, 26, 0));
  const byId = (id: string) => report.objects.find((o) => o.id === id)!;

  it('is watched by the other side', () => {
    expect(report.observer).toBe('USSR');
  });

  it('Oko spots the plume during boost, against the space background', () => {
    const ir = report.events.find((e) => e.kind === 'ir-launch');
    expect(ir?.sensor).toMatch(/^Oko/);
    expect(ir!.t).toBeLessThan(sim.burnout.t);
  });

  it('radar sees the chaff clouds long before the RVs hidden inside them', () => {
    const chaff = byId('CHF-A');
    const rv = byId('RV-A');
    expect(chaff.firstSeen!.t).toBeLessThan(rv.firstSeen!.t - 300);
    const chaffEnd = sim.objects.find((o) => o.id === 'CHF-A')!.end!.t;
    expect(rv.firstSeen!.t).toBeGreaterThanOrEqual(chaffEnd - 2);
  });

  it('cannot tell RVs from decoys until drag sorts them below 80 km', () => {
    for (const o of report.objects.filter((x) => x.kind === 'rv' || x.kind === 'decoy')) {
      const i = o.samples.findIndex((s) => s.t === o.classifiedT);
      expect(o.samples[i].alt).toBeLessThan(DISCRIMINATION_ALT);
      expect(trackClassAt(o, o.firstSeen!.t)).toBe(o.firstSeen!.t === o.classifiedT ? o.kind : 'unknown');
    }
    expect(report.events.filter((e) => e.kind === 'rv-identified')).toHaveLength(2);
    expect(report.events.filter((e) => e.kind === 'decoy-identified')).toHaveLength(4);
  });

  it('leaves about half an hour of warning, but under a minute to know which objects are real', () => {
    const firstImpact = Math.min(...sim.rvs.map((r) => r.impact!.t));
    expect(firstImpact - report.firstWarningT!).toBeGreaterThan(20 * 60);
    expect(firstImpact - byId('RV-A').classifiedT!).toBeLessThan(60);
  });
});

describe('SS-18 on the US', () => {
  it('DSP over the Indian Ocean sees the launch within the first minutes', () => {
    const sol = solveFiringSolution(R36M, P('Dombarovsky', 51.09, 59.84), [P('Minot', 48.42, -101.36)]);
    const report = evaluateSensors(flySolution(sol, seeded(3)), R36M, Date.UTC(2026, 8, 26, 12));
    const ir = report.events.find((e) => e.kind === 'ir-launch')!;
    expect(ir.sensor).toBe('DSP Indian Ocean');
    expect(ir.t).toBeLessThan(120);
    expect(report.events.some((e) => e.kind === 'rv-identified' && e.sensor === 'Cavalier PARCS')).toBe(true);
  });
});
