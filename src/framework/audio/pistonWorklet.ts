/*
 * AudioWorklet source for the piston-engine voice, kept as a string so it loads from a Blob URL
 * without bundler configuration.
 *
 * Model: a crank angle advances at the (smoothed) real rpm. Each time it passes a cylinder's
 * firing offset in the 720° cycle, that cylinder's bank gets an exhaust pulse (fast attack,
 * short decay, some noise). Each bank then rings through fixed exhaust resonances, a lowpass
 * that opens with rpm and a soft clipper, and is panned left/right. Because the pulses keep
 * their real timing per bank, an uneven firing pattern (cross-plane V8) is heard as a burble.
 *
 * Messages: { layout: { cyl: [deg, bank][], banks: number } } and { voice: PistonVoice }.
 * AudioParams: rpm (target, smoothed inside), level.
 */
export const PISTON_WORKLET = /* js */ `
const TAU = Math.PI * 2;

class Biquad {
  constructor() { this.b0 = this.b1 = this.b2 = this.a1 = this.a2 = 0; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  bandpass(f, q) {
    const w = TAU * Math.min(f, sampleRate * 0.45) / sampleRate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

class Bank {
  constructor() { this.e1 = 0; this.e2 = 0; this.res = []; this.lp = 0; this.dc = 0; }
}

class PistonProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 1000, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.theta = 0;
    this.rpm = 0;
    this.cyl = [[0, 0]];
    this.banks = [new Bank()];
    this.voice = { body: [140, 320], q: 3, decay: 4, rasp: 0.25, drive: 1.6, jitter: 0.1, bright: 1 };
    this.seed = 12345;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.voice) this.voice = Object.assign({}, this.voice, d.voice);
      if (d.layout) {
        this.cyl = d.layout.cyl;
        this.banks = [];
        for (let i = 0; i < d.layout.banks; i++) this.banks.push(new Bank());
        this.cylAmp = this.cyl.map(() => 1 + (this.rand() - 0.5) * 0.12);
      }
      this.tune();
    };
    this.tune();
  }
  rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  tune() {
    const v = this.voice;
    this.banks.forEach((b, i) => {
      b.res = v.body.map((f, k) => {
        const bq = new Biquad();
        // Banks differ slightly (pipe lengths are never identical).
        bq.bandpass(f * (1 + i * 0.045) * (1 + k * 0.01), v.q);
        return bq;
      });
    });
    if (!this.cylAmp || this.cylAmp.length !== this.cyl.length) this.cylAmp = this.cyl.map(() => 1);
  }
  process(_in, outputs, params) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    const v = this.voice, banks = this.banks, nb = banks.length;
    const target = params.rpm[0], level = params.level[0];
    // Rev-up/down lag of a real engine.
    this.rpm += (target - this.rpm) * (1 - Math.exp(-n / (sampleRate * 0.18)));
    const rpm = this.rpm;
    const step = (rpm / 60) * 720 / sampleRate;
    // Pulse length: the voice's decay, but never longer than a third of one bank's firing gap.
    const gap = 60 / Math.max(rpm, 300) * 2 / Math.max(1, this.cyl.length / nb);
    const td = Math.min(v.decay / 1000, gap / 3);
    const k1 = Math.exp(-1 / (sampleRate * td)), k2 = Math.exp(-1 / (sampleRate * 0.00025));
    const fc = Math.min(800 + rpm * 0.9 * v.bright, sampleRate * 0.4);
    const lpk = 1 - Math.exp(-TAU * fc / sampleRate);
    const norm = 1 / Math.tanh(v.drive);
    const pans = banks.map((_, i) => (nb === 1 ? 0 : (i / (nb - 1)) * 1.2 - 0.6));
    const gl = pans.map((p) => Math.cos((p + 1) * Math.PI / 4)), gr = pans.map((p) => Math.sin((p + 1) * Math.PI / 4));
    for (let s = 0; s < n; s++) {
      const prev = this.theta;
      this.theta += step;
      const wrapped = this.theta >= 720;
      if (wrapped) this.theta -= 720;
      for (let c = 0; c < this.cyl.length; c++) {
        const at = this.cyl[c][0];
        if (wrapped ? (at >= prev || at < this.theta) : (at >= prev && at < this.theta)) {
          const b = banks[this.cyl[c][1]];
          const a = this.cylAmp[c] * (1 + (this.rand() - 0.5) * 2 * v.jitter);
          b.e1 += a; b.e2 += a;
        }
      }
      let l = 0, r = 0;
      for (let i = 0; i < nb; i++) {
        const b = banks[i];
        const x = (b.e1 - b.e2) * ((1 - v.rasp) + v.rasp * (this.rand() * 2 - 1) * 1.7);
        b.e1 *= k1; b.e2 *= k2;
        let y = x * 0.35;
        for (let k = 0; k < b.res.length; k++) y += b.res[k].run(x);
        b.lp += (y - b.lp) * lpk;
        b.dc += (b.lp - b.dc) * 0.0015;
        const o = Math.tanh((b.lp - b.dc) * v.drive) * norm * level;
        l += o * gl[i]; r += o * gr[i];
      }
      L[s] = l; R[s] = r;
    }
    return true;
  }
}
registerProcessor('mp-piston', PistonProcessor);
`;
