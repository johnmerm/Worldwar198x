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
import { IntelFeed, type IntelPacket, type TrackPoint } from './game/intel';
import { type Burst, type WorldHealth, assessDamage, collapseTimes, damageRadii, scorchMap } from './game/damage';
import { createScorch } from './ui/scorch';
import { type Strategy, planSalvo } from './game/salvo';
import { flyInWorker, solveInWorker } from './game/fireControl';
import { withoutTracks } from './game/thin';
import { type Outcome, decideOutcome } from './game/outcome';
import { type ClockState, retime, worldTime } from './net/clock';
import { type Message, openLink, playerTwoUrl } from './net/link';
import {
  type ObjectKind,
  RADARS,
  SATELLITES,
  type SensorReport,
  type TrackClass,
  type TrackedObject,
  chaffRadius,
  evaluateSensors,
  opponent,
  radarRange,
  satelliteEcef,
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
  // Time belongs to the shared world clock: no local pause or scrubbing.
  animation: false,
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
viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;

// ---------------------------------------------------------------------------
// Players and the shared world clock
// ---------------------------------------------------------------------------

/** Player 1 is this page; player 2 a popup it opens. Only world events and sensor reports cross between them. */
const link = openLink();
const isP1 = link.role === 'p1';
let peerOnline = false;

let worldClock: ClockState = { simMs: Date.now(), wallMs: Date.now(), rate: 1, running: true };
const worldNow = () => worldTime(worldClock, Date.now());

/** Adopt a clock state; `broadcast` also sends it to the other window. */
function setClock(c: ClockState, broadcast: boolean) {
  worldClock = c;
  viewer.clock.multiplier = c.rate;
  viewer.clock.shouldAnimate = c.running;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(worldNow()));
  document.querySelectorAll<HTMLButtonElement>('#warpSeg button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.warp) === c.rate);
  });
  if (broadcast) link.send({ type: 'clock', clock: c });
}
const changeClock = (change: Parameters<typeof retime>[2]) => setClock(retime(worldClock, Date.now(), change), true);

// Registered before any other tick listener, so they all see world time.
viewer.clock.onTick.addEventListener((clock) => {
  clock.currentTime = Cesium.JulianDate.fromDate(new Date(worldNow()));
});
viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(worldNow()));
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

/** Log a line stamped with world time `atMs` (default: now). */
function log(text: string, kind: '' | 'alert' | 'notice' | 'sensor' = '', atMs = worldNow()) {
  const li = document.createElement('li');
  if (kind) li.className = kind;
  li.innerHTML = `<time>${new Date(atMs).toISOString().slice(11, 19)}Z</time>`;
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
  setSensorsShown(sensorsShown);
  renderHealth();
  if (isP1) link.send({ type: 'side', side });
  setPeer(peerOnline);
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
  /** What the other side's satellites and radars make of this flight (for the debrief only) */
  report: SensorReport;
  /** Streams that picture to the other player as it happens */
  feed: IntelFeed;
  launchTime: Cesium.JulianDate;
  launchMs: number;
  nextEvent: number;
  /** One-shot presentation cues already played (first release, first impact, ...) */
  cues: Set<string>;
  /** Last RV impact, seconds after launch */
  endT: number;
}
const flights: Flight[] = [];
let flightCounter = 0;

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

/** One entity per flying object of our own missiles: we know exactly what each one is. */
/** Seconds between drawn points: the physics steps down to 0.1 s, far finer than the eye needs. */
const DRAW_SPACING_S = 4;

/** Every DRAW_SPACING_S-th second of a track, always keeping the last point. */
function thin(samples: TrajectorySample[]): TrajectorySample[] {
  const out: TrajectorySample[] = [];
  let last = -Infinity;
  samples.forEach((s, i) => {
    if (s.t - last >= DRAW_SPACING_S || i === samples.length - 1) {
      out.push(s);
      last = s.t;
    }
  });
  return out;
}

function objectEntity(f: Flight, o: TrackedObject, at: (s: number) => Cesium.JulianDate) {
  const style = KIND_STYLE[o.kind];
  const drawn = thin(o.samples);
  const position = new Cesium.SampledPositionProperty();
  position.addSamples(
    drawn.map((s) => at(s.t)),
    drawn.map((s) => toCart(s.ecef)),
  );
  const start = at(o.samples[0].t);
  const stop = at(o.samples[o.samples.length - 1].t);
  const elapsed = (time: Cesium.JulianDate) => Cesium.JulianDate.secondsDifference(time, f.launchTime);
  const minor = o.kind === 'decoy' || o.kind === 'stage' || o.kind === 'chaff';
  const main = o.kind === 'rv' || o.kind === 'booster' || o.kind === 'bus';
  const label = o.kind === 'booster' ? f.tag : o.kind === 'bus' ? `${f.tag} BUS` : o.id;

  viewer.entities.add({
    availability: during(start, stop),
    position,
    point: {
      pixelSize: style.size,
      color: style.color,
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
        }
      : undefined,
    // Trails only for booster, bus and RVs: a salvo carries hundreds of decoys and chaff clouds.
    path: minor
      ? undefined
      : {
          leadTime: 0,
          trailTime: 1e6,
          width: style.width,
          resolution: 10,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: style.color }),
        },
    label: {
      text: label,
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
        positions: drawn.map((s) => toCart(s.ecef)),
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
  const launchMs = worldNow();
  const sim = flySolution(sol);
  launchFlight(sol, sim, evaluateSensors(sim, sol.spec, launchMs), launchMs);
}

/** Put one flown missile on the globe, lifting off at world time `launchMs`. */
function launchFlight(sol: FiringSolution, sim: SimResult, report: SensorReport, launchMs: number) {
  const id = ++flightCounter;
  const tag = `${sol.spec.short} #${id}`;
  const t0 = Cesium.JulianDate.fromDate(new Date(launchMs));
  const at = (s: number) => Cesium.JulianDate.addSeconds(t0, s, new Cesium.JulianDate());
  const feed = new IntelFeed(report, sim, launchMs, sol.spec.yieldKt);

  let endT = sim.burnout.t;
  for (const rv of sim.rvs) if (rv.impact) endT = Math.max(endT, rv.impact.t);
  const flight: Flight = { id, tag, sol, sim, report, feed, launchTime: t0, launchMs, nextEvent: 0, endT, cues: new Set() };
  for (const o of report.objects) if (o.samples.length > 1) objectEntity(flight, o, at);

  sim.rvs.forEach((rv, k) => {
    if (!rv.released || !rv.impact) return;
    const target = sol.targets[k].target;
    const miss = norm(sub(rv.impact.ecef, geodeticToEcef(target.lat, target.lon)));
    detonationEntity(rv.impact.ecef, at(rv.impact.t), `#${id}-${rvLetter(k)} · ${Math.round(miss)} m`);
  });

  flights.push(flight);
  lockSide();
  // Warping up on launch would tell the other player something is flying.
  if (!peerOnline && worldClock.rate < 30) setWarp(30);
  const stop = at(endT + 120);
  if (Cesium.JulianDate.greaterThan(stop, viewer.clock.stopTime)) viewer.clock.stopTime = stop;
  viewer.timeline.zoomTo(t0, stop);
}

// ---------------------------------------------------------------------------
// Massive strike: a salvo of missiles, hand-picked or assigned by a strategy
// ---------------------------------------------------------------------------

const salvo: FiringSolution[] = [];
/** Seconds between lift-offs in a ripple launch. */
const RIPPLE_S = 1;
let salvoBusy = false;

function renderSalvo(status = '') {
  const rvs = salvo.reduce((n, s) => n + s.targets.filter((t) => t.feasible).length, 0);
  $('salvoCount').textContent = salvo.length ? `${salvo.length} MSL · ${rvs} RV` : '';
  $('salvoList').innerHTML = salvo
    .map((s, k) => {
      const [first, ...rest] = s.targets.map((t) => t.target.name);
      const more = rest.length ? ` +${rest.length}` : '';
      return `<li><span class="name" title="${escapeHtml(s.targets.map((t) => t.target.name).join(', '))}">${escapeHtml(
        `${s.spec.short} · ${s.launch.name.replace(/ AFB.*/, '')} → ${first}${more}`,
      )}</span><button data-drop="${k}" title="Remove">×</button></li>`;
    })
    .join('');
  $('salvoList')
    .querySelectorAll<HTMLButtonElement>('button[data-drop]')
    .forEach((b) => {
      b.onclick = () => {
        salvo.splice(Number(b.dataset.drop), 1);
        renderSalvo();
      };
    });
  $('salvoStatus').textContent = status;
  const idle = !salvoBusy;
  $<HTMLButtonElement>('salvoLaunch').disabled = !salvo.length || !idle;
  $<HTMLButtonElement>('salvoGen').disabled = !idle;
  $<HTMLButtonElement>('salvoClear').disabled = !salvo.length || !idle;
}

function addToSalvo() {
  if (!solution?.targets[0].feasible) return;
  salvo.push(withoutTracks(solution));
  renderSalvo();
  log(`Added to salvo: ${solution.spec.short} from ${solution.launch.name}`, 'notice');
}

/** Assign origins and targets by strategy, then solve every missile (dropping any the computer cannot solve). */
async function generateSalvo() {
  const count = Math.max(1, Math.min(50, Math.round(Number($<HTMLInputElement>('salvoN').value) || 1)));
  const plans = planSalvo($<HTMLSelectElement>('salvoStrategy').value as Strategy, side, count);
  salvoBusy = true;
  let dropped = 0;
  let done = 0;
  renderSalvo(`Solving 0 / ${plans.length}…`);
  const sols = await Promise.all(
    plans.map((p) =>
      solveInWorker(p.spec.id, p.launch, p.targets, 'minimum-energy').then((sol) => {
        renderSalvo(`Solving ${++done} / ${plans.length}…`);
        return sol;
      }),
    ),
  );
  for (const sol of sols) {
    if (sol.targets[0].feasible) salvo.push(sol);
    else dropped++;
  }
  salvoBusy = false;
  renderSalvo(dropped ? `${dropped} missile(s) had no solution and were dropped` : '');
  log(`Salvo planned: ${plans.length - dropped} missiles (${$<HTMLSelectElement>('salvoStrategy').selectedOptions[0].text})`, 'notice');
}

async function launchSalvo() {
  if (!salvo.length || salvoBusy) return;
  salvoBusy = true;
  const birds = salvo.splice(0);
  const t0 = worldNow() + 2000;
  log(`SALVO RELEASED — ${birds.length} MISSILES`, 'alert');
  let done = 0;
  renderSalvo(`Launching 0 / ${birds.length}…`);
  await Promise.all(
    birds.map((sol, k) => {
      const launchMs = t0 + k * RIPPLE_S * 1000;
      return flyInWorker(sol, launchMs).then(({ sim, report }) => {
        launchFlight(sol, sim, report, launchMs);
        renderSalvo(`Launching ${++done} / ${birds.length}…`);
      });
    }),
  );
  salvoBusy = false;
  renderSalvo();
}

/** Detonation flash: an expanding, fading disc at the burst point. */
function detonationEntity(ecef: Vec3, tImpact: Cesium.JulianDate, text: string) {
  const age = (time: Cesium.JulianDate) => Cesium.JulianDate.secondsDifference(time, tImpact);
  const flashSeconds = 40;
  const radius = new Cesium.CallbackProperty((time) => 2000 + 23000 * Math.min(1, age(time!) / flashSeconds), false);
  viewer.entities.add({
    availability: forever(tImpact),
    position: toCart(ecef),
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty((time) => AMBER.withAlpha(Math.max(0.15, 0.85 * (1 - age(time!) / flashSeconds))), false),
      ),
    },
    point: { pixelSize: 6, color: RED },
    label: { text, font: SMALL_FONT, fillColor: AMBER, pixelOffset: new Cesium.Cartesian2(0, 16) },
  });
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

/** Where to look down from at the end: over the fallen nation, or over the pole to see both. */
const ORBIT_OVER: Record<Side | 'both', [number, number, number]> = {
  USA: [-98, 40, 16_000_000],
  USSR: [65, 58, 16_000_000],
  both: [-20, 88, 22_000_000],
};
function orbitView(over: Side | 'both', duration: number) {
  const [lon, lat, h] = ORBIT_OVER[over];
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, h), duration });
}

/**
 * Stop the world clock for both players, pull back to orbit to look down on
 * the red planet, then play the ending; either player may continue or restart.
 */
function endGame(facts: Parameters<typeof playEnding>[0], over: Side | 'both') {
  changeClock({ running: false });
  orbitView(over, 4);
  playEnding(facts, () => changeClock({ running: true }), restart, 7000);
}

// ---------------------------------------------------------------------------
// Damage on the ground and what is left of both nations
// ---------------------------------------------------------------------------

/** Every detonation so far, ours and theirs: both windows see the same list, so agree on the toll. */
const bursts: Burst[] = [];
let health: WorldHealth = assessDamage([]);
const scorch = createScorch(viewer);

const SCORCH = Cesium.Color.fromCssColorString('#ff3a1f');

/** Paint the ground: 1 psi ring, then the 5 psi / fire zone, deeper red where bursts overlap. */
function paintDamage(b: Burst) {
  const r = damageRadii(b.yieldKt);
  const from = forever(Cesium.JulianDate.fromDate(new Date(b.t)));
  const position = toCart(b.ecef);
  const disc = (radius: number, alpha: number, outline: boolean) =>
    viewer.entities.add({
      availability: from,
      position,
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        height: 0,
        material: SCORCH.withAlpha(alpha),
        outline,
        outlineColor: SCORCH.withAlpha(0.8),
      },
    });
  disc(r.light, 0.22, true);
  disc(Math.max(r.severe, r.thermal), 0.45, false);
}

function addBurst(b: Burst) {
  if (bursts.some((x) => x.t === b.t && x.ecef[0] === b.ecef[0])) return;
  bursts.push(b);
  paintDamage(b);
  health = assessDamage(bursts);
  collapsed = collapseTimes(bursts);
  renderHealth();
  const { spots, haze } = scorchMap(bursts, health);
  const loss = Math.max(...(['USA', 'USSR'] as Side[]).map((s) => 1 - health.nations[s].alive / health.nations[s].total));
  scorch.update(spots, haze, Math.max(health.winter, loss));
}

const pct = (x: number, total: number) => `${((100 * x) / total).toFixed(1)}%`;
const millions = (x: number) => `${x.toFixed(1)}M`;

function renderHealth() {
  for (const s of ['USA', 'USSR'] as Side[]) {
    const n = health.nations[s];
    const el = document.querySelector<HTMLElement>(`#health .nation[data-side="${s}"]`)!;
    el.classList.toggle('mine', s === side);
    el.classList.toggle('low', n.projected < 0.5 * n.total);
    el.querySelector<HTMLElement>('.now')!.style.width = pct(n.alive, n.total);
    el.querySelector<HTMLElement>('.proj')!.style.width = pct(n.projected, n.total);
    el.querySelector('.pct')!.textContent = n.alive > 0 ? `${millions(n.alive)} · ${pct(n.alive, n.total)}` : 'COLLAPSED';
    const dead = n.total - n.alive;
    const worst = n.cities.slice(0, 2).map((c) => `${c.name} −${millions(c.killed)}`).join(' · ');
    el.querySelector('.note')!.textContent =
      n.projected < n.alive ? `in a year: ${pct(n.projected, n.total)}${dead > 0.05 ? ` · ${worst}` : ''}` : worst;
  }
  $('winter').textContent = health.megatons
    ? `${health.megatons.toFixed(1)} Mt detonated · nuclear winter ${Math.round(100 * health.winter)}%`
    : '';
}

function tollLines(): string[] {
  return (['USA', 'USSR'] as Side[]).map((s) => {
    const n = health.nations[s];
    return `${SIDE_NAME[s]} DEAD: ${millions(n.total - n.alive)} NOW, ${millions(n.total - n.projected)} WITHIN A YEAR.`;
  });
}

// ---------------------------------------------------------------------------
// Outcome: the war ends when a nation reaches zero
// ---------------------------------------------------------------------------

let collapsed: Record<Side, number | null> = { USA: null, USSR: null };
let fallAnnounced = false;
let ended = false;
const zulu = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

/** Both windows hold the same bursts, so they reach the same verdict at the same world time. */
function checkOutcome() {
  if (ended) return;
  const o: Outcome | null = decideOutcome(collapsed, worldNow());
  if (!o) return;
  if (o.kind === 'pending') {
    if (fallAnnounced) return;
    fallAnnounced = true;
    const mine = o.fallen === side;
    log(`${o.fallen} HAS CEASED TO FUNCTION AS A NATION`, 'alert', o.at);
    showBanner(`${o.fallen} · NATIONAL COLLAPSE`, mine ? 'THE LAST MISSILES ARE STILL IN THE AIR' : 'WAITING FOR THE MISSILES ALREADY IN THE AIR', 'alert');
    // Nothing left to hide: run out the clock on whatever is still flying.
    changeClock({ rate: 120, running: true });
    return;
  }
  ended = true;
  const me = health.nations[side];
  if (o.kind === 'nobody') {
    const [a, b] = (['USA', 'USSR'] as Side[]).sort((x, y) => o.at[x] - o.at[y]);
    endGame({
      lines: [
        'BOTH NATIONS HAVE CEASED TO EXIST.',
        `${a} FELL AT ${zulu(o.at[a])}. ${b} FOLLOWED AT ${zulu(o.at[b])}.`,
        '',
        ...tollLines(),
        '',
        'EVERY SIMULATION OF THIS WAR ENDS THE SAME WAY.',
      ],
      verdict: 'NOBODY WINS',
    }, 'both');
  } else if (o.winner === side) {
    endGame({
      lines: [
        `${o.loser} HAS CEASED TO EXIST.`,
        `${side} STILL STANDS: ${millions(me.alive)} ALIVE TODAY.`,
        `AFTER THE WINTER THE SMOKE BRINGS: ${millions(me.projected)}.`,
        '',
        ...tollLines(),
        '',
        'THE WINTER DOES NOT ASK WHO FIRED FIRST.',
      ],
      verdict: 'YOU WIN',
    }, o.loser);
  } else {
    endGame({
      lines: [`${side} HAS CEASED TO EXIST AT ${zulu(o.at)}.`, `${o.winner} STILL STANDS — FOR NOW.`, '', ...tollLines()],
      verdict: 'YOU LOSE',
    }, o.loser);
  }
}

function restart() {
  link.send({ type: 'restart' });
  window.location.reload();
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
      const impact = f.sim.rvs[ev.rv!].impact!;
      addBurst({ t: f.launchMs + ev.t * 1000, ecef: impact.ecef, yieldKt: f.sol.spec.yieldKt });
      sfx.rumble();
      cue(f, 'impact', () => showBanner('DETONATION', `${f.tag} · ${target.toUpperCase()}`, 'alert'));
    }
    const at = f.launchMs + ev.t * 1000;
    if (ev.kind === 'launch') log(`${f.tag} LAUNCH — ${f.sol.launch.name}`, 'alert', at);
    else if (ev.kind === 'impact') log(`${f.tag} ${ev.label.toUpperCase()} — ${target}`, 'alert', at);
    else if (ev.kind === 'release') log(`${f.tag} T+${fmtClock(ev.t)} ${ev.label} → ${target}`, 'notice', at);
    else log(`${f.tag} T+${fmtClock(ev.t)} ${ev.label}`, ev.kind === 'burnout' ? 'notice' : '', at);
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

// ---------------------------------------------------------------------------
// Incoming raids: only what our own sensors report
// ---------------------------------------------------------------------------

/** How long a track is coasted (extrapolated) while waiting for the next report [ms]. */
const COAST_MS = 120_000;

interface ContactTrack {
  id: string;
  times: number[];
  cls: TrackClass[];
  radius: number[];
  position: Cesium.SampledPositionProperty;
  /** Periods the track was held [unix ms]; end null while still held */
  runs: { start: number; end: number | null }[];
}

interface Raid {
  key: string;
  name: string;
  tracks: Map<string, ContactTrack>;
  firstWarning: { t: number; sensor: string } | null;
  cues: Set<string>;
}
const raids = new Map<string, Raid>();

/** Last report at or before `t`, or -1. */
function lastIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || t < times[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const heldAt = (tr: ContactTrack, t: number) =>
  tr.runs.some((r) => r.start <= t && t <= (r.end ?? tr.times[tr.times.length - 1] + COAST_MS));
const classAt = (tr: ContactTrack, t: number): TrackClass => tr.cls[Math.max(0, lastIndex(tr.times, t))];
const msOf = (time: Cesium.JulianDate) => Cesium.JulianDate.toDate(time).getTime();

const LABEL_NEAR = new Cesium.DistanceDisplayCondition(0, 1_500_000);
const LABEL_ALWAYS = new Cesium.DistanceDisplayCondition(0, 5e7);

/**
 * A radar track on the globe. Its state is worked out once per frame and
 * shared by every property: a salvo puts hundreds of these in the sky.
 * Only chaff gets the (costly) 3-D cloud.
 */
function contactTrack(raid: Raid, id: string, chaff: boolean): ContactTrack {
  let tr = raid.tracks.get(id);
  if (tr) return tr;
  const position = new Cesium.SampledPositionProperty();
  position.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
  position.forwardExtrapolationDuration = COAST_MS / 1000;
  const track: ContactTrack = { id, times: [], cls: [], radius: [], position, runs: [] };
  tr = track;
  raid.tracks.set(id, track);

  let memoT = NaN;
  let held = false;
  let cls: TrackClass = 'unknown';
  let radius = 1;
  const at = (time: Cesium.JulianDate | undefined) => {
    const t = msOf(time!);
    if (t !== memoT) {
      memoT = t;
      held = heldAt(track, t);
      const i = Math.max(0, lastIndex(track.times, t));
      cls = track.cls[i];
      radius = track.radius[i] || 1;
    }
  };
  const visible = new Cesium.CallbackProperty((time) => (at(time), held), false);
  viewer.entities.add({
    position,
    point: {
      show: visible,
      pixelSize: 6,
      color: new Cesium.CallbackProperty((time) => (at(time), CLASS_STYLE[cls].color), false),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
    },
    path: { show: visible, leadTime: 0, trailTime: 1e6, width: 1, resolution: 10, material: YELLOW.withAlpha(0.35) },
    ellipsoid: chaff
      ? {
          show: visible,
          radii: new Cesium.CallbackProperty((time) => (at(time), new Cesium.Cartesian3(radius, radius, radius)), false),
          material: CYAN.withAlpha(0.18),
        }
      : undefined,
    label: {
      show: visible,
      text: new Cesium.CallbackProperty((time) => (at(time), `${CLASS_STYLE[cls].text} ${raid.name}-${id}`), false),
      font: SMALL_FONT,
      fillColor: Cesium.Color.WHITE,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      distanceDisplayCondition: new Cesium.CallbackProperty((time) => (at(time), cls === 'rv' ? LABEL_ALWAYS : LABEL_NEAR), false),
    },
  });
  return track;
}

/** Our own places, to name where a warhead fell. */
function placeNear(ecef: Vec3): string {
  const g = ecefToGeodetic(ecef);
  let best: { name: string; d: number } | null = null;
  for (const p of [...targetsFor(opponent(side)), ...LAUNCH_SITES.filter((l) => l.side === side)]) {
    const d = vincentyInverse(g.lat, g.lon, p.lat, p.lon).distance;
    if (!best || d < best.d) best = { name: p.name, d };
  }
  return best && best.d < 150_000 ? best.name : fmtCoord(g);
}

function receiveIntel(p: IntelPacket) {
  let raid = raids.get(p.raid);
  if (!raid) {
    raid = { key: p.raid, name: `R${raids.size + 1}`, tracks: new Map(), firstWarning: null, cues: new Set() };
    raids.set(p.raid, raid);
  }
  const r = raid;
  const once = (key: string, play: () => void) => {
    if (r.cues.has(key)) return;
    r.cues.add(key);
    play();
  };

  for (const u of p.tracks) {
    const tr = contactTrack(r, u.id, u.points.some((pt) => pt.cls === 'chaff'));
    u.points.forEach((pt: TrackPoint) => {
      const open = tr.runs.length && tr.runs[tr.runs.length - 1].end === null;
      if (!open) tr.runs.push({ start: pt.t, end: null });
      tr.times.push(pt.t);
      tr.cls.push(pt.cls);
      tr.radius.push(pt.radius ?? 0);
      tr.position.addSample(Cesium.JulianDate.fromDate(new Date(pt.t)), toCart(pt.ecef));
    });
    if (u.lostT !== undefined && tr.runs.length) tr.runs[tr.runs.length - 1].end = u.lostT;
  }

  for (const ev of p.events) {
    r.firstWarning ??= { t: ev.t, sensor: ev.sensor };
    log(`${ev.sensor}: RAID ${r.name} ${ev.text}`, 'sensor', ev.t);
    if (ev.kind === 'ir-launch') {
      once('ir', () => {
        sfx.blip();
        showBanner(`${SIDE_NAME[side]} EARLY WARNING`, `${ev.sensor.toUpperCase()} · LAUNCH DETECTED`, 'sensor');
        if (ev.at) {
          const t = Cesium.JulianDate.fromDate(new Date(ev.t));
          viewer.entities.add({
            availability: during(t, Cesium.JulianDate.addSeconds(t, 3600, new Cesium.JulianDate())),
            position: toCart(ev.at),
            ellipse: { semiMajorAxis: 60_000, semiMinorAxis: 60_000, material: CYAN.withAlpha(0.15), outline: false },
            label: {
              text: `IR LAUNCH · RAID ${r.name} · ${ev.sensor.toUpperCase()}`,
              font: SMALL_FONT,
              fillColor: CYAN,
              pixelOffset: new Cesium.Cartesian2(0, 18),
            },
          });
        }
      });
    } else if (ev.kind === 'radar-contact') {
      once('radar', () => {
        sfx.blip();
        showBanner('RADAR CONTACT', `${ev.sensor.toUpperCase()} · RAID ${r.name} INCOMING`, 'sensor');
      });
    }
  }

  for (const d of p.detonations) {
    addBurst(d);
    const place = placeNear(d.ecef);
    detonationEntity(d.ecef, Cesium.JulianDate.fromDate(new Date(d.t)), `DETONATION · ${place.toUpperCase()}`);
    log(`NUCLEAR DETONATION — ${place}`, 'alert', d.t);
    sfx.rumble();
    once('impact', () => showBanner('NUCLEAR DETONATION', place.toUpperCase(), 'alert'));
  }
  lockSide();
}

function renderThreat() {
  const now = worldNow();
  if (!raids.size) return;
  const rows: [string, string, string?][] = [];
  for (const r of raids.values()) {
    const held = [...r.tracks.values()].filter((tr) => heldAt(tr, now));
    const count = (c: TrackClass) => held.filter((tr) => classAt(tr, now) === c).length;
    const warned = r.firstWarning ? new Date(r.firstWarning.t).toISOString().slice(11, 19) + 'Z' : '—';
    rows.push(
      [`RAID ${r.name}`, `first warning ${warned}`, 'warn'],
      ['Warned by', r.firstWarning?.sensor ?? '—'],
      ['Tracks held', held.length ? `${held.length} · ${count('rv')} RV · ${count('unknown')} unknown` : 'none', 'hot'],
    );
  }
  renderDl($('threat'), rows);
}

// ---------------------------------------------------------------------------
// Link to the other player
// ---------------------------------------------------------------------------

/** Everything sent to the other player, replayed if their window reloads. */
const outbox: IntelPacket[] = [];

function pumpIntel() {
  const now = worldNow();
  for (const f of flights) {
    if (f.feed.done) continue;
    const packet = f.feed.poll((now - f.launchMs) / 1000);
    if (!packet) continue;
    outbox.push(packet);
    link.send({ type: 'intel', packet });
  }
}
// A timer as well as the render loop: browsers stop rendering hidden windows.
window.setInterval(() => {
  pumpIntel();
  // Our own impacts count toward the outcome even while this window is hidden.
  for (const f of flights) logEvents(f, (worldNow() - f.launchMs) / 1000);
  checkOutcome();
}, 250);

function setPeer(online: boolean) {
  peerOnline = online;
  $('peerStatus').textContent = isP1
    ? `PLAYER 2 · ${online ? `ONLINE · ${opponent(side)}` : 'NOT CONNECTED'}`
    : `PLAYER 1 · ${online ? `ONLINE · ${opponent(side)}` : 'NOT FOUND'}`;
  $('peerStatus').classList.toggle('online', online);
}

/** Sides are fixed once the other player is in or anything has flown. */
function lockSide() {
  document.querySelectorAll<HTMLButtonElement>('#sideSeg button').forEach((b) => (b.disabled = true));
}

link.onMessage((m: Message) => {
  switch (m.type) {
    case 'hello':
      if (isP1 && m.from === 'p2') {
        link.send({ type: 'welcome', side, clock: worldClock });
        for (const packet of outbox) link.send({ type: 'intel', packet });
        setPeer(true);
        lockSide();
      } else if (!isP1 && m.from === 'p1') {
        // Player 1 started over.
        window.location.reload();
      }
      break;
    case 'welcome':
      if (isP1) break;
      setClock(m.clock, false);
      applySide(opponent(m.side));
      setPeer(true);
      break;
    case 'side':
      if (!isP1) applySide(opponent(m.side));
      break;
    case 'clock':
      setClock(m.clock, false);
      break;
    case 'intel':
      receiveIntel(m.packet);
      break;
    case 'bye':
      setPeer(false);
      break;
    case 'restart':
      window.location.reload();
      break;
  }
});
window.addEventListener('pagehide', () => link.send({ type: 'bye', from: link.role }));

viewer.clock.onTick.addEventListener((clock) => {
  pumpIntel();
  renderThreat();
  let shown: Flight | null = null;
  for (const f of flights) {
    const elapsed = Cesium.JulianDate.secondsDifference(clock.currentTime, f.launchTime);
    logEvents(f, elapsed);
    if (elapsed >= 0 && elapsed <= f.endT) shown = f;
  }
  checkOutcome();
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

/** Sensor overlay entities and whose sensor each one is: a player sees only their own. */
const sensorEntities: { e: Cesium.Entity; side: Side }[] = [];
function buildSensorOverlay() {
  for (const r of RADARS) {
    const color = SIDE_COLOR[r.side];
    const range = radarRange(r, 1);
    const all = r.halfWidth >= 180;
    const arc: Cesium.Cartesian3[] = [];
    for (let a = -r.halfWidth; a <= r.halfWidth; a += all ? 6 : 3) arc.push(destination(r.lat, r.lon, r.boresight + a, range));
    const site = Cesium.Cartesian3.fromDegrees(r.lon, r.lat);
    const ring = all ? arc : [site, ...arc, site];
    sensorEntities.push({
      side: r.side,
      e: viewer.entities.add({
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
    });
  }
  for (const sat of SATELLITES) {
    const color = SIDE_COLOR[sat.side];
    sensorEntities.push({
      side: sat.side,
      e: viewer.entities.add({
        position: new Cesium.CallbackPositionProperty(
          (time) => toCart(satelliteEcef(sat, Cesium.JulianDate.toDate(time!).getTime())),
          false,
        ),
        point: { pixelSize: 6, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
        label: { text: sat.name.toUpperCase(), font: SMALL_FONT, fillColor: color, pixelOffset: new Cesium.Cartesian2(0, -12) },
      }),
    });
  }
  // All nine Oko satellites share one Earth-fixed track (it repeats every sidereal day).
  const oko = SATELLITES.find((s) => s.orbit)!;
  const track: Cesium.Cartesian3[] = [];
  for (let m = 0; m <= 1440; m += 4) track.push(toCart(satelliteEcef(oko, oko.orbit!.epochMs + m * 60_000)));
  sensorEntities.push({
    side: oko.side,
    e: viewer.entities.add({
      polyline: { positions: track, width: 1, arcType: Cesium.ArcType.NONE, material: SIDE_COLOR.USSR.withAlpha(0.35) },
    }),
  });
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
  for (const s of sensorEntities) s.e.show = on && s.side === side;
  $('sensorsBtn').classList.toggle('active', on);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const WARPS = [1, 10, 30, 60, 120];
/** Time warp is shared: either player may change it. */
const setWarp = (w: number) => changeClock({ rate: w, running: true });
for (const w of WARPS) {
  const b = document.createElement('button');
  b.textContent = `${w}×`;
  b.dataset.warp = String(w);
  b.onclick = () => setWarp(w);
  $('warpSeg').append(b);
}
setClock(worldClock, false);

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
    if (b.dataset.view === 'orbit') orbitView('both', 2.5);
    else if (b.dataset.view === 'launch') frame([launchPoint], 150_000);
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
$('addToSalvo').onclick = addToSalvo;
$('salvoGen').onclick = () => void generateSalvo();
$('salvoLaunch').onclick = () => void launchSalvo();
$('salvoClear').onclick = () => {
  salvo.length = 0;
  renderSalvo();
};
renderSalvo();

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

$('sensorsBtn').onclick = () => setSensorsShown(!sensorsShown);
buildSensorOverlay();
buildFieldOverlay();

// Title screen and sound.
$('titleBuild').textContent = `BUILD ${__BUILD__}${isP1 ? '' : ' · PLAYER 2'}`;
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
document.title = `World War 198X · ${isP1 ? '' : 'player 2 · '}build ${__BUILD__}`;
$('playerTag').textContent = isP1 ? 'PLAYER 1' : 'PLAYER 2';
$('openP2').hidden = !isP1;
$('openP2').onclick = () => {
  window.open(playerTwoUrl(link.game), `ww198x-p2-${link.game}`, 'popup,width=1280,height=800');
};
applySide(isP1 ? 'USA' : 'USSR');
renderHealth();
if (!isP1) lockSide();
// Announce ourselves: player 2 gets the clock and its side from player 1.
link.send({ type: 'hello', from: link.role });
log(`Strategic command online (player ${isP1 ? 1 : 2}). Select a fire mission.`, 'notice');
