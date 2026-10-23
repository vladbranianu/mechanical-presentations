/*
 * Air / gas particles. Each particle keeps a span fraction σ across the duct it is in and an
 * angle around the axis; the radius is re-derived from the flowpath walls at its current x, so
 * the streams follow the real annulus: they split at the splitter, squeeze through the
 * compressor, slow down in the combustor and leave as two jets. Colour = gas temperature.
 */
import * as THREE from 'three';
import {
  CORE_EXIT_X,
  NOZZLE_X,
  SPLIT_X,
  clamp,
  coreTemp,
  coreTipR,
  cowlR,
  ductOutR,
  hubR,
  vBypass,
  vCore,
  type Stations,
} from './engine';

const N_CORE = 2600,
  N_BYP = 2600,
  X_START = -80,
  X_END_CORE = 215,
  X_END_BYP = 165;
/** Cascade exit (where reversed air leaves) and the blocker doors, for a deployed reverser. */
export const CASCADE_X = [34, 46] as const;

/** Span fraction of the splitter lip in the fan annulus. */
const SIG_S = (coreTipR(SPLIT_X) - hubR(SPLIT_X)) / (ductOutR(SPLIT_X) - hubR(SPLIT_X));

/** Temperature (°C) → colour. Cool blue → amber → orange → white-hot. */
const STOPS: [number, number, number, number][] = [
  [15, 0.22, 0.55, 0.85],
  [110, 0.35, 0.72, 0.82],
  [350, 0.8, 0.72, 0.45],
  [650, 1.0, 0.55, 0.2],
  [1100, 1.0, 0.38, 0.1],
  [1500, 1.0, 0.68, 0.3],
  [2100, 1.0, 0.95, 0.78],
];
export function tempColor(t: number, out: THREE.Color) {
  if (t <= STOPS[0][0]) return out.setRGB(STOPS[0][1], STOPS[0][2], STOPS[0][3]);
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const a = STOPS[i - 1],
        b = STOPS[i],
        u = (t - a[0]) / (b[0] - a[0]);
      return out.setRGB(a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u);
    }
  }
  const l = STOPS[STOPS.length - 1];
  return out.setRGB(l[1], l[2], l[3]);
}
export const tempCss = (t: number) => '#' + tempColor(t, new THREE.Color()).getHexString();

/** Inner / outer radius of the stream a particle belongs to, at x. */
function walls(core: boolean, x: number): [number, number] {
  if (x < SPLIT_X) {
    const out = x < -56 ? ductOutR(-56) + (-56 - x) * 0.18 : ductOutR(x);
    const h = hubR(x);
    return core ? [h, h + (out - h) * SIG_S] : [h + (out - h) * SIG_S, out];
  }
  if (core) {
    if (x <= CORE_EXIT_X) return [hubR(x), coreTipR(x)];
    return [hubR(x), coreTipR(CORE_EXIT_X) + (x - CORE_EXIT_X) * 0.05];
  }
  const outer = x <= NOZZLE_X ? ductOutR(x) : ductOutR(NOZZLE_X) - (x - NOZZLE_X) * 0.045;
  const inner = x <= CORE_EXIT_X ? cowlR(x) : coreTipR(CORE_EXIT_X) + (x - CORE_EXIT_X) * 0.05 + 0.6;
  return [inner, Math.max(outer, inner + 0.5)];
}

export class Flow {
  readonly points: THREE.Points;
  private readonly n = N_CORE + N_BYP;
  private readonly x = new Float32Array(this.n);
  private readonly sig = new Float32Array(this.n);
  private readonly phi = new Float32Array(this.n);
  private readonly spd = new Float32Array(this.n);
  /** reversed particles: radius and travelled distance */
  private readonly revR = new Float32Array(this.n);
  private readonly revD = new Float32Array(this.n);
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly c = new THREE.Color();
  private readonly mat: THREE.ShaderMaterial;
  private opacity = 1;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.size = new Float32Array(this.n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(60, 0, 0), 200);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        uniform float uOpacity;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vColor * a * a * uOpacity, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    for (let i = 0; i < this.n; i++) this.spawn(i, true);
  }

  private isCore(i: number) {
    return i < N_CORE;
  }

  private spawn(i: number, anywhere: boolean) {
    const core = this.isCore(i);
    const end = core ? X_END_CORE : X_END_BYP;
    this.x[i] = anywhere ? X_START + Math.random() * (end - X_START) : X_START + Math.random() * 4;
    // area-weighted span position inside the stream (avoid the walls)
    const u = 0.04 + 0.92 * Math.sqrt(Math.random());
    this.sig[i] = core ? u : 0.03 + 0.94 * Math.random() ** 0.8;
    this.phi[i] = Math.random() * Math.PI * 2;
    this.spd[i] = 0.9 + Math.random() * 0.2;
    this.revD[i] = -1;
  }

  /** Scale for the point size (pixels per unit at distance 1). */
  setViewport(heightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * @param dt     real seconds
   * @param vScale scene units per second for 1 m/s of gas (slow-motion factor included)
   * @param n1     N1 % (gas speed scales with it)
   * @param rev    reverser deployment 0..1
   */
  update(dt: number, vScale: number, n1: number, st: Stations, rev: number, visible: boolean) {
    this.opacity += ((visible ? 1 : 0) - this.opacity) * (1 - Math.exp(-dt / 0.25));
    this.mat.uniforms.uOpacity.value = this.opacity;
    this.points.visible = this.opacity > 0.01;
    const k = vScale * clamp(n1 / 98, 0.08, 1.1);
    const p = this.pos,
      col = this.col,
      size = this.size,
      c = this.c;
    for (let i = 0; i < this.n; i++) {
      const core = this.isCore(i);
      let x = this.x[i];
      if (this.revD[i] >= 0) {
        // reversed bypass air: out through the cascades, forwards and outwards
        const d = (this.revD[i] += dt * k * 150 * this.spd[i]);
        x = this.x[i] -= dt * k * 110 * this.spd[i];
        this.revR[i] += dt * k * 105 * this.spd[i];
        const r = this.revR[i];
        const fade = clamp(1 - d / 34, 0, 1);
        if (fade <= 0) {
          this.spawn(i, false);
          continue;
        }
        p[i * 3] = x;
        p[i * 3 + 1] = -r * Math.sin(this.phi[i]);
        p[i * 3 + 2] = r * Math.cos(this.phi[i]);
        tempColor(40, c);
        col[i * 3] = c.r * fade;
        col[i * 3 + 1] = c.g * fade;
        col[i * 3 + 2] = c.b * fade;
        size[i] = 0.75;
        continue;
      }
      const v = core ? vCore(x) : vBypass(x);
      x = this.x[i] += dt * k * v * this.spd[i];
      const end = core ? X_END_CORE : X_END_BYP;
      if (x > end) {
        this.spawn(i, false);
        x = this.x[i];
      }
      // a deployed reverser blocks the duct just aft of the cascades
      if (!core && rev > 0.6 && x > CASCADE_X[0] + 2 && x < CASCADE_X[1] + 6) {
        this.revD[i] = 0;
        this.revR[i] = walls(false, x)[1];
        continue;
      }
      const [a, b] = walls(core, x);
      const s = core ? this.sig[i] : this.sig[i];
      const r = a + (b - a) * s;
      p[i * 3] = x;
      p[i * 3 + 1] = -r * Math.sin(this.phi[i]);
      p[i * 3 + 2] = r * Math.cos(this.phi[i]);
      const t = core ? coreTemp(st, x) : st.t2 + (x > 0 ? 35 * (st.t25 - st.t2) / 95 : 0);
      tempColor(t, c);
      // fade in at the start, out at the end of the stream
      const fin = clamp((x - X_START) / 30, 0, 1),
        fout = clamp((end - x) / (core ? 60 : 45), 0, 1);
      let br = fin * fout * (core ? 1 : 0.72) * (x < 0 ? 0.6 : 1);
      let sz = core ? 1.15 : 0.8;
      if (core && x > 82 && x < 93) {
        br *= 1.35;
        sz = 1.6;
      }
      col[i * 3] = c.r * br;
      col[i * 3 + 1] = c.g * br;
      col[i * 3 + 2] = c.b * br;
      size[i] = sz;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
