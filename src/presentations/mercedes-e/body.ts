/*
 * Procedural sedan body in the proportions of the W214 E-Class (4949 × 1880 × 1468 mm,
 * wheelbase 2961 mm). Units: decimetres. x = forward, y = up, z = right; x = 0 is mid-wheelbase.
 *
 * The shell is lofted along x from cross-sections derived from a few profile tables (roof line,
 * shoulder line, plan widths). Each quad is classed as paint / glass / black trim from its row
 * in the section and its x, which gives the windows, pillars and roof. Wheel arches are cut in
 * the fragment shader (see archCut), so the same geometry works for every material.
 */
import * as THREE from 'three';

export const AXLE_F = 14.8;
export const AXLE_R = -14.8;
export const WHEEL_R = 3.51;
export const TRACK_F = 8.17;
export const TRACK_R = 8.24;
export const NOSE_X = 23.5;
export const TAIL_X = -26;
const ARCH_R = 4.05;
const ARCH_Y = 3.75;
const ARCH_Z = 5.7;

/** Smooth interpolation through (x, v) pairs (Catmull-Rom on the values, x ascending or descending). */
function table(pts: [number, number][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  return (x: number) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[p.length - 1][0]) return p[p.length - 1][1];
    let i = 0;
    while (x > p[i + 1][0]) i++;
    const x0 = p[i][0],
      x1 = p[i + 1][0],
      t = (x - x0) / (x1 - x0);
    const v0 = p[Math.max(0, i - 1)][1],
      v1 = p[i][1],
      v2 = p[i + 1][1],
      v3 = p[Math.min(p.length - 1, i + 2)][1];
    // centripetal-free uniform Catmull-Rom, slopes scaled by segment widths for uneven spacing
    const xa = p[Math.max(0, i - 1)][0],
      xb = p[Math.min(p.length - 1, i + 2)][0];
    const m1 = ((v2 - v0) / Math.max(x1 - xa, 1e-6)) * (x1 - x0),
      m2 = ((v3 - v1) / Math.max(xb - x0, 1e-6)) * (x1 - x0);
    const t2 = t * t,
      t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * v2 + (t3 - t2) * m2;
  };
}

/** Centre-line top: bumper, hood, windshield, roof, rear window, trunk. */
export const yTop = table([
  [23.5, 6.2],
  [23.1, 6.95],
  [21.8, 7.45],
  [17, 8.15],
  [12, 8.75],
  [7.8, 9.2],
  [5.5, 10.4],
  [2.5, 12.6],
  [0, 14.1],
  [-2.5, 14.65],
  [-5.5, 14.68],
  [-8.5, 14.3],
  [-11, 13.3],
  [-13.5, 11.8],
  [-15.6, 10.75],
  [-18, 10.42],
  [-22, 10.3],
  [-24.7, 10.28],
  [-25.6, 9.7],
  [-26, 8.8],
]);
/** Shoulder (belt) line along the side. */
export const yBelt = table([
  [23.5, 5.9],
  [22.4, 6.9],
  [17, 7.6],
  [12, 8.1],
  [7.5, 8.55],
  [0, 9.0],
  [-8, 9.45],
  [-15, 9.85],
  [-22, 9.95],
  [-25.3, 9.55],
  [-26, 8.4],
]);
const yBottom = table([
  [23.5, 2.7],
  [22, 2.1],
  [19, 1.55],
  [15, 1.4],
  [-18, 1.4],
  [-22, 1.85],
  [-25, 2.7],
  [-26, 3.3],
]);
/** Height of the widest point (the sculpted shoulder above the sills). */
const yMaxW = table([
  [23.5, 4.8],
  [20, 5.6],
  [0, 5.9],
  [-24, 6.4],
  [-26, 6.2],
]);
/** Max half width. */
export const wMax = table([
  [23.5, 7.7],
  [23.1, 8.5],
  [21.8, 9.0],
  [18.5, 9.32],
  [14, 9.4],
  [-16, 9.4],
  [-21.5, 9.3],
  [-24.6, 8.95],
  [-26, 8.1],
]);
/** Half width at the top of the side glass / of the hood and trunk shoulders. */
const wTop = table([
  [23.5, 6.6],
  [22, 8.0],
  [12, 8.5],
  [7.8, 8.3],
  [5, 7.9],
  [2, 7.4],
  [-2, 7.2],
  [-9, 7.25],
  [-12, 7.6],
  [-15.6, 8.5],
  [-22, 8.6],
  [-25, 8.3],
  [-26, 7.3],
]);

/** Side window opening and pillars. */
const DLO_F = 6.6,
  DLO_R = -13.2,
  B_PILLAR: [number, number] = [-2.05, -1.0];
const WS: [number, number] = [-0.6, 7.9]; // windshield x range (top, base)
const RW: [number, number] = [-15.5, -9.6]; // rear window x range

type Cls = 0 | 1 | 2 | 3 | 4; // paint, glass, trim, head lamp, tail lamp

const LOWER = 8; // rows from bottom centre to the belt (index of belt point = LOWER - 1)
const SIDE = 4;
const CORNER = 2;
const TOPN = 5;

/** One side of the section at x, from bottom centre to roof centre: [z, y][]. */
function section(x: number): [number, number][] {
  const yb = yBottom(x),
    ym = yMaxW(x),
    yB = yBelt(x),
    yT = Math.max(yTop(x), yB + 0.25),
    wm = wMax(x),
    wl = wm - 0.75,
    wB = wm - 0.3,
    wt = Math.min(wTop(x), wB - 0.15);
  const h = yT - yB;
  const crown = Math.min(0.75, h * 0.45);
  const ySide = yT - crown;
  const pts: [number, number][] = [
    [0, yb],
    [wl * 0.55, yb],
    [wl - 0.45, yb + 0.03],
    [wl, yb + 0.5],
    [wm - 0.12, yb + (ym - yb) * 0.55],
    [wm, ym],
    [wm - 0.08, ym + (yB - ym) * 0.55],
    [wB, yB],
  ];
  for (let k = 1; k <= SIDE; k++) {
    const t = k / SIDE;
    // a slight outward bow on the side glass
    pts.push([wB + (wt - wB) * t + Math.sin(t * Math.PI) * 0.12, yB + (ySide - yB) * t]);
  }
  pts.push([wt - 0.28, ySide + crown * 0.5], [wt - 0.85, ySide + crown * 0.82]);
  const zc = wt - 0.85;
  for (let k = 1; k <= TOPN; k++) {
    const t = k / TOPN,
      z = zc * (1 - t);
    pts.push([z, yT - crown * 0.18 * (z / zc) ** 2]);
  }
  return pts;
}

function classify(row: number, x: number): Cls {
  // lamps wrap the front / rear corners just under the shoulder line
  if (row >= 5 && row <= 7 && x > 21.4) return 3;
  if (row >= 6 && row <= 7 && x < -24.4) return 4;
  const sideRow = row >= LOWER - 1 && row < LOWER - 1 + SIDE;
  const topRow = row >= LOWER - 1 + SIDE + CORNER;
  if (sideRow) {
    if (x < DLO_F && x > DLO_R) return x > B_PILLAR[0] && x < B_PILLAR[1] ? 2 : 1;
    return 0;
  }
  if (topRow) {
    if (x > WS[0] && x < WS[1]) return 1;
    if (x > RW[0] && x < RW[1]) return 1;
  }
  return 0;
}

/** Stations along x, denser where the profile bends. */
function stations() {
  const xs: number[] = [];
  for (let x = NOSE_X; x > TAIL_X; x -= 0.45) xs.push(x);
  xs.push(TAIL_X);
  // snap the window edges onto stations so glass edges are straight
  // (an edge replaces the nearest regular station, so no sliver quads)
  for (const e of [DLO_F, DLO_R, ...B_PILLAR, ...WS, ...RW]) {
    let k = 0;
    xs.forEach((x, i) => (Math.abs(x - e) < Math.abs(xs[k] - e) ? (k = i) : 0));
    xs[k] = e;
  }
  return [...new Set(xs)].sort((a, b) => b - a);
}

/** The shell, with material groups 0 = paint, 1 = glass, 2 = black trim, 3 = head lamps, 4 = tail lamps. */
export function bodyGeometry(): THREE.BufferGeometry {
  const xs = stations();
  const K = section(0).length;
  const M = 2 * K - 2; // ring size
  const idx = (j: number) => (j < K ? j : M - j);
  const pos: number[] = [];
  const uv: number[] = [];
  const ring = (x: number, sc = 1, ys = 1) => {
    const s = section(x);
    const ymid = (s[0][1] + s[K - 1][1]) / 2;
    for (let j = 0; j < M; j++) {
      const i = idx(j),
        side = j < K ? 1 : -1;
      pos.push(x, ymid + (s[i][1] - ymid) * ys, side * s[i][0] * sc);
      uv.push(x / 50, j / M);
    }
  };
  // rounded nose / tail: a few shrinking rings beyond the ends, then a cap
  const nose = [
    [NOSE_X + 0.28, 0.95, 0.97],
    [NOSE_X + 0.45, 0.82, 0.9],
  ];
  const tail = [
    [TAIL_X - 0.25, 0.95, 0.97],
    [TAIL_X - 0.4, 0.84, 0.9],
  ];
  const allX: { x: number; sc: number; ys: number; at: number }[] = [];
  for (let n = nose.length - 1; n >= 0; n--) allX.push({ x: nose[n][0], sc: nose[n][1], ys: nose[n][2], at: NOSE_X });
  xs.forEach((x) => allX.push({ x, sc: 1, ys: 1, at: x }));
  tail.forEach((t) => allX.push({ x: t[0], sc: t[1], ys: t[2], at: TAIL_X }));
  allX.forEach((r) => {
    const before = pos.length;
    ring(r.at, r.sc, r.ys);
    for (let k = before; k < pos.length; k += 3) pos[k] = r.x;
  });
  const groups: number[][] = [[], [], [], [], []];
  const N = allX.length;
  for (let s = 0; s < N - 1; s++) {
    const xm = (allX[s].x + allX[s + 1].x) / 2;
    for (let j = 0; j < M; j++) {
      const a = s * M + j,
        b = s * M + ((j + 1) % M),
        c = (s + 1) * M + j,
        d = (s + 1) * M + ((j + 1) % M);
      const row = Math.min(idx(j), idx((j + 1) % M));
      const cls = classify(row, xm);
      groups[cls].push(a, b, c, b, d, c);
    }
  }
  // caps: fan from the ring centroid
  for (const [s, flip] of [
    [0, true],
    [N - 1, false],
  ] as [number, boolean][]) {
    let cy = 0;
    for (let j = 0; j < M; j++) cy += pos[(s * M + j) * 3 + 1];
    const ci = pos.length / 3;
    pos.push(pos[s * M * 3], cy / M, 0);
    uv.push(0, 0);
    for (let j = 0; j < M; j++) {
      const a = s * M + j,
        b = s * M + ((j + 1) % M);
      if (flip) groups[0].push(ci, b, a);
      else groups[0].push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const index: number[] = [];
  groups.forEach((gr, m) => {
    g.addGroup(index.length, gr.length, m);
    index.push(...gr);
  });
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Cuts the wheel openings: discards fragments inside the arch circles on the outer sides.
 * Works on any built-in material; the local position is passed down as vBodyPos.
 */
export function archCut(m: THREE.Material) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace(
      'void main() {',
      `varying vec3 vBodyPos;
      void main() {
        if (abs(vBodyPos.z) > ${ARCH_Z.toFixed(2)} && vBodyPos.y < ${(ARCH_Y + ARCH_R).toFixed(2)} &&
            (length(vBodyPos.xy - vec2(${AXLE_F.toFixed(2)}, ${ARCH_Y.toFixed(2)})) < ${ARCH_R.toFixed(2)} ||
             length(vBodyPos.xy - vec2(${AXLE_R.toFixed(2)}, ${ARCH_Y.toFixed(2)})) < ${ARCH_R.toFixed(2)})) discard;`,
    );
  };
  m.customProgramCacheKey = () => 'archcut';
  return m;
}

/** Wheel-arch liner: half tube following the opening. */
export function archLiner(x: number, side: 1 | -1) {
  const g = new THREE.CylinderGeometry(ARCH_R - 0.05, ARCH_R - 0.05, 9.4 - ARCH_Z, 28, 1, true, Math.PI / 2 - 0.35, Math.PI + 0.7);
  g.rotateX(Math.PI / 2);
  g.translate(x, ARCH_Y, side * (ARCH_Z + (9.4 - ARCH_Z) / 2));
  return g;
}

/** Fresnel "X-ray" shell: only the silhouette and the grazing surfaces glow. */
export function xrayMaterial(color: number, strength = 1) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vBodyPos;
      void main() {
        vBodyPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vBodyPos;
      void main() {
        if (abs(vBodyPos.z) > ${ARCH_Z.toFixed(2)} && vBodyPos.y < ${(ARCH_Y + ARCH_R).toFixed(2)} &&
            (length(vBodyPos.xy - vec2(${AXLE_F.toFixed(2)}, ${ARCH_Y.toFixed(2)})) < ${ARCH_R.toFixed(2)} ||
             length(vBodyPos.xy - vec2(${AXLE_R.toFixed(2)}, ${ARCH_Y.toFixed(2)})) < ${ARCH_R.toFixed(2)})) discard;
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = (0.015 + pow(f, 3.0) * 0.55) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return m;
}
