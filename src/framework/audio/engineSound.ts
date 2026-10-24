/*
 * Procedural engine sound (Web Audio). Nothing is recorded: the sound is synthesised from the
 * same numbers the 3D model uses (rpm + firing offsets, or N1/N2 for a turbofan), so it follows
 * the controls. It always runs at the real speed, even while the animation is slowed down.
 *
 * A presentation opts in with PresentationModule.sound (see SoundDef); the viewer owns the
 * on/off toggle and drives the player.
 */
import { PISTON_WORKLET } from './pistonWorklet';

/** Timbre of a piston engine. Frequencies are fixed in Hz (exhaust resonances don't track rpm). */
export interface PistonVoice {
  /** Exhaust/intake resonances, Hz. */
  body: number[];
  /** Resonance sharpness. */
  q: number;
  /** Exhaust pulse decay, ms (shortened automatically at high rpm). */
  decay: number;
  /** 0..1 noise share in each pulse: higher = raspier. */
  rasp: number;
  /** Soft-clip drive: higher = harder, more growl. */
  drive: number;
  /** 0..1 random pulse-to-pulse amplitude variation. */
  jitter: number;
  /** How fast the tone brightens with rpm (1 = default). */
  bright: number;
  /** Output gain. */
  gain: number;
}

/** Firing events in the 720° cycle and the exhaust bank each one goes to. */
export interface PistonLayout {
  /** [firing offset in degrees of the 720° cycle, bank index] */
  cyl: [number, number][];
  /** Number of exhaust banks (1 = mono, 2 = left/right). */
  banks: number;
}

export interface TurbofanVoice {
  fanBlades: number;
  /** Rows of the first HPC stage, for the high whine. */
  hpcBlades: number;
  /** rpm at 100 % N1 / N2. */
  n1Rpm100: number;
  n2Rpm100: number;
  gain: number;
}

export interface TurbofanSoundState {
  /** % */
  n1: number;
  /** % */
  n2: number;
  reverse: boolean;
}

export type SoundDef<P, I = unknown> =
  | {
      kind: 'piston';
      voice: PistonVoice;
      layout: (params: P) => PistonLayout;
      rpm: (params: P, instance: I) => number;
    }
  | {
      kind: 'turbofan';
      voice: TurbofanVoice;
      state: (params: P, instance: I) => TurbofanSoundState;
    };

/** Remembered while the user moves between presentations (not across reloads: audio needs a click). */
let preference = false;
export const soundPreference = () => preference;
export const setSoundPreference = (on: boolean) => void (preference = on);

type Ctor = typeof AudioContext;
export const audioSupported = () =>
  typeof window !== 'undefined' &&
  !!(window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);

/** A running voice: push state ~30×/s with update(); fades in/out with setActive(). */
export class EnginePlayer<P, I> {
  private ctx: AudioContext;
  private master: GainNode;
  private node?: AudioWorkletNode;
  private layoutKey = '';
  private fan?: TurbofanNodes;
  private ready: Promise<void>;
  private closed = false;

  constructor(private def: SoundDef<P, I>) {
    const C: Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext;
    this.ctx = new C({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.ready = def.kind === 'piston' ? this.initPiston(def.voice) : Promise.resolve(this.initFan(def.voice));
  }

  /** Must be called from a click (browser autoplay rules). */
  resume() {
    return this.ctx.resume();
  }

  private async initPiston(voice: PistonVoice) {
    const url = URL.createObjectURL(new Blob([PISTON_WORKLET], { type: 'application/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.closed) return;
    this.node = new AudioWorkletNode(this.ctx, 'mp-piston', { outputChannelCount: [2] });
    const { gain, ...rest } = voice;
    this.node.port.postMessage({ voice: rest });
    const out = this.ctx.createGain();
    out.gain.value = gain;
    this.node.connect(out).connect(this.master);
  }

  private initFan(v: TurbofanVoice) {
    this.fan = buildTurbofan(this.ctx, this.master, v);
  }

  /** Fade the whole voice in (playing) or out (paused / toggled off). */
  setActive(on: boolean) {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.15 : 0.08);
  }

  update(params: P, instance: I) {
    if (this.def.kind === 'piston') {
      const n = this.node;
      if (!n) return;
      const layout = this.def.layout(params);
      const key = JSON.stringify(layout);
      if (key !== this.layoutKey) {
        this.layoutKey = key;
        n.port.postMessage({ layout });
      }
      n.parameters.get('rpm')!.setValueAtTime(this.def.rpm(params, instance), this.ctx.currentTime);
    } else if (this.fan) {
      this.fan.set(this.def.state(params, instance), this.ctx.currentTime);
    }
  }

  async whenReady() {
    await this.ready;
  }

  close() {
    this.closed = true;
    this.node?.disconnect();
    void this.ctx.close();
  }
}

interface TurbofanNodes {
  set(s: TurbofanSoundState, t: number): void;
}

/** Fan blade-passing tone, buzz-saw at high power, HPC whine and jet roar, all from N1/N2. */
function buildTurbofan(ctx: AudioContext, dest: AudioNode, v: TurbofanVoice): TurbofanNodes {
  const out = ctx.createGain();
  out.gain.value = v.gain;
  out.connect(dest);

  const osc = (type: OscillatorType, g0: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    g.gain.value = g0;
    o.connect(g);
    o.start();
    return { o, g };
  };

  // Fan blade-passing frequency and its 2nd harmonic.
  const bpf = osc('sine', 0),
    bpf2 = osc('sine', 0);
  bpf.g.connect(out);
  bpf2.g.connect(out);

  // Buzz-saw: shaft-order tones once the fan tips go supersonic.
  const saw = osc('sawtooth', 0);
  const sawBand = ctx.createBiquadFilter();
  sawBand.type = 'bandpass';
  sawBand.frequency.value = 900;
  sawBand.Q.value = 0.7;
  saw.g.connect(sawBand).connect(out);

  // High-pressure compressor whine (N2).
  const whine = osc('sine', 0);
  whine.g.connect(out);

  // Jet roar + low rumble from one looping noise buffer.
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  noise.start();
  const roarLp = ctx.createBiquadFilter();
  roarLp.type = 'lowpass';
  roarLp.Q.value = 0.5;
  const roar = ctx.createGain();
  roar.gain.value = 0;
  noise.connect(roarLp).connect(roar).connect(out);
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 160;
  const rumble = ctx.createGain();
  rumble.gain.value = 0;
  noise.connect(rumbleLp).connect(rumble).connect(out);

  const tc = 0.12;
  const to = (p: AudioParam, val: number, t: number) => p.setTargetAtTime(val, t, tc);

  return {
    set({ n1, n2, reverse }, t) {
      const shaft1 = (Math.max(n1, 0) / 100) * (v.n1Rpm100 / 60);
      const shaft2 = (Math.max(n2, 0) / 100) * (v.n2Rpm100 / 60);
      // 0 at idle (~21 % N1) .. 1 at take-off.
      const p = Math.min(1.1, Math.max(0, (n1 - 21) / 77));
      const spin = Math.min(1, Math.max(n1, 0) / 25);
      to(bpf.o.frequency, shaft1 * v.fanBlades, t);
      to(bpf2.o.frequency, shaft1 * v.fanBlades * 2, t);
      to(bpf.g.gain, spin * (0.07 + 0.1 * p), t);
      to(bpf2.g.gain, spin * 0.025 * (0.4 + p), t);
      to(saw.o.frequency, shaft1, t);
      to(saw.g.gain, 0.16 * Math.max(0, (n1 - 78) / 22), t);
      to(sawBand.frequency, 500 + 900 * p, t);
      to(whine.o.frequency, shaft2 * v.hpcBlades, t);
      to(whine.g.gain, Math.min(1, Math.max(n2, 0) / 50) * (0.03 - 0.012 * p), t);
      to(roarLp.frequency, 280 + 2600 * p + (reverse ? 900 : 0), t);
      to(roar.gain, spin * (0.05 + 0.55 * p * p) * (reverse ? 1.35 : 1), t);
      to(rumble.gain, spin * (0.08 + 0.35 * p), t);
    },
  };
}
