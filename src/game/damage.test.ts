import { describe, expect, it } from 'vitest';
import { geodeticToEcef } from '../physics';
import {
  type Burst,
  CITIES,
  COLLAPSE_MT,
  assessDamage,
  cityKill,
  collapseTimes,
  damageRadii,
  lensArea,
  scorchMap,
  territoryOf,
} from './damage';
import { MUTUAL_WINDOW_MS, decideOutcome } from './outcome';

const burstAt = (lat: number, lon: number, yieldKt: number): Burst => ({ t: 0, ecef: geodeticToEcef(lat, lon), yieldKt });
const city = (name: string) => CITIES.find((c) => c.name === name)!;

describe('weapon effects', () => {
  it('scales blast radii with the cube root of yield', () => {
    const r1 = damageRadii(1000);
    const r8 = damageRadii(8000);
    expect(r8.severe / r1.severe).toBeCloseTo(2, 5);
    expect(r1.severe).toBeGreaterThan(6_000);
    expect(r1.severe).toBeLessThan(8_000);
    expect(r1.light).toBeGreaterThan(r1.thermal);
    expect(r1.thermal).toBeGreaterThan(r1.severe);
  });

  it('computes disc intersections', () => {
    expect(lensArea(1, 1, 3)).toBe(0);
    expect(lensArea(2, 1, 0.5)).toBeCloseTo(Math.PI, 10);
    // Two unit discs one radius apart overlap by 2π/3 − √3/2.
    expect(lensArea(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 10);
  });
});

describe('casualties', () => {
  it('kills most of a city under a megaton burst, and nobody 500 km away', () => {
    const dc = city('Washington, D.C.');
    expect(cityKill(dc, burstAt(dc.lat, dc.lon, 1000))).toBeGreaterThan(0.6);
    expect(cityKill(dc, burstAt(dc.lat + 4.5, dc.lon, 1000))).toBe(0);
  });

  it('knows whose soil a burst fell on', () => {
    expect(territoryOf(geodeticToEcef(47.5, -111.2))).toBe('USA');
    expect(territoryOf(geodeticToEcef(51.1, 59.8))).toBe('USSR');
    expect(territoryOf(geodeticToEcef(-40, -140))).toBeNull();
  });

  it('starts with both nations whole', () => {
    const w = assessDamage([]);
    expect(w.nations.USA.alive).toBe(w.nations.USA.total);
    expect(w.nations.USSR.projected).toBe(w.nations.USSR.total);
    expect(w.winter).toBe(0);
  });

  it('a megaton on a city kills more than one on a silo field', () => {
    const dc = city('Washington, D.C.');
    const silo = assessDamage([burstAt(47.505, -111.187, 1000)]).nations.USA;
    const town = assessDamage([burstAt(dc.lat, dc.lon, 1000)]).nations.USA;
    expect(silo.alive).toBeLessThan(silo.total);
    expect(town.alive).toBeLessThan(silo.alive - 1);
  });

  it('ends a nation at COLLAPSE_MT on its soil', () => {
    const silo = (t: number) => ({ ...burstAt(47.505, -111.187, 10_000), t });
    const bursts = Array.from({ length: COLLAPSE_MT / 10 }, (_, i) => silo(i * 1000));
    expect(assessDamage(bursts.slice(0, -1)).nations.USA.alive).toBeGreaterThan(0);
    expect(assessDamage(bursts).nations.USA.alive).toBe(0);
    expect(collapseTimes(bursts)).toEqual({ USA: bursts[bursts.length - 1].t, USSR: null });
  });
});

describe('there is no winner', () => {
  // The attacker's cities are untouched; the defender's are burned.
  const hits = ['Moscow', 'Leningrad', 'Kiev', 'Kharkov', 'Minsk', 'Gorky', 'Novosibirsk', 'Sverdlovsk', 'Kuibyshev', 'Tashkent']
    .map(city)
    .flatMap((c) => [burstAt(c.lat, c.lon, 9000), burstAt(c.lat + 0.1, c.lon + 0.1, 9000)]);
  const w = assessDamage(hits);

  it('the side struck is gone', () => {
    expect(w.nations.USSR.alive).toBe(0);
    expect(w.nations.USSR.cities[0].name).toBe('Moscow');
  });

  it('the side that struck first dies in the winter that follows', () => {
    const usa = w.nations.USA;
    expect(usa.alive).toBe(usa.total);
    expect(w.winter).toBeGreaterThan(0.4);
    expect(usa.projected).toBeLessThan(0.7 * usa.total);
  });
});

describe('outcome', () => {
  const T = 1_000_000_000;
  it('is undecided while both nations stand', () => {
    expect(decideOutcome({ USA: null, USSR: null }, T)).toBeNull();
  });

  it('waits for the missiles already in the air before naming a winner', () => {
    const o = decideOutcome({ USA: null, USSR: T }, T + 60_000);
    expect(o).toMatchObject({ kind: 'pending', fallen: 'USSR' });
    expect(decideOutcome({ USA: null, USSR: T }, T + 3 * MUTUAL_WINDOW_MS)).toEqual({
      kind: 'victory',
      winner: 'USA',
      loser: 'USSR',
      at: T,
    });
  });

  it('calls it for nobody when both fall close together', () => {
    expect(decideOutcome({ USA: T + MUTUAL_WINDOW_MS - 1, USSR: T }, T + MUTUAL_WINDOW_MS)).toMatchObject({ kind: 'nobody' });
    expect(decideOutcome({ USA: T + MUTUAL_WINDOW_MS + 1, USSR: T }, T + 3 * MUTUAL_WINDOW_MS)).toMatchObject({
      kind: 'victory',
      winner: 'USA',
    });
  });
});

describe('the view from orbit', () => {
  it('is blue before the war', () => {
    const m = scorchMap([], assessDamage([]));
    expect(m.spots).toHaveLength(0);
    expect(m.haze).toBe(0);
  });

  it('turns a dying nation red, and not the other', () => {
    const b = Array.from({ length: 12 }, () => burstAt(55.7558, 37.6173, 9000));
    const m = scorchMap(b, assessDamage(b));
    const soviet = m.spots.filter((s) => s.lon > 20 && s.intensity > 0.8 && s.radius > 800);
    expect(soviet.length).toBeGreaterThan(20);
    expect(m.spots.some((s) => s.lon < -60)).toBe(false);
    expect(m.haze).toBeGreaterThan(0);
  });
});
