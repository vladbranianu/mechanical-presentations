/* Serpentine belt: convex hull around the pulleys, resampled and extruded as a flat band. */
import * as THREE from 'three';

type Pulleys = Record<string, { y: number; z: number; r: number }>;

export function beltGeo(pul: Pulleys, beltX: number, th: number, hw: number) {
  const P: [number, number][] = [];
  Object.values(pul).forEach((p) => {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      P.push([p.z + (p.r + 0.02) * Math.cos(a), p.y + (p.r + 0.02) * Math.sin(a)]);
    }
  });
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [],
    up: [number, number][] = [];
  for (const p of P) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  const H = lo.slice(0, -1).concat(up.slice(0, -1)); // CCW in (z, y)
  const per: number[] = [];
  let tot = 0;
  for (let i = 0; i < H.length; i++) {
    const a = H[i],
      b = H[(i + 1) % H.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    per.push(l);
    tot += l;
  }
  const N = 360,
    pts: [number, number][] = [];
  let seg = 0,
    acc = 0;
  for (let k = 0; k < N; k++) {
    const t = (k / N) * tot;
    while (acc + per[seg] < t) {
      acc += per[seg];
      seg++;
    }
    const a = H[seg],
      b = H[(seg + 1) % H.length],
      u = (t - acc) / per[seg];
    pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  for (let k = 0; k < N; k++) {
    const p = pts[k],
      q = pts[(k + 1) % N],
      o = pts[(k - 1 + N) % N];
    const tz = q[0] - o[0],
      ty = q[1] - o[1],
      l = Math.hypot(tz, ty);
    const nz = ty / l,
      ny = -tz / l; // outward for CCW
    const u = k / N;
    const ring = [
      [p[0], p[1], -hw],
      [p[0] + nz * th, p[1] + ny * th, -hw],
      [p[0] + nz * th, p[1] + ny * th, hw],
      [p[0], p[1], hw],
    ];
    ring.forEach((r, j) => {
      pos.push(beltX + r[2], r[1], r[0]);
      uv.push(u, j / 3);
    });
  }
  for (let k = 0; k < N; k++) {
    const a = k * 4,
      b = ((k + 1) % N) * 4;
    for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) % 4;
      idx.push(a + j, b + j, b + j2, a + j, b + j2, a + j2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, len: tot };
}
