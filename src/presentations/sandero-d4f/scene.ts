/*
 * Renault D4F 1.2 16V (Dacia Sandero 2009) cutaway, built from primitives in the same style as
 * the flat-six. Motion follows the slider-crank kinematics; the valve train is a single camshaft
 * driving forked roller rockers (one per valve pair).
 */
import * as THREE from 'three';
import type { BuildContext, PresentationInstance } from '../../framework/types';
import { SectionView, type SectionMode } from '../../framework/three/section';
import {
  RAD,
  V3,
  bolts,
  canvasTex,
  cylX,
  cylY,
  cylZ,
  disposeTree,
  fillNoise,
  rbox,
  tube,
  type BoltSpec,
} from '../../framework/three/geometry';
import {
  AB,
  AB_X,
  BLOCK_X,
  BORE,
  CAM_RB,
  CAM_Y,
  CH,
  CYL,
  DECK,
  EX_CLOSE,
  EX_OPEN,
  HEAD_TOP,
  IN_CLOSE,
  IN_OPEN,
  L,
  LOBE_DX,
  MAX_LIFT,
  PITCH,
  PLUG_ANG,
  R,
  ROCKER_SHAFT,
  ROLLER,
  ROLLER_R,
  SLOWS,
  SPARK_ADV,
  TB,
  TB_X,
  VALVE_ANG,
  VALVE_DX,
  VALVE_SEAT,
  VALVE_STEM,
  lift,
  type CylDef,
  type Pulley,
} from './engine';
import { HOME_VIEW, makeParts } from './content';

export interface SanderoParams {
  rpm: number;
  slowIdx: number;
}

/** Per-cylinder runtime state, read by the HUD and the part panel. */
export interface CylState extends CylDef {
  piston: THREE.Group;
  rod: THREE.Group;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  spark: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** [intake a, intake b, exhaust a, exhaust b] */
  valves: THREE.Group[];
  springs: THREE.Mesh[];
  /** [intake, exhaust] */
  rockers: THREE.Group[];
  lobes: THREE.Group[];
  /** cycle angle 0..720 */
  p: number;
  rodAng: number;
  crown: number;
  liftI: number;
  liftE: number;
}

export interface SanderoSim {
  theta: number;
  rpm: number;
  explode: number;
  fire: CylState | null;
  cyl: CylState[];
}

export type SanderoInstance = PresentationInstance<SanderoParams> & { sim: SanderoSim };

// Same light rig as the flat-six (legacy-tuned values ×π for physically-based units).
const PI = Math.PI;
const FLOOR_Y = -13;

/** Convex hull around a set of pulleys in the (z, y) plane, resampled to N points (CCW). */
function beltPath(pulleys: Pulley[], N: number) {
  const P: [number, number][] = [];
  pulleys.forEach((p) => {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
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
  const H = lo.slice(0, -1).concat(up.slice(0, -1));
  const per: number[] = [];
  let tot = 0;
  for (let i = 0; i < H.length; i++) {
    const a = H[i],
      b = H[(i + 1) % H.length],
      l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    per.push(l);
    tot += l;
  }
  const pts: [number, number][] = [];
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
  return { pts, len: tot };
}

/** Flat band along a closed (z, y) path in the plane x = x0. */
function beltMesh(pts: [number, number][], x0: number, hw: number, th: number, mat: THREE.Material) {
  const N = pts.length,
    pos: number[] = [],
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
    [
      [p[0], p[1], -hw],
      [p[0] + nz * th, p[1] + ny * th, -hw],
      [p[0] + nz * th, p[1] + ny * th, hw],
      [p[0], p[1], hw],
    ].forEach((r, j) => {
      pos.push(x0 + r[2], r[1], r[0]);
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
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Extrudes a (z, y) outline along x, from x0 to x0 + depth. */
function extrudeZY(outline: [number, number][], x0: number, depth: number, bevel = 0.3) {
  const s = new THREE.Shape();
  outline.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: depth - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // shape x → world z, shape y → world y, extrusion → world x
  g.rotateY(-Math.PI / 2);
  g.translate(x0 + depth - bevel, 0, 0);
  return g;
}

export function buildSandero({ gl, scene }: BuildContext): SanderoInstance {
  const root = new THREE.Group();
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

  /* ---------- Procedural textures ---------- */
  const castBump = canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = '#808080';
      x.fillRect(0, 0, w, h);
      fillNoise(x, w, h, 48, 70);
      x.globalAlpha = 0.5;
      fillNoise(x, w, h, 256, 75);
      x.globalAlpha = 1;
    },
    [0.4, 0.4],
  );
  const fineBump = canvasTex(256, 256, (x, w, h) => fillNoise(x, w, h, 256, 60), [0.6, 0.6]);
  const plasticBump = canvasTex(256, 256, (x, w, h) => fillNoise(x, w, h, 128, 40), [0.8, 0.8]);
  const rustMap = canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = '#4b423d';
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const r = 2 + Math.random() * 10;
        x.fillStyle = Math.random() < 0.5 ? 'rgba(110,68,44,.14)' : 'rgba(30,28,27,.22)';
        x.beginPath();
        x.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
        x.fill();
      }
    },
    [1, 1],
  );
  const timingBeltMap = canvasTex(
    64,
    16,
    (x, w, h) => {
      x.fillStyle = '#121315';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#26282c';
      for (let i = 0; i < w; i += 8) x.fillRect(i, 0, 4, h);
      x.fillStyle = '#3a3428';
      x.fillRect(0, h / 2 - 1, w, 1);
    },
    [80, 1],
  );
  const polyVMap = canvasTex(
    16,
    64,
    (x, w, h) => {
      x.fillStyle = '#17181b';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#25272b';
      for (let j = 0; j < h; j += 10) x.fillRect(0, j, w, 4);
    },
    [1, 1],
  );
  const floorMap = canvasTex(256, 256, (x, w, h) => {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(150,165,178,.14)');
    g.addColorStop(1, 'rgba(150,165,178,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });

  /* ---------- Environment for reflections ---------- */
  const envTex = canvasTex(32, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#9aa3aa');
    gr.addColorStop(0.2, '#4d565d');
    gr.addColorStop(0.46, '#22272c');
    gr.addColorStop(0.56, '#121518');
    gr.addColorStop(1, '#050607');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(250,248,244,.95)';
    g.fillRect(0, 30, w, 10);
    g.fillStyle = 'rgba(255,205,170,.55)';
    g.fillRect(0, 84, w, 6);
    g.fillStyle = 'rgba(170,205,230,.45)';
    g.fillRect(0, 104, w, 4);
  });
  envTex.colorSpace = THREE.SRGBColorSpace;
  const envScene = new THREE.Scene();
  envScene.add(
    new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide })),
  );
  const pmrem = new THREE.PMREMGenerator(gl);
  const envRT = pmrem.fromScene(envScene, 0.025);
  pmrem.dispose();
  disposeTree(envScene);
  const prevEnv = scene.environment,
    prevFog = scene.fog;
  scene.environment = envRT.texture;
  scene.fog = new THREE.Fog(0x121518, 90, 210);

  /* ---------- Lights ---------- */
  root.add(new THREE.HemisphereLight(0xc4d4e0, 0x1b1612, 0.2 * PI));
  const key = new THREE.DirectionalLight(0xfff8f0, 1.05 * PI);
  key.position.set(-24, 50, 34);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -38, right: 38, top: 40, bottom: -36, near: 10, far: 140 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  root.add(key);
  const rimWarm = new THREE.DirectionalLight(0xffc4a0, 0.6 * PI);
  rimWarm.position.set(40, 10, -42);
  root.add(rimWarm);
  const rimCool = new THREE.DirectionalLight(0x9cc4ff, 0.38 * PI);
  rimCool.position.set(-46, 6, -26);
  root.add(rimCool);
  const fill = new THREE.DirectionalLight(0xe8eef4, 0.22 * PI);
  fill.position.set(10, 6, 50);
  root.add(fill);
  const FIRE_GAIN = 40;
  const fireLight = new THREE.PointLight(0xff7a2e, 0, 22, 2);
  root.add(fireLight);

  /* ---------- Section planes ---------- */
  // cut region = 0 < z < 8.2 AND |x| < 17.6: the front half of block, head and cover.
  const CUT_X = 17.6,
    CUT_Z = 8.2;
  const section = new SectionView([
    new THREE.Plane(V3(0, 0, -1), 0),
    new THREE.Plane(V3(0, 0, 1), -CUT_Z),
    new THREE.Plane(V3(-1, 0, 0), -CUT_X),
    new THREE.Plane(V3(1, 0, 0), -CUT_X),
  ]);
  const housing = section.housing.bind(section);

  /* ---------- Materials ---------- */
  const st = <M extends THREE.Material>(m: M) => section.material(m);
  const MS = {
    iron: st(std({ color: 0x46494d, metalness: 0.45, roughness: 0.72, bumpMap: castBump, bumpScale: 0.016 })),
    ironDark: st(std({ color: 0x36393c, metalness: 0.45, roughness: 0.74, bumpMap: castBump, bumpScale: 0.016 })),
    alu: st(std({ color: 0xa9aeb1, metalness: 0.62, roughness: 0.5, bumpMap: fineBump, bumpScale: 0.01 })),
    aluDark: st(std({ color: 0x878c90, metalness: 0.62, roughness: 0.52, bumpMap: fineBump, bumpScale: 0.01 })),
    plastic: st(std({ color: 0x1b1c1f, metalness: 0.05, roughness: 0.78, bumpMap: plasticBump, bumpScale: 0.004 })),
    sump: st(std({ color: 0x26282b, metalness: 0.45, roughness: 0.5 })),
    bore: st(std({ color: 0xa6abae, metalness: 0.8, roughness: 0.32, side: THREE.DoubleSide })),
    gasket: st(std({ color: 0x3c3f42, metalness: 0.6, roughness: 0.5 })),
    bolt: st(std({ color: 0x9da3a8, metalness: 0.9, roughness: 0.32 })),
    machined: st(std({ color: 0xcfd3d6, metalness: 0.85, roughness: 0.28 })),
    shield: st(std({ color: 0xc9ccce, metalness: 0.9, roughness: 0.42, side: THREE.DoubleSide })),
  };
  const M = {
    crank: std({ color: 0xb9c0c6, metalness: 0.9, roughness: 0.26 }),
    rod: std({ color: 0x9fa7af, metalness: 0.9, roughness: 0.3 }),
    piston: std({ color: 0xd9dcde, metalness: 0.7, roughness: 0.32 }),
    valve: std({ color: 0xaab0b5, metalness: 0.85, roughness: 0.3 }),
    cam: std({ color: 0x8b939a, metalness: 0.85, roughness: 0.3 }),
    rocker: std({ color: 0x9aa1a7, metalness: 0.85, roughness: 0.34 }),
    plug: std({ color: 0xf0ede6, metalness: 0, roughness: 0.35 }),
    plugHex: std({ color: 0xa8adb2, metalness: 0.9, roughness: 0.3 }),
    coil: std({ color: 0x24272b, metalness: 0.25, roughness: 0.4 }),
    fly: std({ color: 0x7a8288, metalness: 0.85, roughness: 0.34 }),
    exhaust: std({ color: 0xffffff, map: rustMap, metalness: 0.45, roughness: 0.78, bumpMap: castBump, bumpScale: 0.02 }),
    cat: std({ color: 0xb6babd, metalness: 0.8, roughness: 0.36 }),
    intake: std({ color: 0x2b2d30, metalness: 0.05, roughness: 0.55, bumpMap: plasticBump, bumpScale: 0.004 }),
    tbelt: std({ color: 0xffffff, map: timingBeltMap, metalness: 0.05, roughness: 0.8, side: THREE.DoubleSide }),
    sprocket: std({ color: 0x5f666c, metalness: 0.85, roughness: 0.38 }),
    abelt: std({ color: 0xffffff, map: polyVMap, metalness: 0.05, roughness: 0.8, side: THREE.DoubleSide }),
    pulley: std({ color: 0x3c4146, metalness: 0.75, roughness: 0.38 }),
    acc: std({ color: 0x9aa0a4, metalness: 0.7, roughness: 0.45, bumpMap: castBump, bumpScale: 0.01 }),
    oil: std({ color: 0x8a6a1c, metalness: 0.2, roughness: 0.4 }),
  };
  const black = std({ color: 0x202225, metalness: 0.35, roughness: 0.5 });
  const rubber = std({ color: 0x141516, metalness: 0, roughness: 0.85 });
  const PART_MATS: Record<string, THREE.MeshStandardMaterial[]> = {
    crank: [M.crank],
    rod: [M.rod],
    piston: [M.piston],
    valve: [M.valve],
    cam: [M.cam, M.rocker],
    plug: [M.plug, M.plugHex, M.coil],
    fly: [M.fly],
    exhaust: [M.exhaust, M.cat],
    intake: [M.intake],
    timing: [M.tbelt, M.sprocket],
    belt: [M.abelt, M.pulley, M.acc],
    oil: [MS.sump, M.oil],
  };

  /* ---------- Picking registry ---------- */
  const pickables: THREE.Object3D[] = [];
  function reg<T extends THREE.Object3D>(part: string, obj: T): T {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.userData.part = part;
        pickables.push(o);
      }
    });
    return obj;
  }
  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* ---------- Groups ---------- */
  const blockG = new THREE.Group(),
    headG = new THREE.Group(),
    coverG = new THREE.Group(),
    intakeG = new THREE.Group(),
    exhaustG = new THREE.Group(),
    sumpG = new THREE.Group(),
    timingG = new THREE.Group(),
    tcoverG = new THREE.Group(),
    accG = new THREE.Group();
  root.add(blockG, headG, coverG, intakeG, exhaustG, sumpG, timingG, tcoverG, accG);

  /* ---------- Cylinder block (cast iron) ---------- */
  const BLK_LO = -3.2,
    BLK_H = DECK - BLK_LO,
    BLK_D = 12.8;
  housing(blockG, rbox(2 * BLOCK_X, BLK_H, BLK_D, 1.0, 0.5), MS.iron, 0, (DECK + BLK_LO) / 2, 0);
  housing(blockG, new THREE.BoxGeometry(2 * BLOCK_X + 0.5, 0.6, BLK_D + 0.6), MS.ironDark, 0, DECK - 0.3, 0);
  housing(blockG, new THREE.BoxGeometry(2 * BLOCK_X + 0.3, 0.6, BLK_D + 0.5), MS.ironDark, 0, BLK_LO + 0.3, 0);
  // external ribs between the cylinders (front + back faces) and a waist rib
  [-2, -1, 0, 1, 2].forEach((i) =>
    [1, -1].forEach((s) =>
      housing(blockG, rbox(0.9, 13.6, 0.9, 0.3, 0.15), MS.iron, i * PITCH, 4.6, s * (BLK_D / 2 + 0.25), false),
    ),
  );
  [1, -1].forEach((s) => housing(blockG, rbox(2 * BLOCK_X - 1, 0.8, 0.8, 0.3, 0.15), MS.iron, 0, 8.4, s * (BLK_D / 2 + 0.3), false));
  // siamese bore bulges on the faces
  CYL.forEach((c) =>
    [1, -1].forEach((s) => {
      housing(blockG, cylY(3.3, DECK - 9.6, 32), MS.iron, c.x, (DECK + 9.6) / 2, s * (BLK_D / 2 - 2.85), false);
    }),
  );
  // core (freeze) plugs on the front face
  CYL.slice(1).forEach((c) => mesh(blockG, cylZ(0.9, 0.3, 24), MS.machined, c.x + PITCH / 2, 12.6, BLK_D / 2 + 0.3));
  // main bearing bulkheads (visible as half-moons in the section)
  [-2, -1, 0, 1, 2].forEach((i) => housing(blockG, cylX(3.1, 1.3, 32), MS.ironDark, i * PITCH, 0, 0, false));
  // bore liners
  const LINER_LO = 7.6;
  CYL.forEach((c) => {
    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(BORE / 2 + 0.05, BORE / 2 + 0.05, DECK - LINER_LO, 40, 1, true),
      MS.bore,
    );
    liner.position.set(c.x, (DECK + LINER_LO) / 2, 0);
    liner.receiveShadow = true;
    blockG.add(liner);
  });
  // head gasket
  housing(blockG, new THREE.BoxGeometry(2 * BLOCK_X + 0.2, 0.2, BLK_D + 2.2), MS.gasket, 0, DECK + 0.1, 0, false);
  // knock sensor (back face) + oil pressure switch
  mesh(blockG, cylZ(0.8, 0.9, 20), black, -2, 6, -(BLK_D / 2 + 0.7));
  mesh(blockG, cylZ(0.45, 1.2, 6), M.acc, 9, 2.6, -(BLK_D / 2 + 0.6));

  /* ---------- Sump + oil system ---------- */
  housing(sumpG, new THREE.BoxGeometry(2 * BLOCK_X - 0.6, 0.45, BLK_D + 1.4), MS.sump, 0, BLK_LO - 0.25, 0);
  housing(sumpG, rbox(2 * BLOCK_X - 2, 7.2, BLK_D + 0.6, 1.4, 0.6), MS.sump, 0, BLK_LO - 4.1, 0);
  housing(sumpG, rbox(16, 1.6, BLK_D - 0.6, 0.8, 0.4), MS.sump, 2, BLK_LO - 8.1, 0);
  mesh(sumpG, cylY(0.55, 0.6, 6), MS.bolt, 6, BLK_LO - 9.1, 2);
  {
    const l: BoltSpec[] = [];
    for (let i = 0; i < 10; i++) {
      const x = -15.4 + i * 3.42;
      l.push([x, BLK_LO - 0.5, BLK_D / 2 + 0.45, 'y', -1], [x, BLK_LO - 0.5, -(BLK_D / 2 + 0.45), 'y', -1]);
    }
    bolts(sumpG, l, MS.bolt);
  }
  // oil filter (back, low, angled down)
  const oilG = new THREE.Group();
  sumpG.add(oilG);
  {
    const f = new THREE.Group();
    f.position.set(-7.5, 0.2, -(BLK_D / 2 + 2.6));
    f.rotation.x = -0.75;
    mesh(f, cylY(2.05, 4.6, 36), std({ color: 0xe0e2e4, metalness: 0.4, roughness: 0.35 }), 0, -1.8, 0);
    mesh(f, cylY(2.08, 0.9, 36), std({ color: 0x1d3c6e, metalness: 0.35, roughness: 0.4 }), 0, -0.6, 0);
    const ribs = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.5, 12), black);
    ribs.position.y = -4.25;
    f.add(ribs);
    mesh(f, cylY(1.5, 1.4, 24), MS.iron, 0, 1.1, 0);
    oilG.add(f);
  }
  // dipstick tube + handle (back, timing end)
  tube(oilG, [[-13.8, BLK_LO + 1, -(BLK_D / 2 + 0.5)], [-13.8, 8, -(BLK_D / 2 + 1.4)], [-13.8, 18, -(BLK_D / 2 + 2.6)], [-13.8, 25, -(BLK_D / 2 + 3.4)]], 0.24, MS.machined, 30);
  {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.22, 8, 22), std({ color: 0xe8b21e, roughness: 0.5 }));
    h.position.set(-13.8, 26.1, -(BLK_D / 2 + 3.5));
    h.rotation.y = Math.PI / 2;
    oilG.add(h);
    mesh(oilG, cylY(0.36, 0.6, 12), black, -13.8, 25.2, -(BLK_D / 2 + 3.4));
  }

  /* ---------- Crankshaft (moving) ---------- */
  const crank = new THREE.Group();
  root.add(crank);
  // a = pin direction, as an angle from +y towards +z
  function web(x: number, a: number) {
    const inner = -1.8,
      outer = R + 1.6,
      len = outer - inner,
      c = (inner + outer) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, len, 3.9), M.crank);
    m.position.set(x, c * Math.cos(a), c * Math.sin(a));
    m.rotation.x = a;
    crank.add(m);
    const span = Math.PI * 0.95,
      mid = -Math.PI / 2 - a;
    crank.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(5.1, 5.1, 1.1, 32, 1, false, mid - span / 2, span).rotateZ(Math.PI / 2).translate(x, 0, 0),
        M.crank,
      ),
    );
  }
  CYL.forEach((c) => {
    const a = c.phi * RAD;
    const pin = new THREE.Mesh(cylX(1.85, 2.1, 28), M.crank);
    pin.position.set(c.x, R * Math.cos(a), R * Math.sin(a));
    crank.add(pin);
    web(c.x - 1.6, a);
    web(c.x + 1.6, a);
  });
  // main journals between the webs, snout, rear flange
  [
    [-BLOCK_X, CYL[3].x - 2.15],
    [CYL[3].x + 2.15, CYL[2].x - 2.15],
    [CYL[2].x + 2.15, CYL[1].x - 2.15],
    [CYL[1].x + 2.15, CYL[0].x - 2.15],
    [CYL[0].x + 2.15, BLOCK_X],
  ].forEach(([x0, x1]) => {
    const m = new THREE.Mesh(cylX(2.2, x1 - x0, 32), M.crank);
    m.position.x = (x0 + x1) / 2;
    crank.add(m);
  });
  {
    const sn = new THREE.Mesh(cylX(1.5, 6.4, 24), M.crank);
    sn.position.x = -BLOCK_X - 3.2;
    crank.add(sn);
    const fl = new THREE.Mesh(cylX(3.1, 0.7, 32), M.crank);
    fl.position.x = BLOCK_X + 0.35;
    crank.add(fl);
  }
  reg('crank', crank);

  // flywheel + clutch (child of the crank; explode slides it along x)
  const fly = new THREE.Group();
  crank.add(fly);
  {
    const FX = BLOCK_X + 1.5;
    fly.add(new THREE.Mesh(cylX(10, 1.5, 72), M.fly).translateX(FX));
    const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.45, 0.62), M.fly, 112),
      dm = new THREE.Object3D();
    for (let i = 0; i < 112; i++) {
      const a = (i / 112) * Math.PI * 2;
      dm.position.set(FX, 10.2 * Math.cos(a), 10.2 * Math.sin(a));
      dm.rotation.set(a, 0, 0);
      dm.updateMatrix();
      teeth.setMatrixAt(i, dm.matrix);
    }
    fly.add(teeth);
    fly.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(8.4, 8.8, 2, 48).rotateZ(Math.PI / 2),
        std({ color: 0x4a5056, metalness: 0.8, roughness: 0.35 }),
      ).translateX(FX + 1.7),
    );
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2,
        f = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 3.8), M.fly);
      f.position.set(FX + 2.8, 2.9 * Math.cos(a), 2.9 * Math.sin(a));
      f.rotation.x = a;
      fly.add(f);
    }
    // cover windows + rivets
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5,
        w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 2.2), black);
      w.position.set(FX + 2.6, 6.4 * Math.cos(a), 6.4 * Math.sin(a));
      w.rotation.x = a;
      fly.add(w);
    }
    fly.add(new THREE.Mesh(cylX(1.4, 1.2, 24), M.fly).translateX(FX + 3));
    const bl: BoltSpec[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bl.push([FX + 2.65, 7.6 * Math.cos(a), 7.6 * Math.sin(a), 'x', 1]);
    }
    bolts(fly, bl, M.fly);
    const mk = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 1.4, 0.5),
      std({ color: 0xd9a441, metalness: 0.3, roughness: 0.4, emissive: 0x2a1d05 }),
    );
    mk.position.set(FX + 0.8, 9, 0);
    fly.add(mk);
  }
  reg('fly', fly);

  /* ---------- Per-cylinder parts ---------- */
  const UP = V3(0, 1, 0);
  const ca = Math.cos(VALVE_ANG * RAD),
    sa = Math.sin(VALVE_ANG * RAD);
  // valve axis, pointing up the stem, for a side (s = -1 intake, +1 exhaust)
  const axis = (s: number) => V3(0, ca, s * sa);
  const qIn = new THREE.Quaternion().setFromUnitVectors(UP, axis(-1)),
    qEx = new THREE.Quaternion().setFromUnitVectors(UP, axis(1));
  const tipY = VALVE_SEAT.y + VALVE_STEM * ca,
    tipZ = VALVE_SEAT.z + VALVE_STEM * sa;
  const padArm = { z: tipZ - ROCKER_SHAFT.z, y: tipY + 0.06 - ROCKER_SHAFT.y };
  const PAD_LEN = Math.hypot(padArm.z, padArm.y);
  const rollArm = { z: ROLLER.z - ROCKER_SHAFT.z, y: ROLLER.y - ROCKER_SHAFT.y };
  const ROLL_LEN = Math.hypot(rollArm.z, rollArm.y);
  const LOBE_LIFT = (MAX_LIFT * ROLL_LEN) / PAD_LEN;
  // direction from the cam axis to a roller, as an angle from +y towards +z
  const contactAng = (s: number) => Math.atan2(s * ROLLER.z, ROLLER.y - CAM_Y);

  const lobeGeo = (dur: number) => {
    const sh = new THREE.Shape(),
      N = 120;
    for (let i = 0; i <= N; i++) {
      const psi = (i / N) * Math.PI * 2 - Math.PI,
        k = (2 * psi) / (dur * RAD), // crank-angle offset from the nose, as a fraction of the window
        f = Math.abs(k) < 0.5 ? Math.pow(Math.cos(Math.PI * k), 1.4) : 0,
        r = CAM_RB + LOBE_LIFT * f,
        z = r * Math.sin(psi),
        y = r * Math.cos(psi);
      if (i) sh.lineTo(z, y);
      else sh.moveTo(z, y);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.8, bevelEnabled: false, curveSegments: 4 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.4, 0, 0);
    return g;
  };
  const lobeIn = lobeGeo(IN_CLOSE - IN_OPEN),
    lobeEx = lobeGeo(EX_CLOSE - EX_OPEN);
  const springMat = std({ color: 0x5a6268, metalness: 0.7, roughness: 0.4 });
  const SPRING_L = 2.3;
  const springGeo = (() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 140; i++) {
      const t = i / 140,
        a = t * Math.PI * 2 * 6.5;
      pts.push(V3(0.62 * Math.cos(a), t * SPRING_L, 0.62 * Math.sin(a)));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 140, 0.085, 6);
  })();
  const ringMat = std({ color: 0x3a4249, metalness: 0.7, roughness: 0.45 });
  const sparkMat = () =>
    new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const qPlug = new THREE.Quaternion().setFromUnitVectors(UP, V3(0, Math.cos(PLUG_ANG * RAD), Math.sin(PLUG_ANG * RAD)));
  const PLUG_BASE = { y: DECK + 0.75, z: 0.35 };
  const plugDir = V3(0, Math.cos(PLUG_ANG * RAD), Math.sin(PLUG_ANG * RAD));

  const cyl: CylState[] = CYL.map((c) => {
    // piston
    const pg = new THREE.Group();
    pg.add(new THREE.Mesh(cylY(BORE / 2 - 0.08, 4.4, 40), M.piston).translateY(CH - 2.2));
    [CH - 0.35, CH - 0.75, CH - 1.15].forEach((y) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(BORE / 2 - 0.06, 0.08, 6, 40).rotateX(Math.PI / 2), ringMat);
      t.position.y = y;
      pg.add(t);
    });
    // valve reliefs on the crown
    [-1, 1].forEach((s) =>
      [-1, 1].forEach((d) => {
        const r = new THREE.Mesh(cylY(1.15, 0.12, 24), ringMat);
        r.position.set(d * VALVE_DX, CH + 0.01, s * 1.5);
        pg.add(r);
      }),
    );
    pg.add(new THREE.Mesh(cylX(0.85, BORE - 1.3, 16), M.rod));
    root.add(pg);
    reg('piston', pg);
    // rod
    const rg = new THREE.Group();
    rg.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, L - 3.2, 1.4), M.rod));
    rg.add(new THREE.Mesh(cylX(2.05, 1.3, 28), M.rod).translateY(-L / 2));
    rg.add(new THREE.Mesh(cylX(1.2, 1.2, 20), M.rod).translateY(L / 2));
    rg.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 4.4), M.rod).translateY(-L / 2 - 0.4));
    [-1.7, 1.7].forEach((z) => rg.add(new THREE.Mesh(cylY(0.3, 0.6, 6), MS.bolt).translateY(-L / 2 - 0.8).translateZ(z)));
    root.add(rg);
    reg('rod', rg);
    // combustion glow
    const glow = new THREE.Mesh(
      cylY(BORE / 2 - 0.12, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    root.add(glow);

    // valves (4) + springs
    const valves: THREE.Group[] = [],
      springs: THREE.Mesh[] = [];
    [-1, 1].forEach((s) =>
      [-1, 1].forEach((d) => {
        const v = new THREE.Group();
        v.add(new THREE.Mesh(new THREE.CylinderGeometry(s < 0 ? 1.0 : 0.88, s < 0 ? 1.32 : 1.15, 0.32, 28), M.valve));
        v.add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.5, 0.8, 16), M.valve).translateY(0.55));
        v.add(new THREE.Mesh(cylY(0.25, VALVE_STEM - 0.8, 10), M.valve).translateY(0.8 + (VALVE_STEM - 0.8) / 2 - 0.05));
        v.add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.5, 0.35, 18), M.valve).translateY(VALVE_STEM - 0.65));
        v.userData.base = V3(c.x + d * VALVE_DX, VALVE_SEAT.y, s * VALVE_SEAT.z);
        v.userData.s = s;
        v.quaternion.copy((s < 0 ? qIn : qEx));
        headG.add(v);
        reg('valve', v);
        valves.push(v);
        const sp = new THREE.Mesh(springGeo, springMat);
        sp.quaternion.copy((s < 0 ? qIn : qEx));
        sp.position.copy(v.userData.base).addScaledVector(axis(s), VALVE_STEM - 3.05);
        sp.castShadow = true;
        headG.add(sp);
        reg('valve', sp);
        springs.push(sp);
      }),
    );

    // rockers: one forked rocker per side, roller on its lobe, adjuster screws on the valve tips
    const rockers = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(c.x, ROCKER_SHAFT.y, s * ROCKER_SHAFT.z);
      const lx = s * LOBE_DX;
      // box between two points of the rocker plane (z given for the exhaust side, mirrored by s)
      const bar = (x: number, w: number, h: number, z0: number, y0: number, z1: number, y1: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, Math.hypot(z1 - z0, y1 - y0) + h * 0.6), M.rocker);
        m.position.set(x, (y0 + y1) / 2, (s * (z0 + z1)) / 2);
        m.rotation.x = -Math.atan((y1 - y0) / (s * (z1 - z0)));
        m.castShadow = true;
        g.add(m);
        return m;
      };
      g.add(new THREE.Mesh(cylX(0.62, 1.4, 20), M.rocker).translateX(lx));
      // roller arm: two cheeks either side of the roller
      [-0.42, 0.42].forEach((dx) => bar(lx + dx, 0.2, 0.8, 0, 0, rollArm.z, rollArm.y));
      g.add(new THREE.Mesh(cylX(ROLLER_R, 0.6, 20), MS.machined).translateY(rollArm.y).translateZ(s * rollArm.z));
      // pad arm, bridge across the fork, two adjuster screws with lock nuts
      const bz = 0.6 * padArm.z,
        by = 0.6 * padArm.y;
      bar(lx * 0.5, 0.8, 0.8, 0, 0, bz, by);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(2 * VALVE_DX + 0.8, 0.7, 0.9), M.rocker);
      bridge.position.set(0, by, s * bz);
      g.add(bridge);
      [-1, 1].forEach((d) => {
        bar(d * VALVE_DX, 0.7, 0.6, bz, by, padArm.z, padArm.y + 0.75);
        const sc = new THREE.Mesh(cylY(0.2, 1.1, 10), MS.machined);
        sc.position.set(d * VALVE_DX, padArm.y + 0.45, s * padArm.z);
        g.add(sc);
        const nut = new THREE.Mesh(cylY(0.36, 0.3, 6), MS.bolt);
        nut.position.set(d * VALVE_DX, padArm.y + 1.15, s * padArm.z);
        g.add(nut);
      });
      headG.add(g);
      reg('cam', g);
      return g;
    });

    // cam lobes: intake at cx - LOBE_DX, exhaust at cx + LOBE_DX
    const lobes = [
      { s: -1, peak: (IN_OPEN + IN_CLOSE) / 2, geo: lobeIn },
      { s: 1, peak: (EX_OPEN + EX_CLOSE) / 2, geo: lobeEx },
    ].map((o) => {
      const pv = new THREE.Group();
      pv.position.set(c.x + o.s * LOBE_DX, CAM_Y, 0);
      const lobe = new THREE.Mesh(o.geo, M.cam);
      lobe.castShadow = true;
      pv.add(lobe);
      headG.add(pv);
      reg('cam', lobe);
      pv.userData.peak = o.peak;
      pv.userData.contact = contactAng(o.s);
      return pv;
    });

    // spark plug (leans towards the exhaust side) + coil pencil
    const sg = new THREE.Group();
    sg.add(new THREE.Mesh(cylY(0.5, 1.6, 12), M.plugHex).translateY(0.8));
    sg.add(new THREE.Mesh(cylY(0.82, 0.8, 6), M.plugHex).translateY(2.0));
    sg.add(new THREE.Mesh(cylY(0.44, 2.4, 16), M.plug).translateY(3.6));
    sg.add(new THREE.Mesh(cylY(0.62, 7.4, 16), M.coil).translateY(8.4));
    sg.add(new THREE.Mesh(cylY(0.74, 0.8, 16), rubber).translateY(12.0));
    sg.position.set(c.x, PLUG_BASE.y, PLUG_BASE.z);
    sg.quaternion.copy(qPlug);
    headG.add(sg);
    reg('plug', sg);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), sparkMat());
    spark.position.set(c.x, PLUG_BASE.y - 0.2, PLUG_BASE.z);
    headG.add(spark);

    return {
      ...c,
      piston: pg,
      rod: rg,
      glow,
      spark,
      valves,
      springs,
      rockers,
      lobes,
      p: 0,
      rodAng: 0,
      crown: 15,
      liftI: 0,
      liftE: 0,
    };
  });

  /* ---------- Cylinder head (aluminium), camshaft, rocker shafts ---------- */
  const HEAD_D = 15.2;
  housing(headG, rbox(2 * BLOCK_X + 0.4, HEAD_TOP - DECK, HEAD_D, 1.2, 0.5), MS.alu, 0, (DECK + HEAD_TOP) / 2 + 0.2, 0);
  housing(headG, new THREE.BoxGeometry(2 * BLOCK_X + 0.8, 0.5, HEAD_D + 0.5), MS.aluDark, 0, DECK + 0.45, 0);
  // port faces
  CYL.forEach((c) => {
    housing(headG, rbox(5.4, 3.4, 1.0, 0.6, 0.25), MS.alu, c.x, DECK + 4.4, -(HEAD_D / 2 + 0.4), false);
    housing(headG, rbox(4.6, 3.0, 1.0, 0.6, 0.25), MS.alu, c.x, DECK + 3.9, HEAD_D / 2 + 0.4, false);
  });
  // head bolts (seen under the cover in X-ray) on the outer rail
  {
    const l: BoltSpec[] = [];
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * PITCH;
      l.push([x, HEAD_TOP - 0.1, -6.4, 'y', 1], [x, HEAD_TOP - 0.1, 6.4, 'y', 1]);
    }
    bolts(headG, l, MS.bolt);
  }
  // camshaft (journals between cylinders), rocker shafts, bearing pedestals
  const camShaft = new THREE.Group();
  camShaft.position.set(0, CAM_Y, 0);
  headG.add(camShaft);
  camShaft.add(new THREE.Mesh(cylX(0.62, 2 * BLOCK_X + 1.6, 18), M.cam).translateX(-0.4));
  [-2, -1, 0, 1, 2].forEach((i) => {
    const j = new THREE.Mesh(cylX(1.15, 1.1, 24), M.cam);
    j.position.x = i * PITCH;
    camShaft.add(j);
  });
  // flats for the spanner, so the rotation reads
  camShaft.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 1.6), M.cam).translateX(BLOCK_X + 0.2));
  reg('cam', camShaft);
  [-1, 1].forEach((s) => {
    const sh = new THREE.Mesh(cylX(0.45, 2 * BLOCK_X - 0.6, 16), MS.machined);
    sh.position.set(0, ROCKER_SHAFT.y, s * ROCKER_SHAFT.z);
    headG.add(sh);
    reg('cam', sh);
  });
  [-2, -1, 0, 1, 2].forEach((i) => {
    const x = i * PITCH;
    housing(headG, rbox(1.2, 3.2, 8.0, 0.4, 0.2), MS.aluDark, x, HEAD_TOP + 0.6, 0, false);
  });

  /* ---------- Valve cover (plastic) + coil rail + oil filler ---------- */
  {
    const outline: [number, number][] = [
      [-7.5, HEAD_TOP - 0.1],
      [7.5, HEAD_TOP - 0.1],
      [7.5, HEAD_TOP + 1.2],
      [5.2, HEAD_TOP + 3.2],
      [-5.2, HEAD_TOP + 3.9],
      [-7.5, HEAD_TOP + 2.2],
    ];
    const cv = new THREE.Mesh(extrudeZY(outline, -BLOCK_X + 0.2, 2 * BLOCK_X - 0.4, 0.4), MS.plastic);
    cv.castShadow = cv.receiveShadow = true;
    coverG.add(cv);
    section.addBack(coverG, cv);
    // ribs on the top
    for (let i = 0; i < 7; i++)
      housing(coverG, rbox(0.6, 0.6, 7.2, 0.2, 0.1), MS.plastic, -13 + i * 4.3, HEAD_TOP + 3.75 - 0.0, -1.7, false).rotation.x = -0.065;
    const l: BoltSpec[] = [];
    for (let i = 0; i < 6; i++) {
      const x = -14.5 + i * 5.8;
      l.push([x, HEAD_TOP + 0.75, -7.9, 'z', -1], [x, HEAD_TOP + 0.75, 7.9, 'z', 1]);
    }
    bolts(coverG, l, MS.bolt);
    // oil filler cap
    const cap = mesh(coverG, cylY(1.4, 0.9, 28), M.oil, -6.5, HEAD_TOP + 4.3, -3.2);
    cap.rotation.x = -0.06;
    mesh(coverG, rbox(2.2, 0.5, 0.5, 0.2, 0.1), M.oil, -6.5, HEAD_TOP + 4.85, -3.2);
    // breather hose
    tube(coverG, [[9, HEAD_TOP + 3.7, -4], [11, HEAD_TOP + 4.6, -7], [11.5, HEAD_TOP + 2, -10.5], [11.5, 21, -12.6]], 0.55, rubber, 24);
  }
  const coilRail = new THREE.Group();
  coverG.add(coilRail);
  {
    const d = 12.4,
      y = PLUG_BASE.y + d * plugDir.y,
      z = PLUG_BASE.z + d * plugDir.z;
    const body = new THREE.Mesh(rbox(31, 2.6, 3.0, 0.8, 0.4), M.coil);
    body.position.set(0, y + 0.9, z + 0.4);
    body.rotation.x = -PLUG_ANG * RAD;
    body.castShadow = true;
    coilRail.add(body);
    CYL.forEach((c) => {
      const t = new THREE.Mesh(rbox(3.2, 2.0, 3.2, 0.5, 0.25), M.coil);
      t.position.set(c.x, y + 1.6, z + 0.9);
      t.rotation.x = -PLUG_ANG * RAD;
      coilRail.add(t);
    });
    const conn = new THREE.Mesh(rbox(2.4, 1.6, 2.0, 0.3, 0.15), black);
    conn.position.set(-16.8, y + 1.2, z + 0.6);
    coilRail.add(conn);
    tube(coilRail, [[-17.6, y + 1.2, z + 0.6], [-19.4, y + 0.2, z - 1.2], [-20.4, y - 3, z - 4], [-20.6, y - 7, z - 12]], 0.4, rubber, 24);
    const bl: BoltSpec[] = [];
    [-13.5, -0.2, 13.5].forEach((x) => bl.push([x, y + 2.3, z - 0.4, 'y', 1]));
    bolts(coilRail, bl, MS.bolt);
  }
  reg('plug', coilRail);

  /* ---------- Intake (plastic manifold, throttle body, fuel rail) ---------- */
  const PLEN = { y: 14.6, z: -15.4 };
  {
    const pl = housing(intakeG, rbox(29, 5.4, 5.4, 2.2, 0.8), M.intake, -0.5, PLEN.y, PLEN.z, false);
    pl.castShadow = true;
    housing(intakeG, rbox(30, 0.6, 6.2, 0.3, 0.2), M.intake, -0.5, PLEN.y - 2.6, PLEN.z, false);
    CYL.forEach((c) => {
      tube(
        intakeG,
        [
          [c.x, DECK + 4.4, -(HEAD_D / 2 + 0.6)],
          [c.x, DECK + 5.4, -11.2],
          [c.x, DECK + 3.4, -15.6],
          [c.x, PLEN.y + 4.6, -17.6],
          [c.x, PLEN.y + 1.4, PLEN.z - 1.4],
        ],
        1.35,
        M.intake,
        36,
      );
      mesh(intakeG, rbox(4.8, 3.2, 0.6, 0.6, 0.2), M.intake, c.x, DECK + 4.4, -(HEAD_D / 2 + 1.1));
    });
    // throttle body (gearbox end) + air inlet bellows
    const tb = mesh(intakeG, cylX(2.0, 2.8, 32), MS.machined, 15.6, PLEN.y, PLEN.z);
    tb.castShadow = true;
    mesh(intakeG, rbox(2.6, 2.8, 2.2, 0.4, 0.2), black, 15.6, PLEN.y + 0.2, PLEN.z + 2.5);
    mesh(intakeG, cylZ(0.6, 0.8, 16), black, 15.6, PLEN.y + 2.4, PLEN.z - 1.4);
    const bell: number[][] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      bell.push([17 + 4 * t, PLEN.y + 6 * t * t, PLEN.z + 2 * t]);
    }
    for (let i = 0; i < 9; i++) {
      const t = i / 8,
        p = bell[i],
        r = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.28, 8, 28), rubber);
      r.position.set(p[0], p[1], p[2]);
      r.quaternion.setFromUnitVectors(V3(0, 0, 1), V3(4, 12 * t, 2).normalize());
      intakeG.add(r);
    }
    tube(intakeG, bell, 1.9, rubber, 30);
    // fuel rail + 4 injectors + feed line
    const rail = mesh(intakeG, cylX(0.55, 26, 16), MS.machined, -0.5, DECK + 7.0, -11.4);
    rail.castShadow = true;
    const injRing = std({ color: 0x1f6b3a, roughness: 0.5 });
    CYL.forEach((c) => {
      const inj = mesh(intakeG, cylY(0.45, 2.4, 16), black, c.x + 1.4, DECK + 6.0, -11.0);
      inj.rotation.x = 0.5;
      const ring = mesh(intakeG, cylY(0.55, 0.4, 16), injRing, c.x + 1.4, DECK + 6.6, -11.3);
      ring.rotation.x = 0.5;
      mesh(intakeG, rbox(1.0, 1.0, 1.4, 0.2, 0.1), black, c.x + 1.4, DECK + 7.0, -10.4);
    });
    tube(intakeG, [[-13.5, DECK + 7.0, -11.4], [-16, DECK + 7.2, -12.4], [-18.5, DECK + 4, -14], [-19.5, 12, -16]], 0.3, MS.machined, 24);
    // injector harness
    tube(intakeG, [[-14, DECK + 7.6, -10.2], [-4, DECK + 7.8, -10.0], [6, DECK + 7.8, -10.0], [15, DECK + 7.2, -10.6]], 0.32, black, 40);
    // MAP sensor on the plenum
    mesh(intakeG, rbox(1.6, 1.2, 2.2, 0.3, 0.15), black, -8, PLEN.y + 3.0, PLEN.z + 0.4);
  }
  reg('intake', intakeG);

  /* ---------- Exhaust (cast-iron 4-into-1 log, heat shield, close-coupled cat) ---------- */
  // The log hugs the head and runs to the flywheel end, so the sectioned cylinders stay in view.
  const LOG = { y: DECK + 1.6, z: 11.0, x0: -12.6, x1: 13.2 };
  const CAT = { x: 14.6, y: 10.2, z: 12.0 };
  CYL.forEach((c) => {
    tube(
      exhaustG,
      [
        [c.x, DECK + 3.9, HEAD_D / 2 + 0.5],
        [c.x + 0.3, DECK + 3.8, 9.6],
        [c.x + 1.6, LOG.y + 0.9, LOG.z + 0.2],
        [c.x + 3.4, LOG.y + 0.1, LOG.z],
      ],
      1.0,
      M.exhaust,
      30,
    );
    mesh(exhaustG, rbox(4.2, 2.8, 0.6, 0.6, 0.2), M.exhaust, c.x, DECK + 3.9, HEAD_D / 2 + 0.95);
  });
  {
    const studs: BoltSpec[] = [];
    CYL.forEach((c) => studs.push([c.x - 1.6, DECK + 5.2, HEAD_D / 2 + 1.25, 'z', 1], [c.x + 1.6, DECK + 2.6, HEAD_D / 2 + 1.25, 'z', 1]));
    bolts(exhaustG, studs, MS.bolt);
    // log: grows towards the outlet end
    const lg = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.15, LOG.x1 - LOG.x0, 32).rotateZ(-Math.PI / 2),
      M.exhaust,
    );
    lg.position.set((LOG.x0 + LOG.x1) / 2, LOG.y, LOG.z);
    exhaustG.add(lg);
    mesh(exhaustG, new THREE.SphereGeometry(1.15, 20, 12), M.exhaust, LOG.x0, LOG.y, LOG.z);
    tube(exhaustG, [[LOG.x1 - 0.6, LOG.y, LOG.z], [CAT.x, LOG.y - 0.6, LOG.z + 0.4], [CAT.x, CAT.y + 4.2, CAT.z]], 1.55, M.exhaust, 24);
    // lambda sensor on the outlet
    const ls = mesh(exhaustG, cylY(0.42, 2.4, 12), MS.machined, CAT.x - 1.6, LOG.y + 1.4, LOG.z + 1.4);
    ls.rotation.x = 0.6;
    mesh(exhaustG, cylY(0.7, 0.55, 6), MS.machined, CAT.x - 1.6, LOG.y + 0.9, LOG.z + 1.1).rotation.x = 0.6;
    tube(exhaustG, [[CAT.x - 1.6, LOG.y + 2.5, LOG.z + 2.1], [CAT.x - 2.6, LOG.y + 4.4, LOG.z + 1.2], [CAT.x - 4.6, LOG.y + 5.6, HEAD_D / 2 + 1.4]], 0.2, black, 20);
    mesh(exhaustG, rbox(1.4, 1.0, 1.0, 0.25, 0.1), black, CAT.x - 5.4, LOG.y + 5.7, HEAD_D / 2 + 1.0);
    // catalytic converter, downpipe
    mesh(exhaustG, new THREE.CylinderGeometry(1.6, 2.5, 1.6, 32), M.cat, CAT.x, CAT.y + 3.6, CAT.z);
    const cat = mesh(exhaustG, cylY(2.6, 6.0, 40), M.cat, CAT.x, CAT.y, CAT.z);
    cat.castShadow = true;
    [-1, 1].forEach((k) => mesh(exhaustG, new THREE.TorusGeometry(2.62, 0.12, 6, 40).rotateX(Math.PI / 2), MS.machined, CAT.x, CAT.y + k * 2.1, CAT.z));
    mesh(exhaustG, new THREE.CylinderGeometry(2.5, 1.25, 1.6, 32), M.cat, CAT.x, CAT.y - 3.6, CAT.z);
    tube(exhaustG, [[CAT.x, CAT.y - 4.2, CAT.z], [CAT.x, -1.5, CAT.z + 0.4], [CAT.x - 0.6, -6.5, CAT.z - 1.4], [CAT.x - 1.2, -9.4, 6.6]], 1.15, M.cat, 30);
    const fl = mesh(exhaustG, cylZ(1.9, 0.5, 24), M.exhaust, CAT.x - 1.2, -9.6, 6.2);
    fl.rotation.x = 0.4;
  }
  // heat shield over the log (hidden in section view)
  const heatShield = new THREE.Group();
  exhaustG.add(heatShield);
  {
    const g = new THREE.CylinderGeometry(2.7, 2.7, LOG.x1 - LOG.x0 + 1, 40, 1, true, -0.5, 2.3).rotateZ(Math.PI / 2);
    const hs = new THREE.Mesh(g, MS.shield);
    hs.position.set((LOG.x0 + LOG.x1) / 2, LOG.y + 0.2, LOG.z - 0.1);
    hs.castShadow = true;
    heatShield.add(hs);
    const b: BoltSpec[] = [];
    [-8, 2, 10].forEach((x) => b.push([x, LOG.y + 2.9, LOG.z - 0.2, 'y', 1]));
    bolts(heatShield, b, MS.bolt);
  }
  reg('exhaust', exhaustG);

  /* ---------- Timing drive (toothed belt) ---------- */
  const spin: { obj: THREE.Object3D; ratio: number }[] = [];
  const grooveMat = std({ color: 0x22262a, metalness: 0.6, roughness: 0.5 });
  function sprocket(parent: THREE.Object3D, p: Pulley, teethN: number, width = 2.4) {
    const g = new THREE.Group();
    g.position.set(TB_X, p.y, p.z);
    g.add(new THREE.Mesh(cylX(p.r - 0.12, width, 48), M.sprocket));
    const t = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.26, 0.24), M.sprocket, teethN),
      d = new THREE.Object3D();
    for (let i = 0; i < teethN; i++) {
      const a = (i / teethN) * Math.PI * 2;
      d.position.set(0, (p.r - 0.05) * Math.cos(a), (p.r - 0.05) * Math.sin(a));
      d.rotation.set(a, 0, 0);
      d.updateMatrix();
      t.setMatrixAt(i, d.matrix);
    }
    g.add(t);
    [-1, 1].forEach((k) => g.add(new THREE.Mesh(cylX(p.r + 0.25, 0.14, 48), M.sprocket).translateX((k * width) / 2)));
    g.add(new THREE.Mesh(cylX(Math.min(1.0, p.r * 0.45), width + 0.6, 20), MS.machined));
    parent.add(g);
    return g;
  }
  {
    // crank sprocket rides on the crank (spins with it)
    const cs = sprocket(crank, TB.crank, 20);
    reg('timing', cs);
    // cam sprocket with lightening holes
    const cam = sprocket(timingG, TB.cam, 40);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2,
        h = new THREE.Mesh(cylX(0.75, 2.5, 20), grooveMat);
      h.position.set(0, 1.95 * Math.cos(a), 1.95 * Math.sin(a));
      cam.add(h);
    }
    cam.add(new THREE.Mesh(cylX(0.6, 0.5, 6), MS.bolt).translateX(-1.45));
    spin.push({ obj: cam, ratio: 0.5 });
    // water pump (driven by the timing belt) + automatic tensioner
    const wp = sprocket(timingG, TB.wp, 23);
    spin.push({ obj: wp, ratio: TB.crank.r / TB.wp.r });
    mesh(timingG, new THREE.CylinderGeometry(2.6, 3.2, 3.0, 32).rotateZ(Math.PI / 2), MS.alu, TB_X + 2.4, TB.wp.y, TB.wp.z);
    const tens = new THREE.Group();
    tens.position.set(TB_X, TB.tens.y, TB.tens.z);
    tens.add(new THREE.Mesh(cylX(TB.tens.r, 2.5, 36), MS.machined));
    tens.add(new THREE.Mesh(cylX(0.7, 2.9, 18), M.sprocket));
    timingG.add(tens);
    spin.push({ obj: tens, ratio: TB.crank.r / TB.tens.r });
    const bp = mesh(timingG, rbox(0.4, 4.4, 2.8, 0.6, 0.15), M.sprocket, TB_X + 1.5, TB.tens.y - 1.2, TB.tens.z - 0.2);
    bp.rotation.x = 0.3;
    // timing marks
    const mk = std({ color: 0xf2f0e6, roughness: 0.5, emissive: 0x222018 });
    mesh(timingG, new THREE.BoxGeometry(0.1, 0.9, 0.24), mk, TB_X - 1.25, TB.cam.y + TB.cam.r - 0.6, 0);
  }
  const tbelt = (() => {
    const { pts, len } = beltPath(Object.values(TB), 420);
    const m = beltMesh(pts, TB_X, 1.1, 0.32, M.tbelt);
    timingG.add(m);
    return { mesh: m, len };
  })();
  reg('timing', timingG);

  // timing cover (plastic), shown only in the assembled / X-ray views
  {
    const { pts } = beltPath(Object.values(TB).map((p) => ({ ...p, r: p.r + 1.0 })), 120);
    const g = extrudeZY(pts, TB_X - 1.7, 3.0, 0.35);
    const cv = new THREE.Mesh(g, MS.plastic);
    cv.castShadow = cv.receiveShadow = true;
    tcoverG.add(cv);
    reg('timing', cv);
    // horizontal stiffening ribs
    for (let i = 0; i < 5; i++) {
      const y = 4 + i * 5.2,
        r = new THREE.Mesh(rbox(0.5, 0.5, 6.4, 0.2, 0.1), MS.plastic);
      r.position.set(TB_X - 1.9, y, -0.4);
      tcoverG.add(r);
    }
  }

  /* ---------- Accessory drive (poly-V): alternator + power-steering pump ---------- */
  function pulley(p: Pulley, nGroove: number, mat: THREE.Material = M.pulley, ratio = AB.crank.r / p.r) {
    const g = new THREE.Group();
    g.position.set(AB_X, p.y, p.z);
    g.add(new THREE.Mesh(cylX(p.r, 1.8, 48), mat));
    for (let i = 0; i < nGroove; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(p.r + 0.02, 0.08, 6, 48).rotateY(Math.PI / 2), grooveMat);
      t.position.x = -0.7 + (1.4 * i) / Math.max(nGroove - 1, 1);
      g.add(t);
    }
    g.add(new THREE.Mesh(cylX(Math.min(1.0, p.r * 0.42), 2.2, 20), MS.machined));
    const nSp = 5;
    for (let i = 0; i < nSp; i++) {
      const a = (i / nSp) * Math.PI * 2,
        h = new THREE.Mesh(cylX(p.r * 0.15, 2.0, 12), grooveMat);
      h.position.set(0, p.r * 0.62 * Math.cos(a), p.r * 0.62 * Math.sin(a));
      g.add(h);
    }
    accG.add(g);
    spin.push({ obj: g, ratio });
    return g;
  }
  {
    const cp = pulley(AB.crank, 4, black);
    cp.add(new THREE.Mesh(cylX(AB.crank.r - 0.2, 0.7, 48), rubber).translateX(1.25));
    cp.add(new THREE.Mesh(cylY(0.5, 0.8, 6), MS.bolt).rotateZ(Math.PI / 2).translateY(1.2));
    pulley(AB.alt, 4);
    pulley(AB.ps, 4);
    pulley(AB.tens, 1, MS.machined);
    const arm = mesh(accG, rbox(0.5, 4.2, 1.6, 0.4, 0.15), M.acc, AB_X + 1.2, AB.tens.y - 1.7, AB.tens.z - 0.6);
    arm.rotation.x = 0.35;
  }
  // alternator
  {
    const a = AB.alt;
    const b = mesh(accG, cylX(3.5, 5.6, 40), M.acc, AB_X + 4.0, a.y, a.z);
    b.castShadow = true;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2,
        f = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.22, 0.6), MS.ironDark);
      f.position.set(AB_X + 3.8, a.y + 3.55 * Math.cos(ang), a.z + 3.55 * Math.sin(ang));
      f.rotation.x = ang;
      accG.add(f);
    }
    mesh(accG, cylX(3.0, 0.9, 32), black, AB_X + 7.2, a.y, a.z);
    mesh(accG, rbox(1.4, 1.6, 1.4, 0.3, 0.15), black, AB_X + 8.6, a.y + 1.6, a.z - 1.6);
    mesh(accG, rbox(4.5, 1.6, 2.4, 0.4, 0.2), MS.aluDark, AB_X + 5, a.y - 3.6, a.z + 2.2);
    tube(accG, [[AB_X + 8.8, a.y + 2.2, a.z - 2], [AB_X + 11, a.y + 3.6, a.z - 3.4], [-6, a.y + 3.2, -12.4]], 0.32, rubber, 24);
  }
  // power-steering pump + reservoir line
  {
    const a = AB.ps;
    mesh(accG, cylX(2.6, 5.0, 36), M.acc, AB_X + 3.8, a.y, a.z).castShadow = true;
    mesh(accG, rbox(3.2, 4.4, 4.4, 0.8, 0.3), M.acc, AB_X + 7.4, a.y, a.z);
    tube(accG, [[AB_X + 7.4, a.y + 2.2, a.z], [AB_X + 7.6, a.y + 5.4, a.z - 1.5], [AB_X + 9, a.y + 7, a.z - 6]], 0.55, rubber, 24);
    tube(accG, [[AB_X + 8.6, a.y - 1.2, a.z - 2.2], [AB_X + 9.6, a.y - 3, a.z - 6], [AB_X + 12, a.y - 5, a.z - 9]], 0.32, MS.machined, 24);
  }
  accG.add(beltMesh(beltPath(Object.values(AB), 360).pts, AB_X, 0.85, 0.3, M.abelt));
  reg('belt', accG);

  /* ---------- Cooling: thermostat housing + hoses; starter motor ---------- */
  {
    const th = mesh(headG, rbox(3.6, 3.6, 3.6, 0.6, 0.25), MS.aluDark, BLOCK_X + 1.6, DECK + 4.6, -3.0);
    th.castShadow = true;
    mesh(headG, cylX(1.0, 2.2, 20), MS.aluDark, BLOCK_X + 4.0, DECK + 5.0, -3.0);
    mesh(headG, cylZ(0.7, 1.0, 16), black, BLOCK_X + 1.6, DECK + 4.6, -0.8); // temperature sender
    const hose = (pts: number[][], r: number) => {
      tube(headG, pts, r, rubber, 30);
      const p = pts[0],
        q = pts[1],
        d = V3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
      const cl = new THREE.Mesh(new THREE.TorusGeometry(r + 0.08, 0.13, 6, 20), MS.machined);
      cl.position.set(p[0], p[1], p[2]).addScaledVector(d, 0.5);
      cl.quaternion.setFromUnitVectors(V3(0, 0, 1), d);
      headG.add(cl);
    };
    hose([[BLOCK_X + 4.8, DECK + 5.0, -3.0], [BLOCK_X + 7.0, DECK + 5.6, 0], [BLOCK_X + 7.5, DECK + 3.5, 6], [BLOCK_X + 7.4, DECK - 2, 11]], 0.95);
    hose([[BLOCK_X + 3.2, DECK + 4.0, -4.6], [BLOCK_X + 4.4, DECK + 2.4, -8.5], [BLOCK_X + 4.4, DECK - 1, -12.6]], 0.55);
  }
  {
    const sm = mesh(blockG, cylX(2.1, 7.4, 32), M.acc, BLOCK_X - 3.0, -1.4, -(BLK_D / 2 + 3.4));
    sm.castShadow = true;
    mesh(blockG, cylX(1.15, 4.6, 24), MS.machined, BLOCK_X - 3.8, 1.6, -(BLK_D / 2 + 3.6));
    mesh(blockG, cylX(1.6, 1.8, 24), MS.ironDark, BLOCK_X + 0.6, -1.4, -(BLK_D / 2 + 3.4));
    mesh(blockG, rbox(1.0, 3.6, 3.0, 0.3, 0.15), MS.ironDark, BLOCK_X - 0.2, -0.4, -(BLK_D / 2 + 1.8));
  }
  reg('oil', sumpG);

  /* ---------- Floor ---------- */
  {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.42 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = FLOOR_Y;
    sh.receiveShadow = true;
    root.add(sh);
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshBasicMaterial({ map: floorMap, transparent: true, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = FLOOR_Y - 0.05;
    root.add(disc);
    const pts: number[] = [];
    const RR = 40;
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2,
        b = ((i + 1) / 160) * Math.PI * 2;
      pts.push(RR * Math.cos(a), FLOOR_Y, RR * Math.sin(a), RR * Math.cos(b), FLOOR_Y, RR * Math.sin(b));
    }
    for (let d = 0; d < 360; d += 5) {
      const a = d * RAD,
        l = d % 30 === 0 ? 2.2 : 0.9;
      pts.push(RR * Math.cos(a), FLOOR_Y, RR * Math.sin(a), (RR - l) * Math.cos(a), FLOOR_Y, (RR - l) * Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c343b })));
  }

  // shadows on everything opaque
  root.traverse((m) => {
    const ms = m as THREE.Mesh;
    if (ms.isMesh && (ms.material as THREE.Material).blending === THREE.NormalBlending && !(ms.material as THREE.Material).transparent) {
      ms.castShadow = true;
      ms.receiveShadow = true;
    }
  });

  /* ---------- Simulation ---------- */
  const sim: SanderoSim = { theta: 0, rpm: 2500, explode: 0, fire: null, cyl };
  const C_HOT = new THREE.Color(0xff6a1e),
    C_EX = new THREE.Color(0x3a332c),
    C_IN = new THREE.Color(0x1d4a52),
    C_CO = new THREE.Color(0x2b3166);
  const P = V3(0, 0, 0),
    Q = V3(0, 0, 0),
    dir = V3(0, 0, 0);
  const HEAD_EX = 9,
    COVER_EX = 16;

  function simulate() {
    const th = sim.theta,
      thr = th * RAD,
      ex = sim.explode;
    crank.rotation.x = -(th % 360) * RAD;
    spin.forEach((s) => {
      s.obj.rotation.x = -thr * s.ratio;
    });
    camShaft.rotation.x = -thr / 2;
    M.tbelt.map!.offset.x = ((thr * TB.crank.r) / tbelt.len) * 80 % 1;
    // explode
    headG.position.y = ex * HEAD_EX;
    coverG.position.y = ex * COVER_EX;
    intakeG.position.set(0, ex * HEAD_EX, -ex * 9);
    exhaustG.position.set(0, ex * HEAD_EX, ex * 9);
    sumpG.position.y = -ex * 5;
    timingG.position.x = -ex * 7;
    tcoverG.position.x = -ex * 12;
    accG.position.x = -ex * 14;
    fly.position.x = ex * 7;

    let fire: CylState | null = null;
    for (const c of cyl) {
      const a = (c.phi - th) * RAD,
        py = R * Math.cos(a),
        pz = R * Math.sin(a),
        d = py + Math.sqrt(L * L - pz * pz);
      c.piston.position.set(c.x, d, 0);
      P.set(c.x, py, pz);
      Q.set(c.x, d, 0);
      c.rod.position.copy(P).add(Q).multiplyScalar(0.5);
      dir.copy(Q).sub(P).normalize();
      c.rod.quaternion.setFromUnitVectors(UP, dir);
      c.rodAng = Math.asin(pz / L) / RAD;
      c.crown = d + CH;
      const deck = DECK + ex * HEAD_EX,
        len = Math.max(deck - c.crown, 0.01);
      c.glow.scale.y = len;
      c.glow.position.set(c.x, c.crown + len / 2, 0);
      const p = (((th - c.T) % 720) + 720) % 720;
      c.p = p;
      const gm = c.glow.material;
      if (p < 180) {
        gm.color.copy(C_HOT);
        gm.opacity = 0.9 * Math.pow(1 - p / 180, 1.4) + 0.05;
        fire = c;
      } else if (p < 360) {
        gm.color.copy(C_EX);
        gm.opacity = 0.6;
      } else if (p < 540) {
        gm.color.copy(C_IN);
        gm.opacity = 0.6;
      } else {
        gm.color.copy(C_CO);
        gm.opacity = 0.4 + (0.5 * (p - 540)) / 180;
      }
      c.liftI = lift(p, IN_OPEN, IN_CLOSE);
      c.liftE = lift(p, EX_OPEN, EX_CLOSE);
      c.valves.forEach((v, i) => {
        const s = v.userData.s as number,
          h = (s < 0 ? c.liftI : c.liftE) * MAX_LIFT;
        v.position.copy(v.userData.base).addScaledVector(axis(s), -h);
        c.springs[i].scale.y = (SPRING_L - h) / SPRING_L;
      });
      c.rockers.forEach((r, i) => {
        const s = i ? 1 : -1,
          h = (s < 0 ? c.liftI : c.liftE) * MAX_LIFT;
        r.rotation.x = (s * h) / PAD_LEN;
      });
      c.lobes.forEach((pv) => {
        pv.rotation.x = pv.userData.contact - ((p - pv.userData.peak) / 2) * RAD;
      });
      const sp = p >= 720 - SPARK_ADV ? Math.sin(((p - (720 - SPARK_ADV)) / SPARK_ADV) * Math.PI) : 0;
      c.spark.material.opacity = sp;
      c.spark.scale.setScalar(0.6 + sp * 0.8);
    }
    const f = fire as CylState | null;
    if (f) {
      fireLight.intensity = 3.2 * PI * FIRE_GAIN * Math.pow(1 - f.p / 180, 2);
      fireLight.position.set(f.x, DECK + ex * HEAD_EX - 1.5, 2);
    } else fireLight.intensity = 0;
    sim.fire = f;
  }

  simulate();

  return {
    root,
    pickables,
    parts: makeParts(sim),
    homeView: HOME_VIEW,
    modes: [
      { id: 'cut', label: 'Secțiune', showsSection: true, revealsInternals: true },
      { id: 'solid', label: 'Asamblat' },
      { id: 'xray', label: 'X-ray', revealsInternals: true },
    ],
    defaultMode: 'cut',
    setMode(id) {
      section.apply(id as SectionMode);
      tcoverG.visible = id !== 'cut';
      heatShield.visible = id !== 'cut';
      // the rail would float over the cut cover and hide the cam; the coil pencils stay
      coilRail.visible = id !== 'cut';
    },
    highlight(k) {
      Object.entries(PART_MATS).forEach(([p, ms]) => ms.forEach((m) => m.emissive.setHex(p === k ? 0x110c04 : 0x000000)));
    },
    acceptHit(h, mode) {
      if (mode !== 'cut') return true;
      const p = h.point;
      const clipped = !!((h.object as THREE.Mesh).material as THREE.Material).clippingPlanes;
      return !(p.z > 0 && p.z < CUT_Z && Math.abs(p.x) < CUT_X) || !clipped;
    },
    tags: cyl.map((c) => ({
      id: String(c.n),
      text: String(c.n),
      position: (out) => out.set(c.x, 3.2, BLK_D / 2 + 0.9),
      active: () => sim.fire === c,
    })),
    update({ dt, playing, explode, params }) {
      sim.rpm = params.rpm;
      sim.explode = explode;
      if (playing) sim.theta = (sim.theta + dt * params.rpm * 6 * SLOWS[params.slowIdx].f) % 1440;
      simulate();
    },
    dispose() {
      disposeTree(root);
      envRT.dispose();
      if (scene.environment === envRT.texture) scene.environment = prevEnv;
      scene.fog = prevFog;
    },
    sim,
  };
}
