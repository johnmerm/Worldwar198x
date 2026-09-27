// Synthesised 80s-style sound effects (Web Audio; no audio files).

let ctx: AudioContext | null = null;
let muted = false;

/** Browsers only allow audio after a user gesture: call from a click handler. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

export const isMuted = () => muted;
export const setMuted = (m: boolean) => {
  muted = m;
};

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, gain: number, cutoff: number) {
  if (!ctx || muted) return;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start();
}

export const sfx = {
  /** Two-tone launch klaxon. */
  klaxon() {
    for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 440, 0.34, 'sawtooth', 0.035, i * 0.38);
  },
  /** Radar / sensor blip. */
  blip() {
    tone(1320, 0.07, 'square', 0.025);
    tone(1760, 0.09, 'square', 0.025, 0.1);
  },
  /** Rising warning sweep. */
  warning() {
    tone(300, 0.6, 'triangle', 0.05, 0, 900);
  },
  /** Distant detonation. */
  rumble() {
    noise(3.5, 0.5, 180);
    tone(55, 2.5, 'sine', 0.12, 0, 30);
  },
  /** Menu confirm. */
  confirm() {
    tone(880, 0.06, 'square', 0.03);
    tone(1320, 0.12, 'square', 0.03, 0.07);
  },
};
