// The planet seen from orbit turning from blue to red: a world-sized image of
// fires, smoke and burning countries draped over the globe, and the limb of
// the atmosphere shifting from blue toward red.

import * as Cesium from 'cesium';
import type { ScorchSpot } from '../game/damage';

const W = 2048;
const H = 1024;
const KM_PER_DEG = 111.2;

function draw(spots: ScorchSpot[], haze: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (haze > 0) {
    ctx.fillStyle = `rgba(170, 20, 10, ${haze})`;
    ctx.fillRect(0, 0, W, H);
  }
  const pxPerDeg = W / 360;
  for (const s of spots) {
    const x = (s.lon + 180) * pxPerDeg;
    const y = (90 - s.lat) * pxPerDeg;
    const r = (s.radius / KM_PER_DEG) * pxPerDeg;
    // Degrees of longitude shrink toward the poles: stretch the glow east-west.
    const stretch = 1 / Math.max(0.2, Math.cos((s.lat * Math.PI) / 180));
    for (const dx of [-W, 0, W]) {
      ctx.save();
      ctx.translate(x + dx, y);
      ctx.scale(stretch, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(255, 70, 30, ${0.85 * s.intensity})`);
      g.addColorStop(0.45, `rgba(220, 20, 10, ${0.6 * s.intensity})`);
      g.addColorStop(1, 'rgba(160, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }
  }
  return canvas.toDataURL('image/png');
}

/** Keeps the scorch layer and the atmosphere tint in step with the damage. */
export function createScorch(viewer: Cesium.Viewer) {
  let layer: Cesium.ImageryLayer | null = null;
  let pending: number | undefined;

  const apply = (spots: ScorchSpot[], haze: number, severity: number) => {
    const next = viewer.imageryLayers.addImageryProvider(
      new Cesium.SingleTileImageryProvider({ url: draw(spots, haze), tileWidth: W, tileHeight: H }),
    );
    next.alpha = 0.85;
    // Drop the old layer once the new one has had time to load: no blue flash in between.
    const old = layer;
    layer = next;
    if (old) window.setTimeout(() => viewer.imageryLayers.remove(old), 1500);

    // Blue limb to red: a hue turn of 0.4 takes sky blue through violet to red.
    const s = Math.min(1, severity);
    for (const atm of [viewer.scene.skyAtmosphere, viewer.scene.atmosphere]) {
      if (!atm) continue;
      atm.hueShift = 0.4 * s;
      atm.saturationShift = 0.3 * s;
      atm.brightnessShift = -0.1 * s;
    }
  };

  return {
    /** Redraw soon (bursts often arrive in a salvo). */
    update(spots: ScorchSpot[], haze: number, severity: number) {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => apply(spots, haze, severity), 300);
    },
  };
}
