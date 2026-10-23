/* Geometry builders for an axisymmetric machine: lathed shells and twisted blade rows. */
import * as THREE from 'three';

/** Profile point: [x, r] or [x, r, 1] for a sharp corner (normals are not smoothed across it). */
export type PP = [number, number] | [number, number, 1];

/**
 * Surface of revolution around the x axis. `closed` profiles become solids with outward faces
 * (the winding is fixed automatically), so the section view can show their cut face.
 * The angle φ = 0 is +z, φ = -π/2 is +y.
 */
export function lathe(profile: PP[], opts: { seg?: number; closed?: boolean; phi?: [number, number] } = {}) {
  const { seg = 96, closed = true, phi = [0, Math.PI * 2] } = opts;
  let pts = profile.slice();
  if (closed) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        q = pts[(i + 1) % pts.length];
      a += p[1] * q[0] - q[1] * p[0];
    }
    if (a < 0) pts.reverse();
  }
  const v: THREE.Vector2[] = [];
  pts.forEach((p, i) => {
    const q = new THREE.Vector2(Math.max(p[1], 0), p[0]);
    v.push(q);
    // a repeated point gives a zero-length segment, so the normals are not averaged across it
    if (p.length === 3 && i > 0 && (closed || i < pts.length - 1)) v.push(q.clone());
  });
  if (closed) v.push(new THREE.Vector2(Math.max(pts[0][1], 0), pts[0][0]));
  const g = new THREE.LatheGeometry(v, seg, phi[0], phi[1]);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Closed thin shell following r(x) from x0 to x1, thickness t (inwards if t < 0). */
export function shell(r: (x: number) => number, x0: number, x1: number, t: number, steps = 24): PP[] {
  const outer: PP[] = [],
    inner: PP[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    outer.push([x, r(x)]);
    inner.push([x, r(x) + t]);
  }
  outer[0] = [outer[0][0], outer[0][1], 1];
  outer[steps] = [outer[steps][0], outer[steps][1], 1];
  inner[0] = [inner[0][0], inner[0][1], 1];
  inner[steps] = [inner[steps][0], inner[steps][1], 1];
  return [...outer, ...inner.reverse()];
}

export const sampled = (r: (x: number) => number, x0: number, x1: number, steps = 24): PP[] => {
  const o: PP[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    o.push([x, r(x)]);
  }
  return o;
};

/* ---------- Blades ---------- */

export interface BladeSpec {
  rHub: number;
  rTip: number;
  /** chord at hub / tip */
  chord: [number, number];
  /** metal angle from the axis at the leading / trailing edge, degrees, at hub and tip */
  le: [number, number];
  te: [number, number];
  /** max thickness / chord at hub and tip */
  thick: [number, number];
  /** axial shift of the mid-chord at the tip (sweep) */
  sweep?: number;
  nSpan?: number;
  nChord?: number;
}

/**
 * One blade standing along +y at angle 0, mid-chord at x = 0. The section is a NACA-like
 * thickness on a circular-arc camber line; tangential offsets are wrapped on the cylinder of
 * each radius so wide blades sit correctly on the disc.
 */
export function bladeGeometry(b: BladeSpec) {
  const nS = b.nSpan ?? 6,
    nC = b.nChord ?? 9;
  const loop = 2 * nC - 2;
  const pos: number[] = [];
  const idx: number[] = [];
  const lerp = (p: [number, number], t: number) => p[0] + (p[1] - p[0]) * t;
  for (let j = 0; j <= nS; j++) {
    const t = j / nS;
    const r = b.rHub + (b.rTip - b.rHub) * t;
    const c = lerp(b.chord, t);
    const le = (lerp(b.le, t) * Math.PI) / 180,
      te = (lerp(b.te, t) * Math.PI) / 180,
      th = lerp(b.thick, t);
    // camber line by integrating the metal angle
    const cam: [number, number, number][] = [];
    let ax = 0,
      tz = 0;
    const N = 40;
    const camAt: [number, number, number][] = [];
    for (let k = 0; k <= N; k++) {
      const s = k / N,
        a = le + (te - le) * s;
      camAt.push([ax, tz, a]);
      ax += (Math.cos(a) * c) / N;
      tz += (-Math.sin(a) * c) / N;
    }
    const mx = camAt[N >> 1][0],
      mz = camAt[N >> 1][1];
    for (let k = 0; k < nC; k++) {
      const s = (1 - Math.cos((Math.PI * k) / (nC - 1))) / 2;
      const f = s * N,
        k0 = Math.min(N - 1, Math.floor(f)),
        u = f - k0;
      const A = camAt[k0],
        B = camAt[k0 + 1];
      cam.push([A[0] + (B[0] - A[0]) * u - mx, A[1] + (B[1] - A[1]) * u - mz, A[2] + (B[2] - A[2]) * u]);
    }
    const sweep = (b.sweep ?? 0) * t * t;
    const ring: [number, number][] = [];
    const yt = (s: number) =>
      5 * th * c * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4);
    for (let k = 0; k < nC; k++) {
      const s = (1 - Math.cos((Math.PI * k) / (nC - 1))) / 2,
        [x, z, a] = cam[k],
        h = Math.max(yt(s), 0.012);
      ring.push([x + Math.sin(a) * h, z + Math.cos(a) * h]);
    }
    for (let k = nC - 2; k >= 1; k--) {
      const s = (1 - Math.cos((Math.PI * k) / (nC - 1))) / 2,
        [x, z, a] = cam[k],
        h = Math.max(yt(s), 0.012);
      ring.push([x - Math.sin(a) * h, z - Math.cos(a) * h]);
    }
    for (const [x, z] of ring) {
      const phi = z / r;
      pos.push(x + sweep, r * Math.cos(phi), r * Math.sin(phi));
    }
  }
  for (let j = 0; j < nS; j++)
    for (let k = 0; k < loop; k++) {
      const a = j * loop + k,
        b2 = j * loop + ((k + 1) % loop),
        c = a + loop,
        d = b2 + loop;
      idx.push(a, b2, d, a, d, c);
    }
  // tip cap
  const tip = nS * loop;
  for (let k = 0; k < nC - 1; k++) {
    const a = tip + k,
      b2 = tip + k + 1,
      ia = tip + ((loop - k) % loop),
      ib = tip + ((loop - k - 1) % loop);
    idx.push(a, ia, b2, b2, ia, ib);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A row of identical blades around the axis, at mid-chord x. */
export class BladeRow {
  readonly mesh: THREE.InstancedMesh;
  private readonly d = new THREE.Object3D();
  private readonly m = new THREE.Matrix4();

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    private readonly n: number,
    private readonly x: number,
    private readonly phase = 0,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.setPitch(0);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** Rotates every blade about its own radial axis (variable stator vanes), radians. */
  setPitch(a: number) {
    const d = this.d;
    this.m.makeRotationY(a);
    for (let i = 0; i < this.n; i++) {
      d.position.set(this.x, 0, 0);
      d.rotation.set(this.phase + (i / this.n) * Math.PI * 2, 0, 0);
      d.updateMatrix();
      d.matrix.multiply(this.m);
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
