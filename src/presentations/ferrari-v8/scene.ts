/*
 * Ferrari F154 twin-turbo V8 cutaway. Procedural geometry, real slider-crank kinematics for
 * both banks, and a switchable crankshaft (flat-plane as built, cross-plane for comparison).
 */
import * as THREE from 'three';
import type { BuildContext, PresentationInstance } from '../../framework/types';
import { SectionView, type SectionMode } from '../../framework/three/section';
import { mergeStatic } from '../../framework/three/merge';
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
  BANK_DEG,
  BELT_X,
  BORE,
  CH,
  CYL,
  DECK,
  EX_CLOSE,
  EX_OPEN,
  IN_CLOSE,
  IN_OPEN,
  L,
  OFF,
  PITCH,
  PUL,
  R,
  SLOWS,
  SPARK_ADV,
  firingOffsets,
  lift,
  pinPhases,
  type CrankType,
  type CylDef,
  type PulleyKey,
} from './engine';
import { HOME_VIEW, makeParts } from './content';
import {
  carbonTex,
  compressorWheel,
  finTex,
  lobeGeo,
  perfTex,
  pistonGeo,
  rodGeo,
  springGeo,
  webGeo,
} from './shapes';
import { beltGeo } from './belt';

export interface FerrariV8Params {
  rpm: number;
  slowIdx: number;
  crank: CrankType;
}

export interface CylState extends CylDef {
  piston: THREE.Group;
  rod: THREE.Group;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  spark: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** intake ×2, exhaust ×2 */
  valves: THREE.Group[];
  lobes: THREE.Group[];
  /** firing offset in the 720° cycle and crankpin phase, for the active crank */
  T: number;
  phi: number;
  /** cycle angle 0..720 */
  p: number;
  rodAng: number;
  crown: number;
  liftI: number;
  liftE: number;
}

export interface FerrariV8Sim {
  theta: number;
  rpm: number;
  explode: number;
  crank: CrankType;
  fire: CylState | null;
  cyl: CylState[];
}

export type FerrariV8Instance = PresentationInstance<FerrariV8Params> & { sim: FerrariV8Sim };

const PI = Math.PI;
const BANKS = [1, -1] as const;
/** Bank frame: rotation about x that turns local +z into the bank's cylinder axis. */
const RHO: Record<number, number> = { 1: (BANK_DEG - 90) * RAD, [-1]: (-BANK_DEG - 90) * RAD };
/** Local +y points into the V on bank A and out of it on bank B; multiply by this for "inward". */
const IN: Record<number, number> = { 1: 1, [-1]: -1 };
// section cut extent along the crank (front / rear); the rear stops short of the chain covers
const XF = 21.6,
  XR = 20.2;

/** Turbo layout (world): turbine + compressor on a shaft along x, one per bank, low and outboard. */
export const TURBO = { turbX: 17, compX: 11, y: -0.5, z: 26 };

/** Bank-local point → world (plus the bank's explode offset along its axis). */
export function bankPoint(s: 1 | -1, lx: number, ly: number, lz: number, out: THREE.Vector3, explode = 0) {
  const r = RHO[s],
    c = Math.cos(r),
    n = Math.sin(r),
    z = lz + explode;
  return out.set(lx, ly * c - z * n, ly * n + z * c);
}

export function buildFerrariV8({ gl, scene, quality = 'high' }: BuildContext): FerrariV8Instance {
  const low = quality === 'low';
  const root = new THREE.Group();
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
  const SEG = low ? 0.6 : 1; // curve segment scale
  const seg = (n: number) => Math.max(6, Math.round(n * SEG));

  /* ---------- Procedural textures ---------- */
  const castBump = canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = '#808080';
      x.fillRect(0, 0, w, h);
      fillNoise(x, w, h, 48, 70);
      x.globalAlpha = 0.45;
      fillNoise(x, w, h, 256, 60);
      x.globalAlpha = 1;
    },
    [0.35, 0.35],
  );
  const wrinkleBump = canvasTex(256, 256, (x, w, h) => fillNoise(x, w, h, 256, 115), [0.22, 0.22]);
  const brushed = canvasTex(
    256,
    64,
    (x, w, h) => {
      x.fillStyle = '#808080';
      x.fillRect(0, 0, w, h);
      for (let j = 0; j < h; j++) {
        x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.25})`;
        x.fillRect(0, j, w, 1);
      }
    },
    [1, 1],
  );
  const headerMap = canvasTex(
    256,
    8,
    (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#4a3466');
      g.addColorStop(0.1, '#62508a');
      g.addColorStop(0.24, '#8f6a3a');
      g.addColorStop(0.42, '#b39a70');
      g.addColorStop(0.7, '#b9bcbf');
      g.addColorStop(1, '#c4c7ca');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    },
    [1, 1],
  );
  const beltMap = canvasTex(
    64,
    16,
    (x, w, h) => {
      x.fillStyle = '#16171a';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#23252a';
      for (let i = 0; i < w; i += 8) x.fillRect(i, 0, 3, h);
    },
    [60, 1],
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
  scene.fog = new THREE.Fog(0x121518, 140, 300);

  /* ---------- Lights ---------- */
  root.add(new THREE.HemisphereLight(0xc4d4e0, 0x1b1612, 0.2 * PI));
  const key = new THREE.DirectionalLight(0xfff8f0, 1.05 * PI);
  key.position.set(-30, 70, 45);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 10, far: 220 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.04;
  root.add(key);
  const rimWarm = new THREE.DirectionalLight(0xffc4a0, 0.6 * PI);
  rimWarm.position.set(50, 10, -50);
  root.add(rimWarm);
  const rimCool = new THREE.DirectionalLight(0x9cc4ff, 0.4 * PI);
  rimCool.position.set(-55, 5, -30);
  root.add(rimCool);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25 * PI);
  fill.position.set(10, -20, 60);
  root.add(fill);
  const FIRE_GAIN = 60;
  const fireLight = new THREE.PointLight(0xff7a2e, 0, 30, 2);
  root.add(fireLight);

  /* ---------- Section planes ---------- */
  // cut region = outer half of bank A (below its cylinder-axis plane: y < z) AND z > 0 AND -XF < x < XR
  const sv = new SectionView([
    new THREE.Plane(V3(0, 1, -1).normalize(), 0),
    new THREE.Plane(V3(0, 0, -1), 0),
    new THREE.Plane(V3(-1, 0, 0), -XF),
    new THREE.Plane(V3(1, 0, 0), -XR),
  ]);
  const housing = sv.housing.bind(sv);
  // gearbox: its own cut, the upper +z quarter of the bellhousing, to show the clutch pack
  const svBox = new SectionView([
    new THREE.Plane(V3(0, 0, -1), 0),
    new THREE.Plane(V3(0, -1, 0), -1),
    new THREE.Plane(V3(1, 0, 0), -33.5),
    new THREE.Plane(V3(-1, 0, 0), 22),
  ]);
  const inBoxCut = (p: THREE.Vector3) => p.z > 0 && p.y > -1 && p.x < 33.5 && p.x > 22;
  const inCut = (p: THREE.Vector3) => p.y < p.z && p.z > 0 && p.x > -XF && p.x < XR;

  /* ---------- Materials ---------- */
  const st = <M extends THREE.Material>(m: M) => sv.material(m);
  const MS = {
    cast: st(std({ color: 0x80878c, metalness: 0.55, roughness: 0.58, bumpMap: castBump, bumpScale: 0.012 })),
    castDark: st(std({ color: 0x5b6267, metalness: 0.55, roughness: 0.6, bumpMap: castBump, bumpScale: 0.012 })),
    // Ferrari red crinkle-finish cam covers
    red: st(
      phys({
        color: 0xb3150f,
        metalness: 0.15,
        roughness: 0.6,
        bumpMap: wrinkleBump,
        bumpScale: 0.007,
        clearcoat: 0.35,
        clearcoatRoughness: 0.45,
      }),
    ),
    wrinkle: st(std({ color: 0x141518, metalness: 0.15, roughness: 0.88, bumpMap: wrinkleBump, bumpScale: 0.006 })),
    plenum: st(std({ color: 0x3a3f44, metalness: 0.6, roughness: 0.42, bumpMap: castBump, bumpScale: 0.008 })),
    carbon: st(
      phys({ color: 0xffffff, map: carbonTex(), metalness: 0.25, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.08 }),
    ),
    letters: st(
      std({
        color: 0xf2f2f0,
        metalness: 0.55,
        roughness: 0.22,
        alphaMap: canvasTex(1024, 72, (x, w, h) => {
          x.fillStyle = '#000';
          x.fillRect(0, 0, w, h);
          x.fillStyle = '#fff';
          x.font = 'italic 700 62px Arial, Helvetica, sans-serif';
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          (x as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '28px';
          x.fillText('FERRARI', w / 2, h / 2 + 2);
        }),
        alphaTest: 0.5,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    ),
    sump: st(std({ color: 0x6a7176, metalness: 0.6, roughness: 0.5, bumpMap: castBump, bumpScale: 0.01 })),
    machined: st(std({ color: 0xcfd3d6, metalness: 0.85, roughness: 0.28 })),
    black: st(std({ color: 0x202225, metalness: 0.4, roughness: 0.5 })),
    rubber: st(std({ color: 0x141516, metalness: 0, roughness: 0.85 })),
    bolt: st(std({ color: 0x9da3a8, metalness: 0.9, roughness: 0.32 })),
    bore: st(std({ color: 0xa2a7ab, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide })),
    gasket: st(std({ color: 0x3a3d40, metalness: 0.6, roughness: 0.5 })),
  };
  const M = {
    crank: std({ color: 0xbfc6cc, metalness: 0.92, roughness: 0.22 }),
    rod: std({ color: 0x9aa3ab, metalness: 0.9, roughness: 0.28, bumpMap: brushed, bumpScale: 0.004 }),
    piston: std({ color: 0xd9dcde, metalness: 0.7, roughness: 0.3 }),
    skirt: std({ color: 0x3b3f44, metalness: 0.3, roughness: 0.55 }), // low-friction coating
    valve: std({ color: 0xaab0b5, metalness: 0.85, roughness: 0.3 }),
    cam: std({ color: 0x8b939a, metalness: 0.88, roughness: 0.28 }),
    plug: std({ color: 0xf0ede6, metalness: 0, roughness: 0.35 }),
    plugHex: std({ color: 0xa8adb2, metalness: 0.9, roughness: 0.3 }),
    coil: std({ color: 0x1e2024, metalness: 0.3, roughness: 0.38 }),
    fly: std({ color: 0x7a8288, metalness: 0.85, roughness: 0.34 }),
    exhaust: std({ color: 0xffffff, map: headerMap, metalness: 0.85, roughness: 0.3 }),
    cat: std({ color: 0xb6babd, metalness: 0.8, roughness: 0.36, bumpMap: brushed, bumpScale: 0.003 }),
    shield: std({ color: 0xffffff, map: perfTex(), metalness: 0.85, roughness: 0.4 }),
    turbine: std({ color: 0x5d5752, metalness: 0.7, roughness: 0.52, bumpMap: castBump, bumpScale: 0.014 }),
    compressor: std({ color: 0xc3c7ca, metalness: 0.8, roughness: 0.32, bumpMap: castBump, bumpScale: 0.006 }),
    wheel: std({ color: 0xd6d9dc, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }),
    boost: std({ color: 0x2b2e33, metalness: 0.5, roughness: 0.42 }),
    silicone: std({ color: 0xa0160f, metalness: 0, roughness: 0.6 }),
    core: std({ color: 0xffffff, map: finTex(), metalness: 0.7, roughness: 0.45 }),
    belt: std({ color: 0xffffff, map: beltMap, metalness: 0.1, roughness: 0.75, side: THREE.DoubleSide }),
    pulley: std({ color: 0x3c4146, metalness: 0.75, roughness: 0.38 }),
    acc: std({ color: 0x8f969b, metalness: 0.7, roughness: 0.45, bumpMap: castBump, bumpScale: 0.01 }),
    plastic: std({ color: 0xe8e6df, metalness: 0, roughness: 0.5, transparent: true, opacity: 0.85 }),
    yellow: std({ color: 0xe2b52a, metalness: 0.2, roughness: 0.45 }),
  };
  const PART_MATS: Record<string, THREE.MeshStandardMaterial[]> = {
    crank: [M.crank],
    rod: [M.rod],
    piston: [M.piston, M.skirt],
    valve: [M.valve],
    cam: [M.cam],
    plug: [M.plug, M.plugHex, M.coil],
    fly: [M.fly],
    exhaust: [M.exhaust, M.cat, M.shield],
    turbo: [M.turbine, M.compressor, M.boost],
    intercooler: [M.core, M.silicone],
    intake: [MS.plenum, MS.carbon],
    sump: [MS.sump],
    gearbox: [] as THREE.MeshStandardMaterial[],
    belt: [M.belt, M.pulley, M.acc],
  };

  /* ---------- Picking registry ---------- */
  const pickables: THREE.Object3D[] = [];
  function reg<T extends THREE.Object3D>(part: string, obj: T): T {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.part && !o.userData.aid) {
        o.userData.part = part;
        pickables.push(o);
      }
    });
    return obj;
  }
  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* ---------- Groups ---------- */
  // axisG: fixed bank frames (pistons, glow); blockG / bankG: same frames, exploded along the axis
  const axisG: Record<number, THREE.Group> = {},
    blockG: Record<number, THREE.Group> = {},
    bankG: Record<number, THREE.Group> = {},
    exhaustG: Record<number, THREE.Group> = {},
    coolerG: Record<number, THREE.Group> = {};
  BANKS.forEach((s) => {
    [axisG, blockG, bankG].forEach((rec) => {
      const g = new THREE.Group();
      g.rotation.x = RHO[s];
      rec[s] = g;
      root.add(g);
    });
    exhaustG[s] = new THREE.Group();
    coolerG[s] = new THREE.Group();
    root.add(exhaustG[s], coolerG[s]);
  });
  const caseG = new THREE.Group(),
    sumpG = new THREE.Group(),
    intakeG = new THREE.Group(),
    flyG = new THREE.Group(),
    frontG = new THREE.Group();
  root.add(caseG, sumpG, intakeG, flyG, frontG);
  const bp = (s: 1 | -1, x: number, y: number, z: number) => bankPoint(s, x, y, z, V3(0, 0, 0)).toArray();

  /* ---------- Crankcase (bedplate) ---------- */
  housing(caseG, rbox(45, 12.6, 17.6, 2.4, 0.6), MS.cast, 0, -1.8, 0);
  housing(caseG, new THREE.BoxGeometry(46, 0.7, 18.6), MS.castDark, 0, -7.2, 0); // bedplate split line
  [-21.4, -10.6, 0, 10.6, 21.4].forEach((x) => housing(caseG, cylX(2.9, 1.4, 24), MS.cast, x, 0, 0, false));
  // side ribs on the bedplate
  for (let i = 0; i < 9; i++)
    [1, -1].forEach((s) =>
      housing(caseG, new THREE.BoxGeometry(0.5, 5, 0.6), MS.cast, -19.2 + i * 4.8, -4.6, s * 8.9, false),
    );
  {
    const l1: BoltSpec[] = [];
    for (let i = 0; i < 12; i++) {
      const x = -20.5 + i * 3.73;
      l1.push([x, -7.6, 8.4, 'y', -1], [x, -7.6, -8.4, 'y', -1]);
    }
    bolts(caseG, l1, MS.bolt);
  }
  // front cover: carries the water pump and the accessory drive
  housing(caseG, rbox(1.8, 26, 21, 3, 0.6), MS.castDark, -23.4, 5.5, 0);
  {
    const bl: BoltSpec[] = [];
    for (let i = 0; i < 7; i++) bl.push([-24.3, -6 + i * 3.6, 9.6, 'x', -1], [-24.3, -6 + i * 3.6, -9.6, 'x', -1]);
    bolts(caseG, bl, MS.bolt);
  }
  // starter motor (bank B side, by the flywheel)
  {
    mesh(caseG, cylX(2.0, 7, seg(28)), M.acc, 17.5, -6.4, -10.6);
    mesh(caseG, cylX(1.05, 4, seg(20)), MS.machined, 16.8, -4.0, -11.4);
    mesh(caseG, cylX(1.3, 1.6, seg(20)), MS.castDark, 21.6, -6.4, -10.6);
  }
  // oil filter (bank B side, front)
  {
    const f = mesh(caseG, cylY(1.9, 4.4, seg(32)), std({ color: 0x9da2a6, metalness: 0.6, roughness: 0.38 }), -16, -7.6, -11.6);
    f.rotation.x = -0.5;
    const base = mesh(caseG, cylY(1.4, 1.2, seg(24)), MS.cast, -16, -5.6, -10.6);
    base.rotation.x = -0.5;
  }

  /* ---------- Dry sump ---------- */
  housing(sumpG, rbox(40, 2.8, 14.4, 1, 0.35), MS.sump, 0, -9.0, 0);
  for (let i = 0; i < 10; i++) housing(sumpG, new THREE.BoxGeometry(0.3, 1.0, 12), MS.sump, -16 + i * 3.6, -10.8, 0, false);
  {
    // pressure + scavenge pump stack along bank B, external tank on the same side
    mesh(sumpG, cylX(1.8, 22, seg(28)), MS.sump, -2, -8.2, -9.6);
    for (let i = 0; i < 5; i++) mesh(sumpG, cylX(2.05, 0.4, seg(28)), MS.castDark, -12 + i * 5, -8.2, -9.6);
    mesh(sumpG, cylY(3.2, 9.5, seg(32)), MS.sump, -9, -4.5, -16.2);
    mesh(sumpG, cylY(3.35, 0.5, seg(32)), MS.castDark, -9, 0.1, -16.2);
    mesh(sumpG, cylY(1.0, 1, seg(24)), M.yellow, -9, 0.8, -16.2);
    tube(sumpG, [[-13, -8.2, -9.6], [-14.5, -8.6, -12], [-12, -8.2, -15], [-9, -8.6, -16.2]], 0.55, MS.rubber, seg(24));
    tube(sumpG, [[-6.4, -3, -15.4], [-4, -4.5, -12.5], [-2, -6.3, -9.8]], 0.5, MS.rubber, seg(20));
  }
  reg('sump', sumpG);

  /* ---------- Crankshafts (flat-plane and cross-plane, one visible) ---------- */
  const pinX = (j: number) => (j - 1.5) * PITCH;
  const aidMat = new THREE.MeshBasicMaterial({
    color: 0x49c6ff,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const aidLine = new THREE.LineBasicMaterial({ color: 0x8fdcff });
  const aids: THREE.Object3D[] = [];
  function buildCrank(type: CrankType) {
    const g = new THREE.Group(),
      ph = pinPhases(type).map((d) => d * RAD),
      heavy = type === 'cross';
    ph.forEach((a, j) => {
      const x = pinX(j);
      mesh(g, cylX(1.75, 2 * OFF + 2.6, seg(28)), M.crank, x, R * Math.cos(a), R * Math.sin(a));
      // oil hole on the pin
      const oh = mesh(g, cylX(0.28, 0.1, 10), M.coil, x, (R + 1.76) * Math.cos(a), (R + 1.76) * Math.sin(a));
      oh.rotation.x = a;
      oh.rotation.z = PI / 2;
      [-2.4, 2.4].forEach((dx) =>
        mesh(g, webGeo(a, R, 2.55, heavy ? 6.5 : 5.5, heavy ? 1.35 : 1.0, 1.15), M.crank, x + dx, 0, 0),
      );
    });
    const mains: [number, number][] = [[-24.2, pinX(0) - 2.95]];
    for (let j = 0; j < 3; j++) mains.push([pinX(j) + 2.95, pinX(j + 1) - 2.95]);
    mains.push([pinX(3) + 2.95, 23]);
    mains.forEach(([x0, x1]) => mesh(g, cylX(2.2, x1 - x0, seg(32)), M.crank, (x0 + x1) / 2, 0, 0));
    mesh(g, cylX(1.5, -24.2 - (BELT_X - 1), seg(24)), M.crank, (-24.2 + BELT_X - 1) / 2, 0, 0); // nose
    mesh(g, cylX(3.6, 0.9, seg(36)), M.crank, 22.9, 0, 0); // flywheel flange
    // translucent plane(s) through the crankpins, shown while the crank is selected
    const planes = [...new Set(ph.map((a) => Math.round(((a / RAD) % 180) * 10) / 10))];
    planes.forEach((d) => {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(50, 2 * R + 7), aidMat);
      pl.rotation.x = d * RAD; // PlaneGeometry spans x and local y; turn local y onto the pin direction
      pl.userData.aid = true;
      pl.renderOrder = 5;
      pl.visible = false;
      g.add(pl);
      aids.push(pl);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(pl.geometry), aidLine);
      edge.rotation.x = d * RAD;
      edge.userData.aid = true;
      edge.visible = false;
      g.add(edge);
      aids.push(edge);
    });
    root.add(g);
    reg('crank', g);
    return g;
  }
  const cranks: Record<CrankType, THREE.Group> = { flat: buildCrank('flat'), cross: buildCrank('cross') };

  /* ---------- Flywheel (turns with the crank) ---------- */
  {
    mesh(flyG, cylX(11, 1.6, seg(72)), M.fly, 24, 0, 0);
    mesh(flyG, cylX(8.6, 0.6, seg(64)), std({ color: 0x9aa1a6, metalness: 0.9, roughness: 0.22 }), 24.9, 0, 0);
    const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.5, 0.75), M.fly, 120),
      dm = new THREE.Object3D();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * PI * 2;
      dm.position.set(24, 11.3 * Math.cos(a), 11.3 * Math.sin(a));
      dm.rotation.set(a, 0, 0);
      dm.updateMatrix();
      teeth.setMatrixAt(i, dm.matrix);
    }
    flyG.add(teeth);
    mesh(flyG, cylX(3.6, 1.6, seg(32)), M.fly, 25.4, 0, 0);
    // lightening holes
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + PI / 6;
      mesh(flyG, cylX(1.2, 1.7, 20), M.coil, 24, 6.2 * Math.cos(a), 6.2 * Math.sin(a));
    }
    const bl: BoltSpec[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      bl.push([25.2, 2.6 * Math.cos(a), 2.6 * Math.sin(a), 'x', 1]);
    }
    bolts(flyG, bl, M.fly);
    const mk = mesh(
      flyG,
      new THREE.BoxGeometry(0.2, 1.6, 0.6),
      std({ color: 0xd9a441, metalness: 0.3, roughness: 0.4, emissive: 0x2a1d05 }),
      24.85,
      9.6,
      0,
    );
    mk.castShadow = false;
  }
  reg('fly', flyG);


  /* ---------- 7-speed dual-clutch transaxle (Getrag 7DCL750 on the 488) ---------- */
  const boxG = new THREE.Group();
  root.add(boxG);
  {
    const gb = <M extends THREE.Material>(m: M) => {
      m.clipIntersection = true;
      svBox.material(m);
      return m;
    };
    const case1 = gb(std({ color: 0x6d7479, metalness: 0.55, roughness: 0.55, bumpMap: castBump, bumpScale: 0.012 }));
    const case2 = gb(std({ color: 0x4f565b, metalness: 0.55, roughness: 0.6, bumpMap: castBump, bumpScale: 0.012 }));
    PART_MATS.gearbox.push(case1, case2);
    const hb = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cut = true) => {
      const m = mesh(boxG, geo, mat, x, y, z);
      if (cut) svBox.addBack(boxG, m);
      return m;
    };
    // bellhousing: turned profile along x, open towards the engine
    const prof = [
      [12.9, 0],
      [13.1, 0.6],
      [12.8, 1.2],
      [12.4, 4],
      [11.6, 7],
      [10.6, 9.6],
      [10.2, 10.4],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    hb(new THREE.LatheGeometry(prof, seg(56)).rotateZ(-PI / 2), case1, 22.8, 0, 0);
    hb(cylX(10.4, 0.5, seg(56)), case1, 33.3, 0, 0);
    // flange bolts to the block
    const fb: BoltSpec[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * PI * 2;
      fb.push([23.6, 12.6 * Math.cos(a), 12.6 * Math.sin(a), 'x', 1]);
    }
    bolts(boxG, fb, MS.bolt);
    // main case, differential bulge, rear cover
    hb(rbox(19, 15, 16, 3, 0.8), case1, 43, -1.5, 0);
    hb(cylZ(6.2, 21, seg(40)), case1, 36.6, -4.4, 0);
    hb(rbox(1.6, 14, 15, 2.6, 0.5), case2, 53.2, -1.5, 0);
    for (let i = 0; i < 6; i++) hb(new THREE.BoxGeometry(0.5, 13, 16.6), case2, 36 + i * 3.2, -1.5, 0, false);
    const rb: BoltSpec[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      rb.push([54.1, -1.5 + 6 * Math.cos(a), 6.6 * Math.sin(a), 'x', 1]);
    }
    bolts(boxG, rb, MS.bolt);
    // hydraulic shift / clutch control unit on top, oil cooler + lines
    hb(rbox(9, 3.4, 7, 1, 0.4), MS.black, 45, 7.4, -1, false);
    mesh(boxG, rbox(4, 2.2, 3, 0.6, 0.3), M.coil, 49, 9.6, -2.5);
    tube(boxG, [[49, 9.6, -1], [51, 10.4, 2], [48, 9, 4.6]], 0.3, MS.rubber, seg(16));
    mesh(boxG, new THREE.BoxGeometry(7, 5, 1.6), M.core, 45, 2, -9.8);
    tube(boxG, [[41.5, 3, -9.2], [39, 5, -8], [38.5, 5.2, -7.6]], 0.3, MS.machined, 12);
    tube(boxG, [[48.5, 1, -9.2], [50.5, 3, -8], [51, 3.4, -7.6]], 0.3, MS.machined, 12);
    // drive shafts with CV boots
    [1, -1].forEach((s) => {
      mesh(boxG, cylZ(2.2, 1.6, seg(32)), MS.machined, 36.6, -4.4, s * 11.3);
      const boot = mesh(boxG, new THREE.CylinderGeometry(1.0, 2.0, 4, seg(24)).rotateX(PI / 2), MS.rubber, 36.6, -4.4, s * 14);
      boot.rotation.y = s > 0 ? 0 : PI;
      mesh(boxG, cylZ(0.8, 9, seg(16)), MS.machined, 36.6, -4.4, s * 20.4);
    });
    // dual clutch pack inside the bellhousing (turns with the crank)
    const cl = std({ color: 0x9ba2a7, metalness: 0.85, roughness: 0.3 });
    mesh(flyG, cylX(9.0, 2.6, seg(56)), cl, 27.4, 0, 0);
    mesh(flyG, cylX(6.6, 2.0, seg(48)), M.fly, 30.0, 0, 0);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * PI * 2,
        f = mesh(flyG, new THREE.BoxGeometry(2.4, 0.5, 0.3), M.coil, 27.4, 9.05 * Math.cos(a), 9.05 * Math.sin(a));
      f.rotation.x = a;
    }
    mesh(flyG, cylX(2.2, 3, seg(24)), MS.machined, 32, 0, 0); // input shafts
  }
  reg('gearbox', boxG);

  /* ---------- Per-cylinder parts ---------- */
  const UP = V3(0, 1, 0);
  const lobe = lobeGeo(1.0, 1.0, 1.1);
  const springMat = std({ color: 0x5a6268, metalness: 0.7, roughness: 0.4 });
  const spring = springGeo(0.5, 2.6, 6, 0.08);
  const ringMat = std({ color: 0x3a4249, metalness: 0.7, roughness: 0.45 });
  const pistonBody = pistonGeo(BORE / 2 - 0.1, CH, 2.6);
  const skirtPad = new THREE.CylinderGeometry(BORE / 2 - 0.08, BORE / 2 - 0.08, 2.4, 24, 1, true, -0.55, 1.1).rotateX(PI / 2);
  const rodBody = rodGeo(L, 2.35, 1.25, 1.78, 0.86, 1.05);
  const VX = 1.75; // valve offset along the crank either side of the bore centre
  const VY = 2.2; // valve rows either side of the bank-axis plane
  const CAM_Z = DECK + 7.0;

  const cyl: CylState[] = CYL.map((c) => {
    const s = c.s,
      I = IN[s];
    // piston (in the fixed bank frame, moves along local z)
    const pg = new THREE.Group();
    pg.add(new THREE.Mesh(pistonBody, M.piston));
    // coated skirt pads on the thrust faces
    [0, PI].forEach((r) => {
      const sp = new THREE.Mesh(skirtPad, M.skirt);
      sp.rotation.z = r + PI / 2;
      sp.position.z = -1.1;
      pg.add(sp);
    });
    [2.3, 1.85, 1.4].forEach((z) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(BORE / 2 - 0.08, 0.07, 6, seg(40)), ringMat);
      t.position.z = z;
      pg.add(t);
    });
    pg.add(new THREE.Mesh(cylX(0.85, BORE - 1.4, 16), M.rod));
    axisG[s].add(pg);
    reg('piston', pg);
    // rod (world space): shaped I-beam outline + cap bolts
    const rg = new THREE.Group();
    rg.add(new THREE.Mesh(rodBody, M.rod));
    const bl: BoltSpec[] = [
      [0, -L / 2 - 0.4, 1.75, 'y', -1],
      [0, -L / 2 - 0.4, -1.75, 'y', -1],
    ];
    bolts(rg, bl, M.cam);
    const bush = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 1.1, 20, 1, true).rotateZ(PI / 2), M.yellow);
    bush.position.y = L / 2;
    rg.add(bush);
    root.add(rg);
    reg('rod', rg);
    // liner + water jacket
    const z0 = 6.2,
      bl0 = DECK - z0;
    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(BORE / 2 + 0.05, BORE / 2 + 0.05, bl0, seg(40), 1, true).rotateX(PI / 2),
      MS.bore,
    );
    liner.position.set(c.x, 0, z0 + bl0 / 2);
    liner.receiveShadow = true;
    blockG[s].add(liner);
    housing(blockG[s], cylZ(5.25, bl0 - 1.6, seg(40)), MS.cast, c.x, 0, z0 + bl0 / 2);
    // combustion glow
    const glow = new THREE.Mesh(
      cylZ(BORE / 2 - 0.12, 1, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff7a2e,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    axisG[s].add(glow);
    // 4 valves: two intake on the inner (V) side, two exhaust on the outer side
    const valves = [
      [I * VY, 1.3],
      [I * VY, 1.3],
      [-I * VY, 1.12],
      [-I * VY, 1.12],
    ].map(([y, r], k) => {
      const v = new THREE.Group();
      v.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.55, 0.36, 24).rotateX(-PI / 2), M.valve));
      const stm = new THREE.Mesh(cylZ(0.2, 6.2, 10), M.valve);
      stm.position.z = 3.15;
      v.add(stm);
      const rt = new THREE.Mesh(cylZ(0.66, 0.32, 16), M.valve);
      rt.position.z = 5.6;
      v.add(rt);
      const sp = new THREE.Mesh(spring, springMat);
      sp.position.z = 3.0;
      v.add(sp);
      v.position.set(c.x + (k % 2 ? VX : -VX), y, DECK);
      v.userData.moving = true;
      bankG[s].add(v);
      reg('valve', v);
      return v;
    });
    // cam lobes, one per valve
    const lobes = valves.map((v, k) => {
      const pv = new THREE.Group();
      pv.position.set(v.position.x, v.position.y, CAM_Z);
      pv.userData.moving = true;
      const lb = new THREE.Mesh(lobe, M.cam);
      lb.rotation.x = PI;
      pv.add(lb);
      bankG[s].add(pv);
      reg('cam', lb);
      pv.userData.peak = k < 2 ? (IN_OPEN + IN_CLOSE) / 2 : (EX_OPEN + EX_CLOSE) / 2;
      return pv;
    });
    // spark plug + coil-on-plug, centred between the four valves
    const sg = new THREE.Group();
    const th = new THREE.Mesh(cylZ(0.5, 1.2, 12), M.plugHex);
    th.position.z = 0.6;
    sg.add(th);
    const hx = new THREE.Mesh(cylZ(0.85, 1.0, 6), M.plugHex);
    hx.position.z = 1.7;
    sg.add(hx);
    const ins = new THREE.Mesh(cylZ(0.44, 2.8, 16), M.plug);
    ins.position.z = 3.6;
    sg.add(ins);
    const boot = new THREE.Mesh(cylZ(0.78, 4.6, 16), MS.rubber);
    boot.position.z = 7.3;
    sg.add(boot);
    const coil = new THREE.Mesh(rbox(2.4, 3.2, 3.0, 0.6, 0.3), M.coil);
    coil.position.set(0, 0, 11.0);
    coil.castShadow = true;
    sg.add(coil);
    const conn = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.3), MS.black);
    conn.position.set(0, -I * 2.0, 11.2);
    sg.add(conn);
    sg.position.set(c.x, 0, DECK);
    bankG[s].add(sg);
    reg('plug', sg);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff2d0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spark.position.set(c.x, 0, DECK - 0.3);
    bankG[s].add(spark);

    return {
      ...c,
      piston: pg,
      rod: rg,
      glow,
      spark,
      valves,
      lobes,
      T: 0,
      phi: 0,
      p: 0,
      rodAng: 0,
      crown: 15,
      liftI: 0,
      liftE: 0,
    };
  });

  /* ---------- Blocks, heads, cam covers ---------- */
  BANKS.forEach((s) => {
    const I = IN[s];
    const xs = CYL.filter((c) => c.s === s).map((c) => c.x),
      x0 = Math.min(...xs) - 5.3,
      x1 = Math.max(...xs) + 5.3,
      xm = (x0 + x1) / 2,
      w = x1 - x0;
    const z0 = 6.2,
      bl = DECK - z0;
    housing(blockG[s], rbox(w, 11.4, bl, 1.2, 0.5), MS.cast, xm, 0, z0 + bl / 2);
    housing(blockG[s], new THREE.BoxGeometry(w + 0.6, 13, 0.5), MS.castDark, xm, 0, DECK - 0.25);
    housing(blockG[s], new THREE.BoxGeometry(w + 0.4, 12.8, 0.25), MS.gasket, xm, 0, DECK + 0.12, false);
    // outer-face ribs + head-bolt bosses between the bores
    for (let k = 0; k <= 4; k++) {
      const x = x0 + 0.3 + k * PITCH + (k === 0 ? 0.5 : 0) - (k === 4 ? 0.8 : 0);
      housing(blockG[s], rbox(1.0, 1.2, bl - 1, 0.3, 0.15), MS.cast, x, -I * 6.0, z0 + bl / 2, false);
    }
    // head
    housing(bankG[s], rbox(w + 0.4, 14, 5.4, 1.4, 0.5), MS.cast, xm, 0, DECK + 2.95);
    CYL.filter((c) => c.s === s).forEach((c) => {
      housing(bankG[s], rbox(4.6, 1.4, 3, 0.5, 0.25), MS.cast, c.x, I * 7.4, DECK + 2.8, false);
      housing(bankG[s], rbox(4.2, 1.4, 2.8, 0.5, 0.25), MS.cast, c.x, -I * 7.4, DECK + 2.8, false);
      // exhaust studs
      bolts(
        bankG[s],
        [
          [c.x - 1.6, -I * 8.1, DECK + 1.6, 'y', -I],
          [c.x + 1.6, -I * 8.1, DECK + 4.0, 'y', -I],
        ],
        MS.bolt,
      );
    });
    // cam carrier + red crinkle cam cover with raised ribs and a black coil strip
    housing(bankG[s], rbox(w - 0.2, 12.6, 2.0, 1.2, 0.4), MS.castDark, xm, 0, DECK + 6.6);
    housing(bankG[s], rbox(w - 1, 11.6, 3.6, 2.4, 0.8), MS.red, xm, 0, DECK + 9.2);
    [-3.4, 3.4].forEach((y) =>
      housing(bankG[s], rbox(w - 5, 1.1, 0.8, 0.4, 0.2), MS.red, xm, y, DECK + 11.15, false),
    );
    housing(bankG[s], rbox(w - 4, 4.4, 0.4, 0.8, 0.15), MS.wrinkle, xm, 0, DECK + 11.05, false);
    // cast lettering on the outer flank of the cover
    {
      const lt = mesh(bankG[s], new THREE.PlaneGeometry(16, 1.15), MS.letters, xm - 2, -I * 4.55, DECK + 11.1);
      lt.castShadow = false;
      if (s > 0) lt.rotation.z = PI; // read the right way round from outside the V
    }
    const bl1: BoltSpec[] = [];
    for (let i = 0; i < 9; i++) {
      const x = x0 + 1.8 + (i * (w - 3.6)) / 8;
      bl1.push([x, 5.25, DECK + 10.95, 'z', 1], [x, -5.25, DECK + 10.95, 'z', 1]);
    }
    bolts(bankG[s], bl1, MS.bolt);
    // two camshafts per bank, sprockets + phasers at the flywheel end where the chain runs
    [VY, -VY].forEach((y) => {
      const sh = new THREE.Mesh(cylX(0.55, w + 1.5, 16), M.cam);
      sh.position.set(xm, y, CAM_Z);
      bankG[s].add(sh);
      reg('cam', sh);
      const sp = new THREE.Mesh(cylX(2.2, 0.8, 30), M.cam);
      sp.position.set(x1 + 0.3, y, CAM_Z);
      bankG[s].add(sp);
      reg('cam', sp);
      const vp = new THREE.Mesh(cylX(1.7, 1.2, 24), MS.machined);
      vp.position.set(x1 + 1.3, y, CAM_Z);
      bankG[s].add(vp);
      // bearing caps
      for (let k = 0; k <= 4; k++)
        housing(bankG[s], rbox(0.9, 1.6, 1.4, 0.3, 0.15), MS.castDark, x0 + 0.8 + k * PITCH, y, CAM_Z - 0.9, false);
    });
    housing(bankG[s], rbox(1.6, 13.6, 10.2, 1.2, 0.4), MS.castDark, x1 + 1.2, 0, DECK + 5.2);
    housing(blockG[s], rbox(1.6, 10, bl, 1.2, 0.4), MS.castDark, x1 + 1.2, 0, z0 + bl / 2);
    // cam-driven high-pressure fuel pump at the rear of the inner cam
    {
      const hp = mesh(bankG[s], cylZ(1.3, 3.4, seg(24)), MS.machined, x1 - 3.2, I * 4.2, DECK + 12.2);
      hp.castShadow = true;
      mesh(bankG[s], cylZ(1.6, 0.6, seg(24)), MS.castDark, x1 - 3.2, I * 4.2, DECK + 10.7);
    }
    // direct-injection fuel rail on the inner side + high-pressure line from the pump
    const rail = mesh(bankG[s], cylX(0.5, w - 3, 16), MS.machined, xm, I * 8.9, DECK + 1.2);
    rail.castShadow = true;
    CYL.filter((c) => c.s === s).forEach((c) => {
      mesh(bankG[s], cylY(0.4, 2.0, 16), MS.black, c.x, I * 7.9, DECK + 1.2);
      mesh(bankG[s], new THREE.BoxGeometry(0.8, 0.7, 1.0), M.coil, c.x, I * 9.6, DECK + 1.9);
    });
    tube(
      bankG[s],
      [
        [x1 - 3.2, I * 4.2, DECK + 13.8],
        [x1 - 1.5, I * 7, DECK + 12],
        [x1 - 1.5, I * 9, DECK + 5],
        [x1 - 2.8, I * 8.9, DECK + 1.2],
      ],
      0.18,
      MS.machined,
      seg(24),
    );
    // coil harness
    tube(
      bankG[s],
      [
        [x0 + 0.5, -I * 2.75, DECK + 11.5],
        [xm, -I * 2.8, DECK + 11.6],
        [x1 - 1.5, -I * 2.75, DECK + 11.5],
      ],
      0.28,
      MS.rubber,
      seg(40),
    );
    CYL.filter((c) => c.s === s).forEach((c) =>
      tube(
        bankG[s],
        [
          [c.x + 0.8, -I * 2.75, DECK + 11.6],
          [c.x + 0.4, -I * 2.4, DECK + 12.0],
          [c.x, -I * 2.0, DECK + 11.8],
        ],
        0.16,
        MS.rubber,
        10,
      ),
    );
    // injector harness along the rail
    tube(
      bankG[s],
      [
        [x0 + 1, I * 10.1, DECK + 2.2],
        [xm, I * 10.3, DECK + 2.3],
        [x1 - 1, I * 10.1, DECK + 2.2],
      ],
      0.24,
      MS.rubber,
      seg(30),
    );
  });

  /* ---------- Intake: plenum in the V, carbon cover, throttle at the rear ---------- */
  housing(intakeG, rbox(36, 5, 9.4, 2.4, 0.8), MS.plenum, 0, 25, 0);
  housing(intakeG, rbox(33, 1.0, 8.4, 2, 0.35), MS.carbon, 0, 27.9, 0, false);
  {
    // throttle body
    mesh(intakeG, cylX(2.5, 3.0, seg(40)), MS.machined, 19.8, 25, 0);
    mesh(intakeG, cylX(2.9, 0.5, seg(40)), MS.castDark, 18.2, 25, 0);
    mesh(intakeG, rbox(2.6, 3, 2.6, 0.5, 0.25), MS.black, 19.8, 25, 3);
    // Y-pipe from the two intercoolers into the throttle
    mesh(intakeG, cylX(2.6, 2.4, seg(40)), M.silicone, 22.4, 25, 0);
    bolts(intakeG, [[-10, 28.5, 3.4, 'y'], [0, 28.5, 3.4, 'y'], [10, 28.5, 3.4, 'y'], [-10, 28.5, -3.4, 'y'], [0, 28.5, -3.4, 'y'], [10, 28.5, -3.4, 'y']], MS.bolt);
    // MAP sensor
    mesh(intakeG, rbox(1.4, 1.2, 1.8, 0.3, 0.15), M.coil, -14, 28.2, 2);
  }
  CYL.forEach((c) => {
    const s = c.s,
      I = IN[s];
    const port = bp(s, c.x, I * 7.4, DECK + 2.8),
      out = bp(s, c.x, I * 9.6, DECK + 2.8);
    const r = tube(intakeG, [[c.x, 25.2, s * 3.6], [c.x, 25.9, s * 6.6], out, port], 1.1, MS.plenum, seg(24));
    sv.addBack(intakeG, r);
  });
  reg('intake', intakeG);

  /* ---------- Exhaust manifolds + twin-scroll turbos (one per bank) ---------- */
  const { turbX: TURB_X, compX: COMP_X, y: TY, z: TZ } = TURBO;
  const wheels: THREE.Object3D[] = [];
  BANKS.forEach((s) => {
    const g = exhaustG[s],
      I = IN[s];
    // twin-scroll: the two outer cylinders (pins 1 & 4) feed one log, the inner two the other,
    // so each scroll gets pulses 360° apart on the flat-plane crank
    const logs = [
      { y: 10.2, dz: 0.9, pins: [0, 3] },
      { y: 7.6, dz: -0.6, pins: [1, 2] },
    ];
    CYL.filter((c) => c.s === s).forEach((c) => {
      const lg = logs.find((l) => l.pins.includes(c.pin))!;
      const port = bp(s, c.x, -I * 7.4, DECK + 2.8),
        a = bp(s, c.x, -I * 9.8, DECK + 2.4);
      tube(g, [port, a, [c.x + 1.5, lg.y + 0.8, s * (TZ + lg.dz - 1)], [c.x + 3, lg.y, s * (TZ + lg.dz)]], 0.78, M.exhaust, seg(24));
      const fl = new THREE.Mesh(rbox(3.6, 0.6, 3.2, 0.4, 0.15), MS.cast);
      bankPoint(s, c.x, -I * 7.9, DECK + 2.8, fl.position);
      fl.rotation.x = RHO[s];
      g.add(fl);
    });
    logs.forEach((lg, k) =>
      tube(
        g,
        [
          [-14, lg.y, s * (TZ + lg.dz)],
          [0, lg.y - 0.2, s * (TZ + lg.dz)],
          [11, lg.y - 0.6, s * (TZ + lg.dz)],
          [TURB_X - 1.2 + k * 0.4, 4.4 - k * 0.6, s * (TZ + lg.dz * 0.7)],
          [TURB_X - 0.8 + k * 0.4, 2.2, s * (TZ + lg.dz * 0.5)],
        ],
        1.0,
        M.exhaust,
        seg(40),
      ),
    );
    // heat shield over the manifold logs (left off bank A so the cutaway stays readable)
    if (s < 0) {
      const hs = mesh(
        g,
        new THREE.CylinderGeometry(3.0, 3.0, 26, seg(28), 1, true, -PI / 2 - 0.2, PI + 0.4).rotateZ(PI / 2),
        M.shield,
        -1.5,
        9.0,
        s * (TZ + 0.2),
      );
      hs.rotation.x = s > 0 ? -0.5 : 0.5;
      hs.material.side = THREE.DoubleSide;
    }
    // turbine (cast iron, hot side) and compressor (aluminium, cold side)
    const scroll = (x: number, r: number, t: number, mat: THREE.Material) => {
      const ring = mesh(g, new THREE.TorusGeometry(r, t, seg(16), seg(40)).rotateY(PI / 2), mat, x, TY, s * TZ);
      mesh(g, cylX(r, t * 1.9, seg(32)), mat, x, TY, s * TZ);
      reg('turbo', ring);
    };
    scroll(TURB_X, 2.2, 1.3, M.turbine);
    scroll(COMP_X, 2.4, 1.4, M.compressor);
    const hsT = mesh(
      g,
      new THREE.CylinderGeometry(4.3, 4.3, 3.6, seg(28), 1, true, -PI * 0.1, PI * 1.2).rotateZ(PI / 2),
      M.shield,
      TURB_X,
      TY,
      s * TZ,
    );
    hsT.rotation.x = s > 0 ? PI * 0.15 : -PI * 0.15;
    mesh(g, cylX(1.3, TURB_X - COMP_X - 2, 20), M.boost, (TURB_X + COMP_X) / 2, TY, s * TZ); // bearing housing
    // oil + coolant lines to the cartridge
    tube(g, [[(TURB_X + COMP_X) / 2, TY + 1.3, s * TZ], [14, 5, s * (TZ - 2)], [12, 6.2, s * (TZ - 7)]], 0.16, MS.machined, 12);
    tube(g, [[(TURB_X + COMP_X) / 2 - 0.5, TY - 1.3, s * TZ], [13.5, -4, s * (TZ - 3)], [11, -4.4, s * (TZ - 9)]], 0.22, MS.rubber, 12);
    // wastegate actuator + rod
    mesh(g, cylZ(1.1, 1.8, 20), M.boost, COMP_X + 0.5, TY - 3.4, s * (TZ + 2.2));
    tube(g, [[COMP_X + 0.5, TY - 3.4, s * (TZ + 3.2)], [TURB_X - 1, TY - 3.2, s * (TZ + 3.4)], [TURB_X + 0.6, TY - 2.4, s * (TZ + 1.8)]], 0.1, MS.machined, 8);
    // compressor inlet (open, so the wheel is visible) + spinning wheel
    const inlet = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 1.55, 3.2, seg(32), 1, true).rotateZ(PI / 2),
      std({ color: 0x1a1b1e, roughness: 0.8, side: THREE.DoubleSide }),
    );
    inlet.position.set(COMP_X - 3.1, TY, s * TZ);
    g.add(inlet);
    reg('turbo', inlet);
    const wheel = compressorWheel(1.45, M.wheel);
    wheel.position.set(COMP_X - 1.6, TY, s * TZ);
    g.add(wheel);
    wheels.push(wheel);
    wheel.userData.moving = true;
    // air filter box ahead of the compressor
    {
      const box = mesh(g, rbox(8, 6, 4.6, 1.2, 0.5), MS.wrinkle, -4, -2.6, s * (TZ + 1.5));
      mesh(g, rbox(8.3, 0.6, 4.9, 0.3, 0.15), MS.black, -4, 0.2, s * (TZ + 1.5));
      tube(g, [[0, -2.6, s * (TZ + 1.5)], [4, -1.4, s * (TZ + 0.8)], [COMP_X - 4.6, TY, s * TZ]], 1.6, MS.rubber, seg(24));
      reg('turbo', box);
    }
    // downpipe + catalyst (with shield) + tailpipe
    tube(g, [[TURB_X + 2, TY, s * TZ], [24, TY - 1, s * (TZ - 0.5)], [28, TY - 2, s * (TZ - 1.5)]], 1.3, M.cat, seg(20));
    mesh(g, rbox(7, 4.6, 4.6, 2, 0.7), M.cat, 31.5, TY - 2.2, s * (TZ - 2));
    mesh(g, rbox(7.6, 0.4, 5.4, 1.2, 0.15), M.shield, 31.5, TY + 0.4, s * (TZ - 2));
    // O2 sensors
    mesh(g, cylY(0.35, 1.8, 10), MS.machined, 26, TY + 0.8, s * (TZ - 1));
    tube(g, [[35, TY - 2.2, s * (TZ - 2)], [44, -1.5, s * 20], [52, 1, s * 14], [56, 2, s * 9]], 1.1, M.cat, seg(30));
  });
  {
    // rear silencer sits behind the gearbox, with bypass valves and twin tips
    const muf = mesh(exhaustG[1], rbox(6.4, 7, 24, 2.6, 0.9), M.cat, 59, 2, 0);
    reg('exhaust', muf);
    [1, -1].forEach((s) => {
      mesh(exhaustG[1], cylX(1.7, 4.4, seg(28)), MS.machined, 64, 1.6, s * 6.5);
      mesh(exhaustG[1], new THREE.CylinderGeometry(1.7, 1.7, 0.3, seg(28), 1, true).rotateZ(PI / 2), std({ color: 0x111111, side: THREE.DoubleSide }), 66.3, 1.6, s * 6.5);
      mesh(exhaustG[1], cylZ(0.9, 1.6, 16), M.boost, 58, 6.2, s * 8); // bypass valve actuator
    });
  }
  BANKS.forEach((s) => {
    exhaustG[s].children.forEach((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m === M.turbine || m === M.compressor || m === M.boost) reg('turbo', o);
    });
    reg('exhaust', exhaustG[s]);
  });

  /* ---------- Intercoolers (air-to-air, in the car's side intakes) ---------- */
  BANKS.forEach((s) => {
    const g = coolerG[s];
    const cx = 28,
      cy = 10,
      cz = s * 34;
    mesh(g, new THREE.BoxGeometry(12, 9, 2.4), M.core, cx, cy, cz);
    [-1, 1].forEach((e) => mesh(g, rbox(2.2, 9.6, 3.2, 0.8, 0.35), M.acc, cx + e * 7.1, cy, cz));
    mesh(g, new THREE.BoxGeometry(12.4, 0.5, 2.8), M.acc, cx, cy + 4.75, cz);
    mesh(g, new THREE.BoxGeometry(12.4, 0.5, 2.8), M.acc, cx, cy - 4.75, cz);
    // hot side from the compressor, cold side back to the throttle
    tube(
      g,
      [
        [COMP_X, TY + 2.6, s * TZ],
        [COMP_X + 1, 6.5, s * (TZ + 3)],
        [16, 8, s * (TZ + 7)],
        [cx - 7.6, 7, cz + s * 1.2],
        [cx - 7.6, 7.5, cz],
      ],
      1.15,
      M.silicone,
      seg(36),
    );
    tube(
      g,
      [
        [cx + 7.6, cy + 2.5, cz],
        [cx + 9, cy + 7, cz - s * 3],
        [30, 22, s * 18],
        [24, 27, s * 8],
        [22.4, 25.6, s * 2.2],
      ],
      1.2,
      M.boost,
      seg(40),
    );
    mesh(g, cylZ(1.4, 1.2, 20), M.silicone, cx + 7.6, cy + 2.5, cz - s * 1.8);
  });
  BANKS.forEach((s) => reg('intercooler', coolerG[s]));

  /* ---------- Front accessory drive ---------- */
  const pulleys: THREE.Group[] = [];
  const grooveMat = std({ color: 0x22262a, metalness: 0.6, roughness: 0.5 });
  const spokeMat = std({ color: 0x15171a, roughness: 0.6 });
  const darkPulley = std({ color: 0x2a2e32, metalness: 0.7, roughness: 0.4 });
  function pulley(k: PulleyKey, mat: THREE.Material = M.pulley) {
    const p = PUL[k],
      g = new THREE.Group();
    g.position.set(BELT_X, p.y, p.z);
    g.add(new THREE.Mesh(cylX(p.r, 2.2, seg(48)), mat));
    for (let i = -1; i <= 1; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(p.r + 0.02, 0.1, 6, seg(48)).rotateY(PI / 2), grooveMat);
      t.position.x = i * 0.55;
      g.add(t);
    }
    g.add(new THREE.Mesh(cylX(Math.min(1.2, p.r * 0.45), 2.7, 20), MS.machined));
    const nSp = k === 'crank' ? 6 : 5;
    for (let i = 0; i < nSp; i++) {
      const a = (i / nSp) * PI * 2,
        h = new THREE.Mesh(cylX(p.r * 0.16, 2.4, 12), spokeMat);
      h.position.set(0, p.r * 0.6 * Math.sin(a), p.r * 0.6 * Math.cos(a));
      g.add(h);
    }
    frontG.add(g);
    g.userData.ratio = PUL.crank.r / p.r;
    g.userData.moving = true;
    pulleys.push(g);
    return g;
  }
  pulley('crank', darkPulley);
  mesh(frontG, cylX(4.4, 0.9, seg(48)), MS.rubber, BELT_X + 1.8, 0, 0); // torsional damper
  mesh(frontG, cylX(4.2, 1.2, seg(48)), darkPulley, BELT_X + 2.8, 0, 0);
  (['ac', 'wp', 'idler', 'alt', 'tens'] as const).forEach((k) => pulley(k));
  // alternator
  {
    const a = PUL.alt;
    mesh(frontG, cylX(3.4, 5.6, seg(40)), M.acc, BELT_X + 4.6, a.y, a.z);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * PI * 2,
        f = mesh(frontG, new THREE.BoxGeometry(4.4, 0.22, 0.5), MS.castDark, BELT_X + 4.4, a.y + 3.45 * Math.sin(ang), a.z + 3.45 * Math.cos(ang));
      f.rotation.x = -ang;
    }
    mesh(frontG, cylX(2.8, 0.8, 32), MS.black, BELT_X + 7.8, a.y, a.z);
  }
  // A/C compressor
  {
    const a = PUL.ac;
    mesh(frontG, cylX(3.0, 6.4, seg(40)), M.acc, BELT_X + 4.6, a.y, a.z);
    mesh(frontG, cylX(3.1, 0.8, seg(40)), MS.black, BELT_X + 1.6, a.y, a.z);
    [-1.4, 1.4].forEach((dy) => mesh(frontG, rbox(1.4, 1.4, 1.2, 0.3, 0.15), MS.machined, BELT_X + 6.8, a.y + dy, a.z - 2.6));
  }
  // water pump (on the front cover, centred in the V)
  {
    const a = PUL.wp;
    const b = mesh(frontG, new THREE.CylinderGeometry(2.2, 3.0, 3.4, seg(32)).rotateZ(PI / 2), M.acc, BELT_X + 3.6, a.y, a.z);
    b.castShadow = true;
  }
  const belt = beltGeo(PUL, BELT_X, 0.42, 1.0);
  const beltMesh = mesh(frontG, belt.geo, M.belt);
  beltMesh.receiveShadow = false;
  reg('belt', frontG);
  // coolant: hoses from the water pump to each head, expansion tank
  function hose(parent: THREE.Object3D, pts: number[][], r = 0.8) {
    tube(parent, pts, r, MS.rubber, seg(30));
    [pts[0], pts[pts.length - 1]].forEach((p, i) => {
      const q = pts[i ? pts.length - 2 : 1],
        d = V3(q[0], q[1], q[2]).sub(V3(p[0], p[1], p[2])).normalize();
      const cl = new THREE.Mesh(new THREE.TorusGeometry(r + 0.08, 0.14, 6, 20), MS.machined);
      cl.position.set(p[0], p[1], p[2]).addScaledVector(d, 0.6);
      cl.quaternion.setFromUnitVectors(V3(0, 0, 1), d);
      parent.add(cl);
    });
  }
  hose(caseG, [[BELT_X + 5, PUL.wp.y + 1, 1.8], [-24, 18, 6], [-23.6, 19, 10.5]]);
  hose(caseG, [[BELT_X + 5, PUL.wp.y + 1, -1.8], [-24, 18, -6], [-23.6, 19, -10.5]]);
  {
    const tank = mesh(caseG, rbox(5, 4, 3.4, 1.2, 0.4), M.plastic, -33, 8, -12);
    tank.castShadow = false;
    mesh(caseG, cylY(0.9, 0.9, 20), M.yellow, -33, 10.4, -12);
    hose(caseG, [[-31, 6.5, -11], [-30, 9, -6], [BELT_X + 4, PUL.wp.y - 1.5, -1.5]], 0.5);
  }
  // crankcase breathers: cam covers → intake
  BANKS.forEach((s) => {
    const I = IN[s];
    tube(
      caseG,
      [bp(s, 13, I * 4.6, DECK + 11.3), bp(s, 15.5, I * 6.5, DECK + 13), [17, 28.6, s * 4.4], [16.6, 27.9, s * 2.6]],
      0.42,
      MS.rubber,
      seg(24),
    );
  });
  // coolant crossover at the rear of the V + thermostat housing
  mesh(caseG, cylX(1.3, 3, seg(20)), MS.cast, 22.6, 20, 0);
  hose(caseG, [[22.6, 20, 1.3], [22.8, 19.6, 6], bp(1, 21.4, 4, DECK + 1.5)], 0.6);
  hose(caseG, [[22.6, 20, -1.3], [22.8, 19.6, -6], bp(-1, 21.4, -4, DECK + 1.5)], 0.6);
  // engine harness along the valley
  tube(caseG, [[-22, 20.6, 2.4], [-8, 21.6, 2.6], [8, 21.6, 2.6], [20, 20.6, 2.4], [24, 16, 4]], 0.45, MS.rubber, seg(40));
  tube(caseG, [[-22, 20.6, -2.4], [-8, 21.6, -2.6], [8, 21.6, -2.6], [20, 20.6, -2.4]], 0.45, MS.rubber, seg(40));

  /* ---------- Floor ---------- */
  const FLOOR = -13.6;
  {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.ShadowMaterial({ opacity: 0.42 }));
    sh.rotation.x = -PI / 2;
    sh.position.y = FLOOR;
    sh.receiveShadow = true;
    root.add(sh);
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshBasicMaterial({ map: floorMap, transparent: true, depthWrite: false }),
    );
    disc.rotation.x = -PI / 2;
    disc.position.y = FLOOR - 0.05;
    root.add(disc);
    const pts: number[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * PI * 2,
        b = ((i + 1) / 160) * PI * 2;
      pts.push(60 * Math.cos(a), FLOOR, 60 * Math.sin(a), 60 * Math.cos(b), FLOOR, 60 * Math.sin(b));
    }
    for (let d = 0; d < 360; d += 5) {
      const a = d * RAD,
        l = d % 30 === 0 ? 2.6 : 1;
      pts.push(60 * Math.cos(a), FLOOR, 60 * Math.sin(a), (60 - l) * Math.cos(a), FLOOR, (60 - l) * Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c343b })));
  }

  // shadows on everything opaque
  root.traverse((m) => {
    const ms = m as THREE.Mesh;
    if (!ms.isMesh || m.userData.aid) return;
    const mat = ms.material as THREE.Material;
    if (mat.blending === THREE.NormalBlending && !(mat as THREE.ShadowMaterial).isShadowMaterial && !mat.transparent)
      ms.castShadow = ms.receiveShadow = true;
  });

  // collapse static geometry into one mesh per material and part (≈ a third of the draw calls)
  const moving = (o: THREE.Object3D) => !!(o.userData.moving || o.userData.aid);
  [caseG, sumpG, intakeG, flyG, frontG, boxG, cranks.flat, cranks.cross, ...BANKS.flatMap((s) => [bankG[s], blockG[s], exhaustG[s], coolerG[s]])].forEach(
    (g) => mergeStatic(g, pickables, moving),
  );
  // ...and inside each moving sub-assembly
  const none = () => false;
  cyl.forEach((c) => {
    [c.piston, c.rod, ...c.valves].forEach((g) => mergeStatic(g, pickables, none));
    // valve gear sits inside the heads: its shadows are never seen, skip the extra pass
    [...c.valves, ...c.lobes].forEach((g) => g.traverse((m) => (m.castShadow = false)));
  });
  pulleys.forEach((g) => mergeStatic(g, pickables, none));
  wheels.forEach((g) => mergeStatic(g, pickables, none));

  /* ---------- Simulation ---------- */
  const sim: FerrariV8Sim = { theta: 0, rpm: 3000, explode: 0, crank: 'flat', fire: null, cyl };
  let aidsOn = false;
  function setCrank(t: CrankType) {
    sim.crank = t;
    const T = firingOffsets(t),
      ph = pinPhases(t);
    cyl.forEach((c) => {
      c.T = T[c.n - 1];
      c.phi = ph[c.pin];
    });
    cranks.flat.visible = t === 'flat';
    cranks.cross.visible = t === 'cross';
  }
  setCrank('flat');

  const C_HOT = new THREE.Color(0xff6a1e),
    C_EX = new THREE.Color(0x3a332c),
    C_IN = new THREE.Color(0x1d4a52),
    C_CO = new THREE.Color(0x2b3166);
  const P = V3(0, 0, 0),
    Q = V3(0, 0, 0),
    dir = V3(0, 0, 0),
    axis: Record<number, THREE.Vector3> = {
      1: bankPoint(1, 0, 0, 1, V3(0, 0, 0)),
      [-1]: bankPoint(-1, 0, 0, 1, V3(0, 0, 0)),
    };

  function simulate() {
    const th = sim.theta,
      thr = th * RAD;
    cranks[sim.crank].rotation.x = -(th % 360) * RAD;
    flyG.rotation.x = -(th % 360) * RAD;
    pulleys.forEach((p) => {
      p.rotation.x = -thr * p.userData.ratio;
    });
    M.belt.map!.offset.x = (((thr * PUL.crank.r) / belt.len) * 60) % 1;
    // turbo speed is illustrative (real shafts spin ~20-30× faster than the crank)
    wheels.forEach((w) => (w.rotation.x = -thr * 3));
    aids.forEach((a) => (a.visible = aidsOn));
    const ex = sim.explode;
    BANKS.forEach((s) => {
      bankG[s].position.copy(axis[s]).multiplyScalar(ex * 12);
      blockG[s].position.copy(axis[s]).multiplyScalar(ex * 5);
      exhaustG[s].position.set(0, -ex * 3, s * ex * 9);
      coolerG[s].position.set(0, 0, s * ex * 14);
    });
    intakeG.position.y = ex * 14;
    sumpG.position.y = -ex * 6;
    flyG.position.x = ex * 8;
    boxG.position.x = ex * 20;
    frontG.position.x = -ex * 8;
    let fire: CylState | null = null;
    for (const c of cyl) {
      const a = (c.phi - th) * RAD,
        psi = a - c.alpha * RAD,
        perp = R * Math.sin(psi),
        d = R * Math.cos(psi) + Math.sqrt(L * L - perp * perp);
      c.piston.position.set(c.x, 0, d);
      P.set(c.x, R * Math.cos(a), R * Math.sin(a));
      Q.copy(axis[c.s]).multiplyScalar(d).setX(c.x);
      c.rod.position.copy(P).add(Q).multiplyScalar(0.5);
      dir.copy(Q).sub(P).normalize();
      c.rod.quaternion.setFromUnitVectors(UP, dir);
      c.rodAng = Math.asin(perp / L) / RAD;
      c.crown = d + CH;
      const deck = DECK + ex * 12,
        len = Math.max(deck - c.crown, 0.01);
      c.glow.scale.z = len;
      c.glow.position.set(c.x, 0, c.crown + len / 2);
      const p = (((th - c.T) % 720) + 720) % 720;
      c.p = p;
      const gm = c.glow.material;
      if (p < 180) {
        gm.color.copy(C_HOT);
        gm.opacity = 0.9 * Math.pow(1 - p / 180, 1.4) + 0.05;
        if (!fire || p < fire.p) fire = c;
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
      c.valves.forEach((v, k) => (v.position.z = DECK - 0.15 - (k < 2 ? c.liftI : c.liftE)));
      c.lobes.forEach((pv) => {
        pv.rotation.x = -((th - c.T - pv.userData.peak) / 2) * RAD;
      });
      const sp = p >= 720 - SPARK_ADV ? Math.sin(((p - (720 - SPARK_ADV)) / SPARK_ADV) * PI) : 0;
      c.spark.material.opacity = sp;
      c.spark.scale.setScalar(0.6 + sp * 0.8);
    }
    const f = fire as CylState | null;
    if (f) {
      fireLight.intensity = 3.2 * PI * FIRE_GAIN * Math.pow(1 - f.p / 180, 2);
      bankPoint(f.s, f.x, 0, DECK - 1.5, fireLight.position, ex * 12);
    } else fireLight.intensity = 0;
    sim.fire = f;
  }

  simulate();

  const visibleChain = (o: THREE.Object3D | null): boolean => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };

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
    setMode: (id) => {
      sv.apply(id as SectionMode);
      svBox.apply(id as SectionMode);
    },
    highlight(k) {
      Object.entries(PART_MATS).forEach(([p, ms]) => ms.forEach((m) => m.emissive.setHex(p === k ? 0x110c04 : 0x000000)));
      aidsOn = k === 'crank';
    },
    acceptHit(h, mode) {
      if (!visibleChain(h.object)) return false;
      if (mode !== 'cut') return true;
      const clipped = !!((h.object as THREE.Mesh).material as THREE.Material).clippingPlanes;
      return !(clipped && (inCut(h.point) || inBoxCut(h.point)));
    },
    tags: cyl.map((c) => ({
      id: String(c.n),
      text: String(c.n),
      position: (out) => bankPoint(c.s, c.x, -IN[c.s] * 6.8, DECK + 9.4, out, sim.explode * 12),
      active: () => sim.fire === c,
    })),
    update({ dt, playing, explode, params }) {
      sim.rpm = params.rpm;
      sim.explode = explode;
      if (params.crank !== sim.crank) setCrank(params.crank);
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
