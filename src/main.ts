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
const SMALL_FONT = '11px "Share Tech Mono", monospace';

const toCart = (v: Vec3) => new Cesium.Cartesian3(v[0], v[1], v[2]);
const surface = (v: Vec3) => {
  const g = ecefToGeodetic(v);
  return Cesium.Cartesian3.fromDegrees(g.lon, g.lat, 0);
};
const rvLetter = (k: number) => String.fromCharCode(65 + k);
const forever = (start: Cesium.JulianDate) =>
  new Cesium.TimeIntervalCollection([
    new Cesium.TimeInterval({ start, stop: Cesium.JulianDate.addDays(start, 365, new Cesium.JulianDate()) }),
  ]);
const during = (start: Cesium.JulianDate, stop: Cesium.JulianDate) =>
  new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]);

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const weaponSel = $<HTMLSelectElement>('weapon');
const launchSel = $<HTMLSelectElement>('launchSel');
const targetSel = $<HTMLSelectElement>('targetSel');
const profileSel = $<HTMLSelectElement>('profile');
const launchBtn = $<HTMLButtonElement>('launchBtn');
const addTargetBtn = $<HTMLButtonElement>('addTarget');
const pickHint = $('pickHint');

const fmtCoord = (p: { lat: number; lon: number }) =>
  `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}`;
const fmtKm = (m: number) => `${Math.round(m / 1000).toLocaleString('en-US')} km`;
const fmtClock = (s: number) => {
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(Math.round(s));
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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
/** Target list; the first is the booster's primary, the rest are reached by the MIRV bus. */
let targets: GeoPoint[] = [TARGETS[0]];
let solution: FiringSolution | null = null;
let pickMode: 'launch' | 'target' | null = null;
const CUSTOM = '__custom__';

const launchMarker = viewer.entities.add({
  point: { pixelSize: 9, color: GREEN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
  label: { font: FONT, fillColor: GREEN, pixelOffset: new Cesium.Cartesian2(0, -18), showBackground: true },
});

/** Entities that belong to the current mission plan (target markers, predicted tracks). */
let planEntities: Cesium.Entity[] = [];
function clearPlan() {
  for (const e of planEntities) viewer.entities.remove(e);
  planEntities = [];
}
const plan = (options: Cesium.Entity.ConstructorOptions) => {
  const e = viewer.entities.add(options);
  planEntities.push(e);
  return e;
};

const sideSites = () => LAUNCH_SITES.filter((s) => s.side === side);
const enemyTargets = () => TARGETS.filter((t) => t.side !== side);
const currentWeapon = (): MissileSpec => MISSILES.find((m) => m.id === weaponSel.value)!;

function drawTargets() {
  targets.forEach((t, k) => {
    plan({
      position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat),
      point: { pixelSize: 9, color: RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
      label: {
        text: `${rvLetter(k)} · ${t.name.toUpperCase()}`,
        font: FONT,
        fillColor: RED,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        showBackground: true,
      },
    });
  });
}

function renderTargetList() {
  const cap = currentWeapon().bus.rvCount;
  $('rvCount').textContent = `${targets.length} / ${cap} RV`;
  addTargetBtn.disabled = targets.length >= cap;
  $('pickTarget').toggleAttribute('disabled', targets.length >= cap);
  $('targetList').innerHTML = targets
    .map(
      (t, k) => `<li><span class="rv">${rvLetter(k)}</span><span class="name" title="${escapeHtml(fmtCoord(t))}">${escapeHtml(t.name)}</span>
      ${k === 0 ? '<span class="tag">PRIMARY</span>' : ''}
      ${targets.length > 1 ? `<button data-remove="${k}" title="Remove">×</button>` : ''}</li>`,
    )
    .join('');
  $('targetList')
    .querySelectorAll<HTMLButtonElement>('button[data-remove]')
    .forEach((b) => {
      b.onclick = () => {
        targets.splice(Number(b.dataset.remove), 1);
        refreshPlan();
      };
    });
}

/** Any change to the mission invalidates the solution and redraws the plan. */
function refreshPlan() {
  solution = null;
  $('solutionBox').hidden = true;
  launchMarker.position = new Cesium.ConstantPositionProperty(
    Cesium.Cartesian3.fromDegrees(launchPoint.lon, launchPoint.lat),
  );
  launchMarker.label!.text = new Cesium.ConstantProperty(launchPoint.name.toUpperCase());
  $('launchCoord').textContent = fmtCoord(launchPoint);
  targets = targets.slice(0, currentWeapon().bus.rvCount);
  renderTargetList();
  clearPlan();
  drawTargets();
}

function fillLaunchSelect() {
  launchSel.innerHTML = '';
  const sites = sideSites();
  sites.forEach((p, i) => launchSel.add(new Option(p.name, String(i), false, p === launchPoint)));
  if (!sites.includes(launchPoint as (typeof sites)[number])) {
    launchSel.add(new Option(launchPoint.name, CUSTOM, false, true));
  }
}

function applySide(newSide: Side) {
  side = newSide;
  /** Fly to a point set, framed with at least `minRadius` metres around it. */
function frame(points: GeoPoint[], minRadius: number) {
  const sphere = Cesium.BoundingSphere.fromPoints(points.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat)));
  sphere.radius = Math.max(sphere.radius, minRadius);
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), sphere.radius * 4),
  });
}
document.querySelectorAll<HTMLButtonElement>('#cameraSeg button').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.view === 'launch') frame([launchPoint], 150_000);
    else if (b.dataset.view === 'targets') frame(targets, 150_000);
    else frame([launchPoint, ...targets], 3_000_000);
  };
});

document.querySelectorAll<HTMLButtonElement>('#sideSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.side === side);
  });
  weaponSel.innerHTML = '';
  for (const m of MISSILES.filter((w) => w.side === side)) {
    weaponSel.add(new Option(`${m.name} · ${m.bus.rvCount} RV · ${m.rangeKm.toLocaleString()} km`, m.id));
  }
  launchPoint = sideSites()[0];
  fillLaunchSelect();
  targetSel.innerHTML = '';
  enemyTargets().forEach((t, i) => targetSel.add(new Option(t.name, String(i))));
  targets = [enemyTargets()[0]];
  refreshPlan();
}

function addTarget(p: GeoPoint) {
  if (targets.length >= currentWeapon().bus.rvCount) return;
  targets.push(p);
  refreshPlan();
}

// ---------------------------------------------------------------------------
// Fire control
// ---------------------------------------------------------------------------

function computeSolution() {
  const spec = currentWeapon();
  const profile = profileSel.value as TrajectoryProfile;
  const t0 = performance.now();
  const sol = solveFiringSolution(spec, launchPoint, targets, profile);
  solution = sol;
  const ms = performance.now() - t0;
  const n = sol.nominal;
  const primary = sol.targets[0];
  const rv0 = n.rvs[0];

  const rows: [string, string, string?][] = [
    ['Range to primary', fmtKm(primary.range)],
    ['Launch azimuth', `${primary.azimuth.toFixed(1).padStart(5, '0')}°`],
  ];
  if (primary.feasible && rv0.impact) {
    rows.push(
      ['Burnout', `T+${n.burnout.t.toFixed(0)} s · ${fmtKm(n.burnout.alt)}`],
      ['Burnout velocity', `${(n.burnout.speed / 1000).toFixed(2)} km/s @ ${n.burnout.flightPathAngle.toFixed(1)}°`],
      ['Apogee', fmtKm(rv0.apogee.alt)],
      ['Impact velocity', `${(rv0.impact.speed / 1000).toFixed(2)} km/s`],
      ['J2/drag aim offset', `${(primary.aimOffset / 1000).toFixed(1)} km`],
      [
        'Bus propellant',
        `${n.busPropellantUsed.toFixed(0)} / ${spec.bus.propellant} kg · Δv ${n.busDvUsed.toFixed(0)} m/s`,
        n.busPropellantUsed > 0.9 * spec.bus.propellant ? 'hot' : '',
      ],
      ['Solver', `${sol.iterations} iter · ${ms.toFixed(0)} ms`],
      ['Expected CEP', `${spec.cep} m`, 'hot'],
    );
  } else {
    rows.push(['Status', 'PRIMARY OUT OF RANGE', 'warn'], ['Missing Δv', `${n.residualVgo.toFixed(0)} m/s`, 'warn']);
  }
  renderDl($('solution'), rows);

  $('rvTable').innerHTML =
    '<tr><th>RV</th><th>Target</th><th>Impact</th><th>Bus Δv</th><th>Status</th></tr>' +
    sol.targets
      .map((t, k) => {
        const rv = n.rvs[k];
        const status = t.feasible ? `${t.nominalMiss.toFixed(1)} m` : primary.feasible ? 'FOOTPRINT' : '—';
        const dv = Number.isNaN(rv.busDv) ? '—' : `${rv.busDv.toFixed(0)}`;
        return `<tr><td>${rvLetter(k)}</td><td>${escapeHtml(t.target.name)}</td>
          <td class="num">${rv.impact ? `T+${fmtClock(rv.impact.t)}` : '—'}</td>
          <td class="num">${dv}</td><td class="${t.feasible ? 'ok' : 'warn'}">${status}</td></tr>`;
      })
      .join('');
  $('solutionBox').hidden = false;
  launchBtn.disabled = !primary.feasible;

  // Predicted tracks: booster + bus, then each RV, with ground tracks.
  clearPlan();
  drawTargets();
  const busTrack = [...n.booster, ...n.bus];
  const dashed = (samples: TrajectorySample[], color: Cesium.Color) => {
    plan({
      polyline: {
        positions: samples.map((s) => toCart(s.ecef)),
        width: 1.5,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 12 }),
      },
    });
    plan({
      polyline: {
        positions: samples.map((s) => surface(s.ecef)),
        width: 1,
        arcType: Cesium.ArcType.NONE,
        material: color.withAlpha(0.3),
      },
    });
  };
  dashed(busTrack, GREEN);
  n.rvs.forEach((rv) => rv.released && dashed(rv.samples, AMBER));
  sol.targets.forEach((t, k) => {
    if (!t.feasible) return;
    plan({
      position: toCart(t.aimEcef),
      point: { pixelSize: 5, color: AMBER },
      label: {
        // Where guidance really aims, after J2/drag compensation.
        text: `AIM ${rvLetter(k)}`,
        font: SMALL_FONT,
        fillColor: AMBER,
        horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
        pixelOffset: new Cesium.Cartesian2(-10, 0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
      },
    });
  });
  viewer.flyTo(planEntities, { duration: 1.5 });

  const out = sol.targets.filter((t) => !t.feasible).length;
  if (!primary.feasible) log(`No solution: ${primary.target.name} beyond ${spec.name} capability`, 'alert');
  else {
    log(
      `Solution: ${launchPoint.name} → ${targets.length} target(s), first impact T+${fmtClock(
        Math.min(...n.rvs.filter((r) => r.impact).map((r) => r.impact!.t)),
      )}`,
    );
    if (out) log(`${out} target(s) outside bus footprint — those RVs will stay on the bus`, 'notice');
  }
}

// ---------------------------------------------------------------------------
// Missiles in flight
// ---------------------------------------------------------------------------

interface Flight {
  id: number;
  tag: string;
  sol: FiringSolution;
  sim: SimResult;
  launchTime: Cesium.JulianDate;
  nextEvent: number;
  /** Last RV impact, seconds after launch */
  endT: number;
}
const flights: Flight[] = [];
let flightCounter = 0;

function trackEntity(
  samples: TrajectorySample[],
  at: (s: number) => Cesium.JulianDate,
  color: Cesium.Color,
  label: string,
  pixelSize: number,
) {
  const position = new Cesium.SampledPositionProperty();
  for (const s of samples) position.addSample(at(s.t), toCart(s.ecef));
  const start = at(samples[0].t);
  const stop = at(samples[samples.length - 1].t);
  viewer.entities.add({
    availability: during(start, stop),
    position,
    point: { pixelSize, color: Cesium.Color.WHITE, outlineColor: color, outlineWidth: 2 },
    path: {
      leadTime: 0,
      trailTime: 1e6,
      width: 3,
      resolution: 2,
      material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color }),
    },
    label: { text: label, font: SMALL_FONT, fillColor: Cesium.Color.WHITE, pixelOffset: new Cesium.Cartesian2(0, -14) },
  });
  // Keep the flown track on the plot once the vehicle is gone.
  viewer.entities.add({
    availability: forever(stop),
    polyline: {
      positions: samples.map((s) => toCart(s.ecef)),
      width: 2,
      arcType: Cesium.ArcType.NONE,
      material: color.withAlpha(0.6),
    },
  });
}

function launch() {
  if (!solution?.targets[0].feasible) return;
  const sol = solution;
  const sim = flySolution(sol);
  const id = ++flightCounter;
  const tag = `${sol.spec.side === 'USA' ? 'MM-III' : 'SS-18'} #${id}`;
  const t0 = viewer.clock.currentTime.clone();
  const at = (s: number) => Cesium.JulianDate.addSeconds(t0, s, new Cesium.JulianDate());

  trackEntity(sim.booster, at, RED, tag, 7);
  if (sim.bus.length > 1) trackEntity(sim.bus, at, GREEN, `${tag} BUS`, 6);

  let endT = sim.burnout.t;
  sim.rvs.forEach((rv, k) => {
    if (!rv.released || !rv.impact) return;
    endT = Math.max(endT, rv.impact.t);
    trackEntity(rv.samples, at, AMBER, `RV-${rvLetter(k)}`, 5);

    // Detonation flash: an expanding, fading disc at the actual impact point.
    const tImpact = at(rv.impact.t);
    const age = (time: Cesium.JulianDate) => Cesium.JulianDate.secondsDifference(time, tImpact);
    const flashSeconds = 40;
    const radius = new Cesium.CallbackProperty(
      (time) => 2000 + 23000 * Math.min(1, age(time!) / flashSeconds),
      false,
    );
    const target = sol.targets[k].target;
    const miss = norm(sub(rv.impact.ecef, geodeticToEcef(target.lat, target.lon)));
    viewer.entities.add({
      availability: forever(tImpact),
      position: toCart(rv.impact.ecef),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(
            (time) => AMBER.withAlpha(Math.max(0.15, 0.85 * (1 - age(time!) / flashSeconds))),
            false,
          ),
        ),
      },
      point: { pixelSize: 6, color: RED },
      label: {
        text: `#${id}-${rvLetter(k)} · ${Math.round(miss)} m`,
        font: SMALL_FONT,
        fillColor: AMBER,
        pixelOffset: new Cesium.Cartesian2(0, 16),
      },
    });
  });

  flights.push({ id, tag, sol, sim, launchTime: t0, nextEvent: 0, endT });
  if (viewer.clock.multiplier < 30) setWarp(30);
  const stop = at(endT + 120);
  if (Cesium.JulianDate.greaterThan(stop, viewer.clock.stopTime)) viewer.clock.stopTime = stop;
  viewer.timeline.zoomTo(t0, stop);
}

/** Interpolated state at `t` seconds after launch, or null outside the samples. */
function sampleAt(samples: TrajectorySample[], t: number): TrajectorySample | null {
  if (!samples.length || t < samples[0].t || t > samples[samples.length - 1].t) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    t,
    ecef: [mix(a.ecef[0], b.ecef[0]), mix(a.ecef[1], b.ecef[1]), mix(a.ecef[2], b.ecef[2])],
    alt: mix(a.alt, b.alt),
    speed: mix(a.speed, b.speed),
    phase: a.phase,
  };
}

const PHASE_NAMES = { boost: 'BOOST', bus: 'BUS DEPLOYMENT', midcourse: 'MIDCOURSE', terminal: 'TERMINAL' } as const;

function logEvents(f: Flight, elapsed: number) {
  while (f.nextEvent < f.sim.events.length && f.sim.events[f.nextEvent].t <= elapsed) {
    const ev = f.sim.events[f.nextEvent++];
    const target = ev.rv !== undefined ? f.sol.targets[ev.rv].target.name : '';
    if (ev.kind === 'launch') log(`${f.tag} LAUNCH — ${f.sol.launch.name}`, 'alert');
    else if (ev.kind === 'impact') log(`${f.tag} ${ev.label.toUpperCase()} — ${target}`, 'alert');
    else if (ev.kind === 'release') log(`${f.tag} T+${fmtClock(ev.t)} ${ev.label} → ${target}`, 'notice');
    else log(`${f.tag} T+${fmtClock(ev.t)} ${ev.label}`, ev.kind === 'burnout' ? 'notice' : '');
  }
}

function renderTelemetry(f: Flight, elapsed: number) {
  const el = $('telemetry');
  const { sim } = f;
  const released = sim.rvs.filter((rv) => rv.released);
  const impacted = released.filter((rv) => rv.impact && rv.impact.t <= elapsed);
  if (elapsed > f.endT) {
    renderDl(el, [
      [f.tag, 'ALL RVs DETONATED', 'warn'],
      ...released.map((rv): [string, string] => {
        const t = f.sol.targets[rv.index].target;
        return [
          `RV-${rvLetter(rv.index)} ${t.name}`,
          `${Math.round(norm(sub(rv.impact!.ecef, geodeticToEcef(t.lat, t.lon))))} m`,
        ];
      }),
    ]);
    return;
  }
  // Show the bus while it exists, then the next RV still falling.
  const falling = released
    .filter((rv) => rv.impact && rv.impact.t > elapsed && rv.releaseT <= elapsed)
    .sort((a, b) => a.impact!.t - b.impact!.t);
  const s =
    sampleAt(sim.booster, elapsed) ??
    sampleAt(sim.bus, elapsed) ??
    (falling.length ? sampleAt(falling[0].samples, elapsed) : null);
  const nextImpact = released
    .filter((rv) => rv.impact!.t > elapsed)
    .reduce((m, rv) => Math.min(m, rv.impact!.t), Infinity);
  const rows: [string, string, string?][] = [
    [f.tag, s ? PHASE_NAMES[s.phase] : '—', s?.phase === 'terminal' ? 'warn' : 'hot'],
    ['Mission time', `T+${fmtClock(elapsed)}`],
    ['RVs released', `${released.filter((rv) => rv.releaseT <= elapsed).length} / ${f.sol.targets.length}`],
    ['RVs impacted', `${impacted.length} / ${released.length}`],
    ['Next impact', Number.isFinite(nextImpact) ? fmtClock(nextImpact - elapsed) : '—', 'hot'],
  ];
  if (s) {
    const g = ecefToGeodetic(s.ecef);
    rows.push(
      ['Altitude', fmtKm(s.alt)],
      ['Inertial speed', `${(s.speed / 1000).toFixed(2)} km/s`],
      ['Position', fmtCoord(g)],
    );
    if (falling.length && s.phase !== 'boost' && s.phase !== 'bus') {
      const t = f.sol.targets[falling[0].index].target;
      rows.push([`Range to ${t.name}`, fmtKm(vincentyInverse(g.lat, g.lon, t.lat, t.lon).distance)]);
    }
  }
  renderDl(el, rows);
}

viewer.clock.onTick.addEventListener((clock) => {
  let shown: Flight | null = null;
  for (const f of flights) {
    const elapsed = Cesium.JulianDate.secondsDifference(clock.currentTime, f.launchTime);
    logEvents(f, elapsed);
    if (elapsed >= 0 && elapsed <= f.endT) shown = f;
  }
  if (!shown && flights.length) shown = flights[flights.length - 1];
  if (!shown) return;
  const elapsed = Cesium.JulianDate.secondsDifference(clock.currentTime, shown.launchTime);
  if (elapsed < 0) renderDl($('telemetry'), [['No missiles in flight', '']]);
  else renderTelemetry(shown, elapsed);
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

/** Fly to a point set, framed with at least `minRadius` metres around it. */
function frame(points: GeoPoint[], minRadius: number) {
  const sphere = Cesium.BoundingSphere.fromPoints(points.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat)));
  sphere.radius = Math.max(sphere.radius, minRadius);
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), sphere.radius * 4),
  });
}
document.querySelectorAll<HTMLButtonElement>('#cameraSeg button').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.view === 'launch') frame([launchPoint], 150_000);
    else if (b.dataset.view === 'targets') frame(targets, 150_000);
    else frame([launchPoint, ...targets], 3_000_000);
  };
});

document.querySelectorAll<HTMLButtonElement>('#sideSeg button').forEach((b) => {
  b.onclick = () => applySide(b.dataset.side as Side);
});

launchSel.onchange = () => {
  if (launchSel.value === CUSTOM) return;
  launchPoint = sideSites()[Number(launchSel.value)];
  fillLaunchSelect();
  refreshPlan();
};
addTargetBtn.onclick = () => addTarget(enemyTargets()[Number(targetSel.value)]);
weaponSel.onchange = refreshPlan;
profileSel.onchange = refreshPlan;
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
    const lat = Cesium.Math.toDegrees(c.latitude);
    const lon = Cesium.Math.toDegrees(c.longitude);
    const p: GeoPoint = { name: `Designated ${fmtCoord({ lat, lon })}`, lat, lon };
    const mode = pickMode;
    setPickMode(null);
    if (mode === 'launch') {
      launchPoint = p;
      fillLaunchSelect();
      refreshPlan();
    } else {
      addTarget(p);
    }
  },
  Cesium.ScreenSpaceEventType.LEFT_CLICK,
);

applySide('USA');
log('Strategic command online. Select a fire mission.', 'notice');
