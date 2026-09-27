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
import { isMuted, setMuted, sfx, unlockAudio } from './ui/audio';
import { showBanner } from './ui/banner';
import { playEnding } from './ui/ending';
import { LAUNCH_SITES, type LaunchSite, type Side, type Target, targetsFor } from './game/sites';
import {
  type ObjectKind,
  RADARS,
  SATELLITES,
  type SensorReport,
  type TrackClass,
  type TrackedObject,
  chaffRadius,
  evaluateSensors,
  radarRange,
  satelliteEcef,
  trackClassAt,
} from './sensors';

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

function log(text: string, kind: '' | 'alert' | 'notice' | 'sensor' = '') {
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
let targets: GeoPoint[] = [targetsFor('USA')[0]];
let solution: FiringSolution | null = null;
let pickMode: 'launch' | 'target' | null = null;
const CUSTOM = '__custom__';

const launchMarker = viewer.entities.add({
  point: { pixelSize: 9, color: GREEN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
  label: { font: FONT, fillColor: GREEN, pixelOffset: new Cesium.Cartesian2(0, -18), showBackground: true, disableDepthTestDistance: Number.POSITIVE_INFINITY },
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
const targetLists: Record<Side, Target[]> = { USA: targetsFor('USA'), USSR: targetsFor('USSR') };
const enemyTargets = () => targetLists[side];
/** The silo field the launch point belongs to (null for a point picked on the globe). */
const launchSite = (): LaunchSite | null => LAUNCH_SITES.find((s) => s === launchPoint) ?? null;
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
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
  $('siteNote').textContent = launchSite()?.note ?? 'Designated launch point';
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
  // Only the missiles actually based at this field (any of ours for a picked point).
  const site = launchSite();
  const prev = weaponSel.value;
  weaponSel.innerHTML = '';
  for (const m of MISSILES.filter((w) => w.side === side && (!site || site.weapons.includes(w.id)))) {
    weaponSel.add(new Option(`${m.name} · ${m.bus.rvCount} RV · ${m.rangeKm.toLocaleString()} km`, m.id, false, m.id === prev));
  }
}

function applySide(newSide: Side) {
  side = newSide;
  document.querySelectorAll<HTMLButtonElement>('#sideSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.side === side);
  });
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
  /** What the other side's satellites and radars make of this flight */
  report: SensorReport;
  launchTime: Cesium.JulianDate;
  nextEvent: number;
  nextSensorEvent: number;
  /** One-shot presentation cues already played (first release, first impact, ...) */
  cues: Set<string>;
  /** Last RV impact, seconds after launch */
  endT: number;
}
const flights: Flight[] = [];
let flightCounter = 0;

/** Ground truth, or only what the enemy's sensors hold (and how they classify it). */
type Picture = 'truth' | 'sensors';
let picture: Picture = 'truth';

const GREY = Cesium.Color.fromCssColorString('#8a9a93');
const CYAN = Cesium.Color.fromCssColorString('#5fd7ff');
const YELLOW = Cesium.Color.fromCssColorString('#ffe066');

const KIND_STYLE: Record<ObjectKind, { color: Cesium.Color; size: number; width: number }> = {
  booster: { color: RED, size: 7, width: 3 },
  bus: { color: GREEN, size: 6, width: 3 },
  rv: { color: AMBER, size: 5, width: 3 },
  stage: { color: GREY, size: 4, width: 1 },
  decoy: { color: GREY, size: 3, width: 1 },
  chaff: { color: CYAN, size: 4, width: 1 },
};
const CLASS_STYLE: Record<TrackClass, { color: Cesium.Color; text: string }> = {
  unknown: { color: YELLOW, text: 'UNKNOWN' },
  rv: { color: RED, text: 'RV' },
  decoy: { color: GREY, text: 'DECOY' },
  chaff: { color: CYAN, text: 'CHAFF' },
  booster: { color: Cesium.Color.WHITE, text: 'BOOSTER' },
  bus: { color: Cesium.Color.WHITE, text: 'PBV' },
  stage: { color: GREY, text: 'DEBRIS' },
};

/** Is the object held by an enemy radar at `t` seconds after launch? */
function seenAt(o: TrackedObject, t: number): boolean {
  const { samples } = o;
  if (!samples.length || t < samples[0].t || t > samples[samples.length - 1].t) return false;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return o.seen[lo];
}

/** One entity per flying object; how it is drawn depends on the picture mode. */
function objectEntity(f: Flight, o: TrackedObject, at: (s: number) => Cesium.JulianDate) {
  const style = KIND_STYLE[o.kind];
  const position = new Cesium.SampledPositionProperty();
  for (const s of o.samples) position.addSample(at(s.t), toCart(s.ecef));
  const start = at(o.samples[0].t);
  const stop = at(o.samples[o.samples.length - 1].t);
  const elapsed = (time: Cesium.JulianDate) => Cesium.JulianDate.secondsDifference(time, f.launchTime);
  const cls = (time: Cesium.JulianDate) => trackClassAt(o, elapsed(time)) ?? 'unknown';
  const truth = () => picture === 'truth';
  const minor = o.kind === 'decoy' || o.kind === 'stage' || o.kind === 'chaff';
  const main = o.kind === 'rv' || o.kind === 'booster' || o.kind === 'bus';
  const label = o.kind === 'booster' ? f.tag : o.kind === 'bus' ? `${f.tag} BUS` : o.id;

  const visible = new Cesium.CallbackProperty((time) => truth() || seenAt(o, elapsed(time!)), false);
  viewer.entities.add({
    availability: during(start, stop),
    position,
    point: {
      show: visible,
      pixelSize: new Cesium.CallbackProperty(() => (truth() ? style.size : 6), false),
      color: new Cesium.CallbackProperty((time) => (truth() ? style.color : CLASS_STYLE[cls(time!)].color), false),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
    },
    ellipsoid: o.chaff
      ? {
          radii: new Cesium.CallbackProperty((time) => {
            const r = chaffRadius(o, elapsed(time!));
            return new Cesium.Cartesian3(r, r, r);
          }, false),
          material: CYAN.withAlpha(0.18),
          show: visible,
        }
      : undefined,
    path: {
      show: new Cesium.CallbackProperty(truth, false),
      leadTime: 0,
      trailTime: 1e6,
      width: style.width,
      resolution: 2,
      material: minor ? style.color.withAlpha(0.5) : new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: style.color }),
    },
    label: {
      show: visible,
      text: new Cesium.CallbackProperty(
        (time) => (truth() ? label : `${CLASS_STYLE[cls(time!)].text} ${o.kind === 'booster' ? '' : o.id.replace(/^(RV|DCY)-/, 'T-')}`),
        false,
      ),
      font: SMALL_FONT,
      fillColor: Cesium.Color.WHITE,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      // Penaid labels only when zoomed in, or the raid becomes a smear of text.
      distanceDisplayCondition: minor ? new Cesium.DistanceDisplayCondition(0, 1_500_000) : undefined,
    },
  });
  if (main) {
    // Keep the flown track on the plot once the vehicle is gone.
    viewer.entities.add({
      availability: forever(stop),
      polyline: {
        show: new Cesium.CallbackProperty(truth, false),
        positions: o.samples.map((s) => toCart(s.ecef)),
        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: style.color.withAlpha(0.6),
      },
    });
  }
}

function launch() {
  if (!solution?.targets[0].feasible) return;
  const sol = solution;
  const sim = flySolution(sol);
  const id = ++flightCounter;
  const tag = `${sol.spec.short} #${id}`;
  const t0 = viewer.clock.currentTime.clone();
  const at = (s: number) => Cesium.JulianDate.addSeconds(t0, s, new Cesium.JulianDate());
  const report = evaluateSensors(sim, sol.spec, Cesium.JulianDate.toDate(t0).getTime());

  let endT = sim.burnout.t;
  for (const rv of sim.rvs) if (rv.impact) endT = Math.max(endT, rv.impact.t);
  const flight: Flight = { id, tag, sol, sim, report, launchTime: t0, nextEvent: 0, nextSensorEvent: 0, endT, cues: new Set() };
  for (const o of report.objects) if (o.samples.length > 1) objectEntity(flight, o, at);

  // Where and when the enemy's early-warning satellites saw the plume.
  const ir = report.events.find((e) => e.kind === 'ir-launch');
  if (ir) {
    viewer.entities.add({
      availability: during(at(ir.t), at(endT + 600)),
      position: toCart(sim.booster[0].ecef),
      ellipse: { semiMajorAxis: 60_000, semiMinorAxis: 60_000, material: CYAN.withAlpha(0.15), outline: false },
      label: {
        text: `IR LAUNCH · ${ir.sensor.toUpperCase()}`,
        font: SMALL_FONT,
        fillColor: CYAN,
        pixelOffset: new Cesium.Cartesian2(0, 18),
      },
    });
  }

  sim.rvs.forEach((rv, k) => {
    if (!rv.released || !rv.impact) return;
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

  flights.push(flight);
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

/** Play a presentation cue once per flight. */
function cue(f: Flight, key: string, play: () => void) {
  if (f.cues.has(key)) return;
  f.cues.add(key);
  play();
}

const SIDE_NAME: Record<Side, string> = { USA: 'AMERICAN', USSR: 'SOVIET' };

/** The first detonation ends the game: there is nothing left to win. */
function endGame(f: Flight, target: string) {
  const r = f.report;
  const firstImpact = Math.min(...f.sim.rvs.filter((rv) => rv.impact).map((rv) => rv.impact!.t));
  const warned = r.firstWarningT !== null && r.firstWarningT < firstImpact;
  viewer.clock.shouldAnimate = false;
  playEnding(
    {
      tag: f.tag,
      target,
      defender: SIDE_NAME[r.observer],
      warning: warned ? firstImpact - r.firstWarningT! : null,
      warnedBy: warned ? (r.events.find((e) => e.t === r.firstWarningT)?.sensor ?? null) : null,
    },
    () => (viewer.clock.shouldAnimate = true),
    () => window.location.reload(),
  );
}

function logEvents(f: Flight, elapsed: number) {
  while (f.nextEvent < f.sim.events.length && f.sim.events[f.nextEvent].t <= elapsed) {
    const ev = f.sim.events[f.nextEvent++];
    const target = ev.rv !== undefined ? f.sol.targets[ev.rv].target.name : '';
    if (ev.kind === 'launch') {
      sfx.klaxon();
      showBanner('LAUNCH', `${f.tag} · ${f.sol.launch.name.toUpperCase()}`, 'alert');
    } else if (ev.kind === 'release') {
      cue(f, 'release', () => {
        sfx.blip();
        showBanner('MIRV RELEASE', `${f.tag} · BUS DEPLOYING WARHEADS`, 'notice');
      });
    } else if (ev.kind === 'reentry') {
      cue(f, 'reentry', () => {
        sfx.warning();
        showBanner('RE-ENTRY', `${f.tag} · WARHEADS IN THE ATMOSPHERE`, 'notice');
      });
    } else if (ev.kind === 'impact') {
      sfx.rumble();
      cue(f, 'impact', () => endGame(f, target));
    }
    if (ev.kind === 'launch') log(`${f.tag} LAUNCH — ${f.sol.launch.name}`, 'alert');
    else if (ev.kind === 'impact') log(`${f.tag} ${ev.label.toUpperCase()} — ${target}`, 'alert');
    else if (ev.kind === 'release') log(`${f.tag} T+${fmtClock(ev.t)} ${ev.label} → ${target}`, 'notice');
    else log(`${f.tag} T+${fmtClock(ev.t)} ${ev.label}`, ev.kind === 'burnout' ? 'notice' : '');
  }
  const sensorEvents = f.report.events;
  while (f.nextSensorEvent < sensorEvents.length && sensorEvents[f.nextSensorEvent].t <= elapsed) {
    const ev = sensorEvents[f.nextSensorEvent++];
    log(`[${f.report.observer}] ${ev.sensor}: ${f.tag} ${ev.text}`, 'sensor');
    if (ev.kind === 'ir-launch') {
      cue(f, 'ir', () => {
        sfx.blip();
        showBanner(`${SIDE_NAME[f.report.observer]} EARLY WARNING`, `${ev.sensor.toUpperCase()} · LAUNCH DETECTED`, 'sensor');
      });
    } else if (ev.kind === 'radar-contact') {
      cue(f, 'radar', () => {
        sfx.blip();
        showBanner('RADAR CONTACT', `${ev.sensor.toUpperCase()} · INCOMING RAID`, 'sensor');
      });
    }
  }
}

function renderTelemetry(f: Flight, elapsed: number) {
  const el = $('telemetry');
  const { sim, report } = f;
  const released = sim.rvs.filter((rv) => rv.released);
  const impacted = released.filter((rv) => rv.impact && rv.impact.t <= elapsed);
  const warned = report.firstWarningT !== null && report.firstWarningT <= elapsed;
  const firstImpact = released.reduce((m, rv) => Math.min(m, rv.impact?.t ?? Infinity), Infinity);
  const firstWarning = report.events.find((e) => e.t === report.firstWarningT);
  const warningRow: [string, string, string?] = [
    `${report.observer} warning`,
    warned ? `T+${fmtClock(report.firstWarningT!)} · ${firstWarning?.sensor ?? ''}` : 'none yet',
    warned ? 'warn' : 'hot',
  ];
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
      warningRow,
      ['Warning time', warned ? fmtClock(firstImpact - report.firstWarningT!) : 'none', 'hot'],
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
  const tracked = report.objects.filter((o) => seenAt(o, elapsed));
  const unknown = tracked.filter((o) => trackClassAt(o, elapsed) === 'unknown').length;
  const rows: [string, string, string?][] = [
    [f.tag, s ? PHASE_NAMES[s.phase] : '—', s?.phase === 'terminal' ? 'warn' : 'hot'],
    ['Mission time', `T+${fmtClock(elapsed)}`],
    ['RVs released', `${released.filter((rv) => rv.releaseT <= elapsed).length} / ${f.sol.targets.length}`],
    ['RVs impacted', `${impacted.length} / ${released.length}`],
    ['Next impact', Number.isFinite(nextImpact) ? fmtClock(nextImpact - elapsed) : '—', 'hot'],
    warningRow,
    ['Enemy radar tracks', tracked.length ? `${tracked.length}${unknown ? ` · ${unknown} unknown` : ''}` : 'none'],
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
// Sensor network overlay
// ---------------------------------------------------------------------------

const SIDE_COLOR: Record<Side, Cesium.Color> = {
  USA: Cesium.Color.fromCssColorString('#6fb6ff'),
  USSR: Cesium.Color.fromCssColorString('#ff7b7b'),
};

/** Point reached from (lat, lon) along `bearing` [deg] after `dist` metres on a sphere. */
function destination(lat: number, lon: number, bearing: number, dist: number) {
  const d = dist / 6_371_000;
  const [p1, l1, b] = [Cesium.Math.toRadians(lat), Cesium.Math.toRadians(lon), Cesium.Math.toRadians(bearing)];
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return Cesium.Cartesian3.fromRadians(l2, p2);
}

const sensorEntities: Cesium.Entity[] = [];
function buildSensorOverlay() {
  for (const r of RADARS) {
    const color = SIDE_COLOR[r.side];
    const range = radarRange(r, 1);
    const all = r.halfWidth >= 180;
    const arc: Cesium.Cartesian3[] = [];
    for (let a = -r.halfWidth; a <= r.halfWidth; a += all ? 6 : 3) arc.push(destination(r.lat, r.lon, r.boresight + a, range));
    const site = Cesium.Cartesian3.fromDegrees(r.lon, r.lat);
    const ring = all ? arc : [site, ...arc, site];
    sensorEntities.push(
      viewer.entities.add({
        position: site,
        point: { pixelSize: 6, color },
        label: {
          text: r.name.toUpperCase(),
          font: SMALL_FONT,
          fillColor: color,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12_000_000),
        },
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(ring),
          material: color.withAlpha(0.07),
          height: 0,
        },
        polyline: { positions: all ? [...arc, arc[0]] : ring, width: 1, material: color.withAlpha(0.6) },
      }),
    );
  }
  for (const sat of SATELLITES) {
    const color = SIDE_COLOR[sat.side];
    sensorEntities.push(
      viewer.entities.add({
        position: new Cesium.CallbackPositionProperty(
          (time) => toCart(satelliteEcef(sat, Cesium.JulianDate.toDate(time!).getTime())),
          false,
        ),
        point: { pixelSize: 6, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
        label: { text: sat.name.toUpperCase(), font: SMALL_FONT, fillColor: color, pixelOffset: new Cesium.Cartesian2(0, -12) },
      }),
    );
  }
  // All nine Oko satellites share one Earth-fixed track (it repeats every sidereal day).
  const oko = SATELLITES.find((s) => s.orbit)!;
  const track: Cesium.Cartesian3[] = [];
  for (let m = 0; m <= 1440; m += 4) track.push(toCart(satelliteEcef(oko, oko.orbit!.epochMs + m * 60_000)));
  sensorEntities.push(
    viewer.entities.add({
      polyline: { positions: track, width: 1, arcType: Cesium.ArcType.NONE, material: SIDE_COLOR.USSR.withAlpha(0.35) },
    }),
  );
  setSensorsShown(false);
}

/** Silo fields of both sides, always on the map and clickable. */
const fieldEntities = new Map<Cesium.Entity, LaunchSite>();
function buildFieldOverlay() {
  for (const site of LAUNCH_SITES) {
    const color = site.scenario ? GREEN : SIDE_COLOR[site.side];
    const e = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
      ellipse: {
        semiMajorAxis: site.fieldRadius * 1000,
        semiMinorAxis: site.fieldRadius * 1000,
        height: 0,
        material: color.withAlpha(0.12),
        outline: true,
        outlineColor: color.withAlpha(0.7),
      },
      point: { pixelSize: 4, color },
      label: {
        text: site.name.replace(/ AFB.*| \(scenario\)/, '').toUpperCase(),
        font: SMALL_FONT,
        fillColor: color,
        pixelOffset: new Cesium.Cartesian2(0, 12),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9_000_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    fieldEntities.set(e, site);
  }
}

let sensorsShown = false;
function setSensorsShown(on: boolean) {
  sensorsShown = on;
  for (const e of sensorEntities) e.show = on;
  $('sensorsBtn').classList.toggle('active', on);
}

function setPicture(p: Picture) {
  picture = p;
  document.querySelectorAll<HTMLButtonElement>('#pictureSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.picture === p);
  });
  $('legend').hidden = p !== 'sensors';
  if (p === 'sensors') setSensorsShown(true);
}

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
    if (!pickMode) {
      // Clicking a silo field: ours becomes the launch site, the enemy's a target.
      const picked = viewer.scene.pick(e.position) as { id?: Cesium.Entity } | undefined;
      const site = picked?.id ? fieldEntities.get(picked.id) : undefined;
      if (!site) return;
      if (site.side === side) {
        launchPoint = site;
        fillLaunchSelect();
        refreshPlan();
      } else {
        const t = enemyTargets().find((x) => x.name === `${site.name} missile field`);
        if (t && !targets.includes(t)) addTarget(t);
      }
      return;
    }
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

document.querySelectorAll<HTMLButtonElement>('#pictureSeg button').forEach((b) => {
  b.onclick = () => setPicture(b.dataset.picture as Picture);
});
$('sensorsBtn').onclick = () => setSensorsShown(!sensorsShown);
buildSensorOverlay();
buildFieldOverlay();
setPicture('truth');

// Title screen and sound.
$('titleBuild').textContent = `BUILD ${__BUILD__}`;
$('titleStart').onclick = () => {
  unlockAudio();
  sfx.confirm();
  $('title').hidden = true;
};
$('muteBtn').onclick = () => {
  setMuted(!isMuted());
  $('muteBtn').textContent = isMuted() ? 'SND OFF' : 'SND ON';
};

$('build').textContent = `BUILD ${__BUILD__}`;
document.title = `World War 198X · build ${__BUILD__}`;
applySide('USA');
log('Strategic command online. Select a fire mission.', 'notice');
