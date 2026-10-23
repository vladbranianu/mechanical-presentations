/* Procedural-modelling helpers shared by presentations built from primitives. */
import * as THREE from 'three';

export const RAD = Math.PI / 180;
export const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const cylX = (r: number, len: number, seg = 28) =>
  new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
export const cylY = (r: number, len: number, seg = 28) => new THREE.CylinderGeometry(r, r, len, seg);
export const cylZ = (r: number, len: number, seg = 28) =>
  new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

/** Rounded, bevelled box centred on the origin (extruded along z). */
export function rbox(w: number, h: number, d: number, r = 1, b = 0.45) {
  const W = w / 2 - b,
    H = h / 2 - b,
    rr = Math.max(0.01, Math.min(r, W - 0.01, H - 0.01)),
    s = new THREE.Shape();
  s.moveTo(-W + rr, -H);
  s.lineTo(W - rr, -H);
  s.quadraticCurveTo(W, -H, W, -H + rr);
  s.lineTo(W, H - rr);
  s.quadraticCurveTo(W, H, W - rr, H);
  s.lineTo(-W + rr, H);
  s.quadraticCurveTo(-W, H, -W, H - rr);
  s.lineTo(-W, -H + rr);
  s.quadraticCurveTo(-W, -H, -W + rr, -H);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(d - 2 * b, 0.01),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 3,
    curveSegments: 6,
  });
  g.center();
  return g;
}

/** Bolt spec: [x, y, z, axis, sign]. Head points along +axis (or -axis when sign < 0). */
export type BoltSpec = [number, number, number, 'x' | 'y' | 'z', number?];
const hexGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 6).translate(0, 0.18, 0);

export function bolts(parent: THREE.Object3D, list: BoltSpec[], mat: THREE.Material) {
  const im = new THREE.InstancedMesh(hexGeo, mat, list.length),
    d = new THREE.Object3D();
  list.forEach((b, i) => {
    d.position.set(b[0], b[1], b[2]);
    d.rotation.set(0, 0, 0);
    const sg = b[4] ?? 1;
    if (b[3] === 'z') d.rotation.x = sg > 0 ? Math.PI / 2 : -Math.PI / 2;
    else if (b[3] === 'x') d.rotation.z = sg > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (sg < 0) d.rotation.x = Math.PI;
    d.updateMatrix();
    im.setMatrixAt(i, d.matrix);
  });
  im.castShadow = true;
  parent.add(im);
  return im;
}

export function tube(
  parent: THREE.Object3D,
  pts: number[][],
  r: number,
  mat: THREE.Material,
  seg = 40,
  closed = false,
) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => V3(p[0], p[1], p[2])),
    closed,
  );
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 12, closed), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Repeating texture drawn on a 2D canvas. */
export function canvasTex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat?: [number, number],
) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

/** Grey value noise, `amp` = max deviation from mid-grey. */
export function fillNoise(ctx: CanvasRenderingContext2D, w: number, h: number, cells: number, amp: number) {
  const s = document.createElement('canvas');
  s.width = s.height = cells;
  const sx = s.getContext('2d')!;
  const id = sx.createImageData(cells, cells);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 2 * amp;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  sx.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(s, 0, 0, w, h);
}

/** Frees every geometry / material / texture under `root`. */
export function disposeTree(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
  });
  mats.forEach((m) => {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
    m.dispose();
  });
}
