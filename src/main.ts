import './cesiumBase';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import {
  type FiringSolution,
  type GeoPoint,
  MISSILES,
  type MissileSpec,
  type SimResult,
  type TrajectoryProfile,
  type TrajectorySample,
  type Vec3,
  ecefToGeodetic,
  flySolution,
  geodeticToEcef,
  norm,
  solveFiringSolution,
  sub,
  vincentyInverse,
} from './physics';
import { LAUNCH_SITES, type Side, TARGETS } from './game/sites';

// ---------------------------------------------------------------------------
// Globe
// ---------------------------------------------------------------------------

const viewer = new Cesium.Viewer('cesiumContainer', {
  // Offline Natural Earth II imagery bundled with Cesium: no ion token needed.
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')),
  ),
  baseLayerPicker: false,
  geocoder: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  sceneModePicker: true,
  timeline: true,
  animation: true,
  shouldAnimate: true,
});

const base = viewer.imageryLayers.get(0);
base.brightness = 0.55;
base.contrast = 1.25;
base.saturation = 0.35;
viewer.imageryLayers.addImageryProvider(
  new Cesium.GridImageryProvider({
    cells: 2,
    color: Cesium.Color.fromCssColorString('#50ffaa').withAlpha(0.22),
    glowColor: Cesium.Color.fromCssColorString('#50ffaa').withAlpha(0.05),
    backgroundColor: Cesium.Color.TRANSPARENT,
  }),
);
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.baseColor = Cesium.Color.BLACK;
viewer.clock.currentTime = Cesium.JulianDate.now();
viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
viewer.clock.multiplier = 1;
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-20, 62, 16_000_000) });

const GREEN = Cesium.Color.fromCssColorString('#8dffc8');
const AMBER = Cesium.Color.fromCssColorString('#ffb347');
const RED = Cesium.Color.fromCssColorString('#ff4b4b');
const FONT = '13px "Share Tech Mono", monospace';

const toCart = (v: Vec3) => new Cesium.Cartesian3(v[0], v[1], v[2]);
const surface = (v: Vec3) => {
  const g = ecefToGeodetic(v);
  return Cesium.Cartesian3.fromDegrees(g.lon, g.lat, 0);
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const weaponSel = $<HTMLSelectElement>('weapon');
const launchSel = $<HTMLSelectElement>('launchSel');
const targetSel = $<HTMLSelectElement>('targetSel');
const profileSel = $<HTMLSelectElement>('profile');
const launchBtn = $<HTMLButtonElement>('launchBtn');
const pickHint = $('pickHint');

const fmtCoord = (p: GeoPoint) =>
  `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}`;
const fmtKm = (m: number) => `${Math.round(m / 1000).toLocaleString('en-US')} km`;
const fmtClock = (s: number) => {
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(Math.round(s));
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

function renderDl(el: HTMLElement, rows: [string, string, string?][]) {
  el.innerHTML = rows
    .map(([k, v, cls]) => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd>`)
    .join('');
}

function log(text: string, kind: '' | 'alert' | 'notice' = '') {
  const li = document.createElement('li');
  if (kind) li.className = kind;
  const now = Cesium.JulianDate.toGregorianDate(viewer.clock.currentTime);
  const stamp = [now.hour, now.minute, now.second].map((n) => String(n).padStart(2, '0')).join(':');
  li.innerHTML = `<time>${stamp}Z</time>`;
  li.append(text);
  $('log').prepend(li);
}

// ---------------------------------------------------------------------------
// Fire-mission state
// ---------------------------------------------------------------------------

let side: Side = 'USA';
let launchPoint: GeoPoint = LAUNCH_SITES[0];
let targetPoint: GeoPoint = TARGETS[0];
let solution: FiringSolution | null = null;
let pickMode: 'launch' | 'target' | null = null;
const CUSTOM = '__custom__';

const launchMarker = viewer.entities.add({
  point: { pixelSize: 9, color: GREEN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
  label: { font: FONT, fillColor: GREEN, pixelOffset: new Cesium.Cartesian2(0, -18), showBackground: true },
});
const targetMarker = viewer.entities.add({
  point: { pixelSize: 9, color: RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
  label: { font: FONT, fillColor: RED, pixelOffset: new Cesium.Cartesian2(0, -18), showBackground: true },
});
const aimMarker = viewer.entities.add({
  show: false,
  point: { pixelSize: 5, color: AMBER },
  label: {
    text: 'AIM (J2/drag corrected)',
    font: '11px "Share Tech Mono", monospace',
    fillColor: AMBER,
    pixelOffset: new Cesium.Cartesian2(0, 14),
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
  },
});
const predicted = viewer.entities.add({
  show: false,
  polyline: {
    positions: [],
    width: 1.5,
    arcType: Cesium.ArcType.NONE,
    material: new Cesium.PolylineDashMaterialProperty({ color: AMBER, dashLength: 12 }),
  },
});
const predictedGround = viewer.entities.add({
  show: false,
  polyline: {
    positions: [],
    width: 1,
    arcType: Cesium.ArcType.NONE,
    material: AMBER.withAlpha(0.35),
  },
});

function setMarker(entity: Cesium.Entity, p: GeoPoint) {
  entity.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
  entity.label!.text = new Cesium.ConstantProperty(p.name.toUpperCase());
}

function invalidateSolution() {
  solution = null;
  $('solutionBox').hidden = true;
  predicted.show = false;
  predictedGround.show = false;
  aimMarker.show = false;
}

function refreshPoints() {
  setMarker(launchMarker, launchPoint);
  setMarker(targetMarker, targetPoint);
  $('launchCoord').textContent = fmtCoord(launchPoint);
  $('targetCoord').textContent = fmtCoord(targetPoint);
  invalidateSolution();
}

function fillSelect(sel: HTMLSelectElement, items: GeoPoint[], chosen: GeoPoint) {
  sel.innerHTML = '';
  items.forEach((p, i) => sel.add(new Option(p.name, String(i), false, p === chosen)));
  if (!items.includes(chosen)) sel.add(new Option(chosen.name, CUSTOM, false, true));
}

function applySide(newSide: Side) {
  side = newSide;
  document.querySelectorAll<HTMLButtonElement>('#sideSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.side === side);
  });
  const weapons = MISSILES.filter((m) => m.side === side);
  weaponSel.innerHTML = '';
  weapons.forEach((m) => weaponSel.add(new Option(`${m.name} · ${m.rangeKm.toLocaleString()} km`, m.id)));
  const sites = LAUNCH_SITES.filter((s) => s.side === side);
  const targets = TARGETS.filter((t) => t.side !== side);
  launchPoint = sites[0];
  targetPoint = targets[0];
  fillSelect(launchSel, sites, launchPoint);
  fillSelect(targetSel, targets, targetPoint);
  refreshPoints();
}

const currentWeapon = (): MissileSpec => MISSILES.find((m) => m.id === weaponSel.value)!;

// ---------------------------------------------------------------------------
// Fire control
// ---------------------------------------------------------------------------

function computeSolution() {
  const spec = currentWeapon();
  const profile = profileSel.value as TrajectoryProfile;
  const t0 = performance.now();
  solution = solveFiringSolution(spec, launchPoint, targetPoint, profile);
  const ms = performance.now() - t0;
  const n = solution.nominal;

  const rows: [string, string, string?][] = [
    ['Range (WGS-84)', fmtKm(solution.range)],
    ['Launch azimuth', `${solution.azimuth.toFixed(1).padStart(5, '0')}°`],
  ];
  if (solution.feasible && n.impact) {
    rows.push(
      ['Flight time', fmtClock(n.impact.t)],
      ['Burnout', `T+${n.burnout.t.toFixed(0)} s · ${fmtKm(n.burnout.alt)}`],
      ['Burnout velocity', `${(n.burnout.speed / 1000).toFixed(2)} km/s @ ${n.burnout.flightPathAngle.toFixed(1)}°`],
      ['Apogee', fmtKm(n.apogee.alt)],
      ['Impact velocity', `${(n.impact.speed / 1000).toFixed(2)} km/s`],
      ['J2/drag aim offset', `${(solution.aimOffset / 1000).toFixed(1)} km`],
      ['Solver', `${solution.iterations} iter · ${solution.nominalMiss.toFixed(1)} m · ${ms.toFixed(0)} ms`],
      ['Expected CEP', `${spec.cep} m`, 'hot'],
    );
  } else {
    rows.push(['Status', 'TARGET OUT OF RANGE', 'warn'], [
      'Missing Δv',
      `${n.residualVgo.toFixed(0)} m/s`,
      'warn',
    ]);
  }
  renderDl($('solution'), rows);
  $('solutionBox').hidden = false;
  launchBtn.disabled = !solution.feasible;

  predicted.polyline!.positions = new Cesium.ConstantProperty(n.samples.map((s) => toCart(s.ecef)));
  predictedGround.polyline!.positions = new Cesium.ConstantProperty(n.samples.map((s) => surface(s.ecef)));
  predicted.show = true;
  predictedGround.show = true;
  aimMarker.position = new Cesium.ConstantPositionProperty(toCart(solution.aimEcef));
  aimMarker.show = solution.feasible;
  viewer.flyTo(predicted, { duration: 1.5 });
  log(
    solution.feasible
      ? `Solution: ${launchPoint.name} → ${targetPoint.name}, ${fmtKm(solution.range)}, ${fmtClock(n.impact!.t)} flight`
      : `No solution: ${targetPoint.name} beyond ${spec.name} capability`,
    solution.feasible ? '' : 'alert',
  );
}

// ---------------------------------------------------------------------------
// Missiles in flight
// ---------------------------------------------------------------------------

interface Flight {
  id: number;
  sol: FiringSolution;
  sim: SimResult;
  launchTime: Cesium.JulianDate;
  nextEvent: number;
}
const flights: Flight[] = [];
let flightCounter = 0;

function launch() {
  if (!solution?.feasible) return;
  const sol = solution;
  const sim = flySolution(sol);
  if (!sim.impact) return;
  const id = ++flightCounter;
  const t0 = viewer.clock.currentTime.clone();
  const at = (s: number) => Cesium.JulianDate.addSeconds(t0, s, new Cesium.JulianDate());
  const tImpact = at(sim.impact.t);

  const position = new Cesium.SampledPositionProperty();
  for (const s of sim.samples) position.addSample(at(s.t), toCart(s.ecef));

  const tag = `${sol.spec.side === 'USA' ? 'MM-III' : 'SS-18'} #${id}`;
  viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start: t0, stop: tImpact })]),
    position,
    point: { pixelSize: 7, color: Cesium.Color.WHITE, outlineColor: RED, outlineWidth: 2 },
    path: {
      leadTime: 0,
      trailTime: 1e6,
      width: 3,
      resolution: 2,
      material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: RED }),
    },
    label: { text: tag, font: FONT, fillColor: Cesium.Color.WHITE, pixelOffset: new Cesium.Cartesian2(0, -16) },
  });

  // Keep the flown track on the plot after the RV is gone.
  viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({ start: tImpact, stop: Cesium.JulianDate.addDays(tImpact, 365, new Cesium.JulianDate()) }),
    ]),
    polyline: {
      positions: sim.samples.map((s) => toCart(s.ecef)),
      width: 2,
      arcType: Cesium.ArcType.NONE,
      material: RED.withAlpha(0.6),
    },
  });

  // Detonation flash: an expanding, fading disc at the actual impact point.
  const impactPos = toCart(sim.impact.ecef);
  const flashSeconds = 40;
  const age = (time: Cesium.JulianDate) => Cesium.JulianDate.secondsDifference(time, tImpact);
  viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({ start: tImpact, stop: Cesium.JulianDate.addDays(tImpact, 365, new Cesium.JulianDate()) }),
    ]),
    position: impactPos,
    ellipse: {
      semiMajorAxis: new Cesium.CallbackProperty((time) => 2000 + 28000 * Math.min(1, age(time!) / flashSeconds), false),
      semiMinorAxis: new Cesium.CallbackProperty((time) => 2000 + 28000 * Math.min(1, age(time!) / flashSeconds), false),
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(
          (time) => AMBER.withAlpha(Math.max(0.15, 0.85 * (1 - age(time!) / flashSeconds))),
          false,
        ),
      ),
    },
    point: { pixelSize: 6, color: RED },
    label: {
      text: `${tag} · ${Math.round(norm(sub(sim.impact.ecef, geodeticToEcef(sol.target.lat, sol.target.lon))))} m from aim`,
      font: '11px "Share Tech Mono", monospace',
      fillColor: AMBER,
      pixelOffset: new Cesium.Cartesian2(0, 16),
    },
  });

  flights.push({ id, sol, sim, launchTime: t0, nextEvent: 0 });
  if (viewer.clock.multiplier < 30) setWarp(30);
  const stop = Cesium.JulianDate.addSeconds(tImpact, 120, new Cesium.JulianDate());
  if (Cesium.JulianDate.greaterThan(stop, viewer.clock.stopTime)) viewer.clock.stopTime = stop;
  viewer.timeline.zoomTo(t0, stop);
}

/** Interpolated state at `t` seconds after launch. */
function sampleAt(samples: TrajectorySample[], t: number): TrajectorySample {
  let lo = 0;
  let hi = samples.length - 1;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[hi].t) return samples[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = (t - a.t) / (b.t - a.t);
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    t,
    ecef: [mix(a.ecef[0], b.ecef[0]), mix(a.ecef[1], b.ecef[1]), mix(a.ecef[2], b.ecef[2])],
    alt: mix(a.alt, b.alt),
    speed: mix(a.speed, b.speed),
    phase: a.phase,
  };
}

const PHASE_NAMES = { boost: 'BOOST', midcourse: 'MIDCOURSE', terminal: 'TERMINAL' } as const;

viewer.clock.onTick.addEventListener((clock) => {
  let shown: Flight | null = null;
  for (const f of flights) {
    const elapsed = Cesium.JulianDate.secondsDifference(clock.currentTime, f.launchTime);
    const tag = `#${f.id}`;
    while (f.nextEvent < f.sim.events.length && f.sim.events[f.nextEvent].t <= elapsed) {
      const ev = f.sim.events[f.nextEvent++];
      const kind = ev.kind === 'launch' || ev.kind === 'impact' ? 'alert' : ev.kind === 'burnout' ? 'notice' : '';
      const text =
        ev.kind === 'launch'
          ? `${tag} LAUNCH — ${f.sol.launch.name} → ${f.sol.target.name}`
          : ev.kind === 'impact'
            ? `${tag} IMPACT — ${f.sol.target.name}`
            : `${tag} T+${fmtClock(ev.t)} ${ev.label}`;
      log(text, kind);
    }
    if (elapsed >= 0 && elapsed <= f.sim.impact!.t) shown = f;
  }

  const el = $('telemetry');
  if (!shown) {
    if (!flights.length) return;
    shown = flights[flights.length - 1];
  }
  const elapsed = Cesium.JulianDate.secondsDifference(clock.currentTime, shown.launchTime);
  const impactT = shown.sim.impact!.t;
  if (elapsed < 0) {
    renderDl(el, [['No missiles in flight', '']]);
    return;
  }
  if (elapsed > impactT) {
    renderDl(el, [
      [`#${shown.id}`, 'DETONATED', 'warn'],
      ['Target', shown.sol.target.name],
      ['Miss', `${Math.round(norm(sub(shown.sim.impact!.ecef, geodeticToEcef(shown.sol.target.lat, shown.sol.target.lon))))} m`],
    ]);
    return;
  }
  const s = sampleAt(shown.sim.samples, elapsed);
  const g = ecefToGeodetic(s.ecef);
  const toGo = vincentyInverse(g.lat, g.lon, shown.sol.target.lat, shown.sol.target.lon).distance;
  renderDl(el, [
    [`#${shown.id} ${shown.sol.spec.name.split(' ')[0]}`, PHASE_NAMES[s.phase], s.phase === 'terminal' ? 'warn' : 'hot'],
    ['Mission time', `T+${fmtClock(elapsed)}`],
    ['Time to impact', fmtClock(impactT - elapsed), 'hot'],
    ['Altitude', fmtKm(s.alt)],
    ['Inertial speed', `${(s.speed / 1000).toFixed(2)} km/s`],
    ['Position', fmtCoord({ name: '', lat: g.lat, lon: g.lon })],
    ['Range to go', fmtKm(toGo)],
  ]);
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const WARPS = [1, 10, 30, 60, 120];
function setWarp(w: number) {
  viewer.clock.multiplier = w;
  viewer.clock.shouldAnimate = true;
  document.querySelectorAll<HTMLButtonElement>('#warpSeg button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.warp) === w);
  });
}
for (const w of WARPS) {
  const b = document.createElement('button');
  b.textContent = `${w}×`;
  b.dataset.warp = String(w);
  b.onclick = () => setWarp(w);
  $('warpSeg').append(b);
}
setWarp(1);

document.querySelectorAll<HTMLButtonElement>('#sideSeg button').forEach((b) => {
  b.onclick = () => applySide(b.dataset.side as Side);
});

launchSel.onchange = () => {
  if (launchSel.value === CUSTOM) return;
  launchPoint = LAUNCH_SITES.filter((s) => s.side === side)[Number(launchSel.value)];
  fillSelect(launchSel, LAUNCH_SITES.filter((s) => s.side === side), launchPoint);
  refreshPoints();
};
targetSel.onchange = () => {
  if (targetSel.value === CUSTOM) return;
  targetPoint = TARGETS.filter((t) => t.side !== side)[Number(targetSel.value)];
  fillSelect(targetSel, TARGETS.filter((t) => t.side !== side), targetPoint);
  refreshPoints();
};
weaponSel.onchange = invalidateSolution;
profileSel.onchange = invalidateSolution;
$('computeBtn').onclick = computeSolution;
launchBtn.onclick = launch;

function setPickMode(mode: typeof pickMode) {
  pickMode = mode;
  pickHint.hidden = !mode;
  $('pickLaunch').classList.toggle('active', mode === 'launch');
  $('pickTarget').classList.toggle('active', mode === 'target');
}
$('pickLaunch').onclick = () => setPickMode(pickMode === 'launch' ? null : 'launch');
$('pickTarget').onclick = () => setPickMode(pickMode === 'target' ? null : 'target');
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setPickMode(null);
});

new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction(
  (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (!pickMode) return;
    const hit = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid);
    if (!hit) return;
    const c = Cesium.Cartographic.fromCartesian(hit);
    const p: GeoPoint = {
      name: '',
      lat: Cesium.Math.toDegrees(c.latitude),
      lon: Cesium.Math.toDegrees(c.longitude),
    };
    p.name = `Designated ${fmtCoord(p)}`;
    if (pickMode === 'launch') {
      launchPoint = p;
      fillSelect(launchSel, LAUNCH_SITES.filter((s) => s.side === side), p);
    } else {
      targetPoint = p;
      fillSelect(targetSel, TARGETS.filter((t) => t.side !== side), p);
    }
    setPickMode(null);
    refreshPoints();
  },
  Cesium.ScreenSpaceEventType.LEFT_CLICK,
);

applySide('USA');
log('Strategic command online. Select a fire mission.', 'notice');
