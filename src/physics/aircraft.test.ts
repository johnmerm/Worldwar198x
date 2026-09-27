import { describe, expect, it } from 'vitest';
import { B52H, TU95, ecefToGeodetic, flyBomber, vincentyInverse } from './index';
import { evaluateBomberSensors } from '../sensors';

const MINOT = { name: 'Minot AFB', lat: 48.416, lon: -101.358 };
const MOSCOW = { name: 'Moscow', lat: 55.7558, lon: 37.6173 };

describe('bombers', () => {
  const flight = flyBomber(B52H, MINOT, [MOSCOW]);

  it('flies the great circle at cruise speed, taking hours', () => {
    const d = vincentyInverse(MINOT.lat, MINOT.lon, MOSCOW.lat, MOSCOW.lon).distance;
    expect(flight.distance).toBeCloseTo(d, 0);
    expect(flight.legs[0].t).toBeCloseTo(d / B52H.cruiseSpeed, 0);
    expect(flight.legs[0].t / 3600).toBeGreaterThan(8);
    expect(flight.feasible).toBe(true);
    const end = ecefToGeodetic(flight.samples[flight.samples.length - 1].ecef);
    expect(end.lat).toBeCloseTo(MOSCOW.lat, 2);
    expect(end.lon).toBeCloseTo(MOSCOW.lon, 2);
  });

  it('climbs to cruise altitude and stays there', () => {
    expect(flight.samples[0].alt).toBe(0);
    const mid = flight.samples[Math.floor(flight.samples.length / 2)];
    expect(mid.alt).toBe(B52H.cruiseAlt);
    const maxLat = Math.max(...flight.samples.map((s) => ecefToGeodetic(s.ecef).lat));
    expect(maxLat).toBeGreaterThan(70); // polar great circle
  });

  it('visits several targets in order and respects range', () => {
    const tour = flyBomber(TU95, { name: 'Engels', lat: 51.48, lon: 46.2 }, [
      { name: 'Minot', lat: 48.42, lon: -101.36 },
      { name: 'Omaha', lat: 41.26, lon: -95.93 },
    ]);
    expect(tour.legs).toHaveLength(2);
    expect(tour.legs[1].t).toBeGreaterThan(tour.legs[0].t);
    const tooFar = flyBomber(B52H, MINOT, [{ name: 'Antipode', lat: -48, lon: 78 }, MINOT]);
    expect(tooFar.feasible).toBe(false);
  });

  it('is invisible to IR satellites and seen by radar only near the radar horizon', () => {
    const report = evaluateBomberSensors(flight, B52H);
    expect(report.observer).toBe('USSR');
    expect(report.events.some((e) => e.kind === 'ir-launch')).toBe(false);
    const first = report.objects[0].firstSeen!;
    expect(first).not.toBeNull();
    // Hours of flight pass before the first radar sees it.
    expect(first.t / 3600).toBeGreaterThan(5);
    expect(report.objects[0].classifiedT).toBe(first.t);
  });
});
