/*
 * Fluid particles along fixed paths (coolant in hoses, oil in galleries, air in ducts, gas in
 * pipes). All paths share one Points draw call. Each path has its own speed, colour ramp and a
 * target opacity that fades in/out, so a presentation can switch a circuit on (thermostat
 * opening) or hide a whole system.
 */
import * as THREE from 'three';

export interface FlowPathDef {
  curve: THREE.Curve<THREE.Vector3>;
  /** Particles on this path. */
  count: number;
  /** Scene units per second at rate 1. */
  speed: number;
  /** Colour along the path, u = 0..1 (sampled once). */
  color: (u: number, out: THREE.Color) => THREE.Color;
  /** Point diameter in scene units. */
  size: number;
  /** Random sideways spread (scene units), e.g. the radius of the pipe. */
  spread?: number;
  /** Closed circuit: no fade at the ends. */
  loop?: boolean;
}

const LUT = 48;

export class PathFlow {
  readonly points: THREE.Points;
  private readonly defs: FlowPathDef[];
  private readonly luts: Float32Array[];
  private readonly len: number[];
  private readonly rate: number[];
  private readonly alpha: number[];
  private readonly want: number[];
  private readonly pathOf: Uint16Array;
  private readonly u: Float32Array;
  private readonly off: Float32Array;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly sz: Float32Array;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();

  constructor(defs: FlowPathDef[]) {
    this.defs = defs;
    const n = defs.reduce((a, d) => a + d.count, 0);
    this.pathOf = new Uint16Array(n);
    this.u = new Float32Array(n);
    this.off = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.sz = new Float32Array(n);
    this.len = defs.map((d) => d.curve.getLength());
    this.rate = defs.map(() => 1);
    this.alpha = defs.map(() => 1);
    this.want = defs.map(() => 1);
    const c = new THREE.Color();
    this.luts = defs.map((d) => {
      const a = new Float32Array(LUT * 3);
      for (let i = 0; i < LUT; i++) {
        d.color(i / (LUT - 1), c);
        a.set([c.r, c.g, c.b], i * 3);
      }
      return a;
    });
    let k = 0;
    defs.forEach((d, p) => {
      const s = d.spread ?? 0;
      for (let i = 0; i < d.count; i++, k++) {
        this.pathOf[k] = p;
        this.u[k] = (i + Math.random() * 0.8) / d.count;
        this.off.set([(Math.random() - 0.5) * 2 * s, (Math.random() - 0.5) * 2 * s, (Math.random() - 0.5) * 2 * s], k * 3);
        this.sz[k] = d.size * (0.75 + Math.random() * 0.5);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.5, size * uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.userData.aid = true;
  }

  /** Speed multiplier of a path (0 = stopped). */
  setRate(path: number, r: number) {
    this.rate[path] = r;
  }

  /** Target visibility of a path, 0..1 (eased). */
  setVisible(path: number, v: number) {
    this.want[path] = v;
  }

  /** Pixels per scene unit at distance 1 (call on resize / fov change). */
  setViewport(heightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  private last = 0;

  /** `dt` animation seconds; `advance` false keeps particles where they are (paused). */
  update(dt: number, advance = true) {
    // fades run on wall-clock time, so they finish even when frames are slow or paused
    const now = performance.now(),
      wall = this.last ? Math.min(1, (now - this.last) / 1000) : 1;
    this.last = now;
    const k = 1 - Math.exp(-wall / 0.25);
    for (let p = 0; p < this.defs.length; p++) this.alpha[p] += (this.want[p] - this.alpha[p]) * k;
    const t = this.tmp;
    for (let i = 0; i < this.pathOf.length; i++) {
      const p = this.pathOf[i],
        d = this.defs[p],
        a = this.alpha[p];
      if (a < 0.01) {
        this.col.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      let u = advance ? (this.u[i] + (dt * d.speed * this.rate[p]) / this.len[p]) % 1 : this.u[i];
      if (u < 0) u += 1;
      this.u[i] = u;
      d.curve.getPointAt(u, t);
      this.pos[i * 3] = t.x + this.off[i * 3];
      this.pos[i * 3 + 1] = t.y + this.off[i * 3 + 1];
      this.pos[i * 3 + 2] = t.z + this.off[i * 3 + 2];
      // fade in/out at the path ends so particles don't pop
      const e = (d.loop ? 1 : Math.min(1, u * 12, (1 - u) * 12)) * a,
        j = Math.min(LUT - 1, Math.round(u * (LUT - 1))) * 3,
        L = this.luts[p];
      this.col[i * 3] = L[j] * e;
      this.col[i * 3 + 1] = L[j + 1] * e;
      this.col[i * 3 + 2] = L[j + 2] * e;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
