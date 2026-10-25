/*
 * Mercedes-Benz E-Class (W214, E 200) as a whole car: a procedural body that can go X-ray, and
 * the basic systems underneath it, each with its own fluid flowing through it.
 * Units: decimetres. x = forward, y = up, z = right (passenger side, left-hand drive).
 */
import * as THREE from 'three';
import type { BuildContext, PresentationInstance } from '../../framework/types';
import { RAD, V3, canvasTex, cylX, cylY, cylZ, disposeTree, rbox, tube } from '../../framework/three/geometry';
import { PathFlow, type FlowPathDef } from '../../framework/three/flow';
import {
  AXLE_F,
  AXLE_R,
  TRACK_F,
  TRACK_R,
  WHEEL_R,
  archCut,
  archLiner,
  bodyGeometry,
  xrayMaterial,
} from './body';
import { DRIVES, exhaustTemp, newDrive, stepDrive, type DriveMode, type DriveSim } from './drive';
import { HOME_VIEW, PART_SYS, SYSTEMS, makeParts } from './content';

export interface MercParams {
  drive: DriveMode;
  hvac: 'cool' | 'heat';
  /** Bumped by the "cold start" button. */
  coldStart: number;
}

export interface MercSim extends DriveSim {
  explode: number;
  hvac: 'cool' | 'heat';
  system: string | null;
  /** Crank angle shown by the (slowed) animation, degrees. */
  theta: number;
  exhaustC: number;
}

export type MercInstance = PresentationInstance<MercParams> & { sim: MercSim };

/** Rotations are shown slowed down (real shafts would just blur). */
export const SLOW = 12;

/** Cylinder centres along x, crank height, stroke radius, rod length (dm). */
const CYL_X = [16.35, 15.45, 14.55, 13.65];
const CRANK_Y = 3.4;
const CR = 0.46;
const ROD = 1.45;
/** Firing order 1-3-4-2: crank pin phase per cylinder (1 & 4 up together). */
const PIN = [0, 180, 180, 0];

type Role = 'solid' | 'pipe' | 'shell';
interface RegMat {
  m: THREE.MeshStandardMaterial;
  sys: string;
  role: Role;
  base: { o: number; t: boolean; dw: boolean };
}

export function buildMercedes({ gl, scene, quality = 'high' }: BuildContext): MercInstance {
  const low = quality === 'low';
  const PI = Math.PI;
  const root = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const regs: RegMat[] = [];
  const PART_MATS: Record<string, THREE.MeshStandardMaterial[]> = {};
  const sysMeshes: Record<string, THREE.Mesh[]> = {};

  /* ---------- Materials ---------- */
  /** A material belonging to a part (and so to that part's system). */
  function M(part: string, o: THREE.MeshStandardMaterialParameters, role: Role = 'solid') {
    const sys = PART_SYS[part];
    const m = new THREE.MeshStandardMaterial(o);
    if (role === 'pipe') {
      m.transparent = true;
      m.opacity = o.opacity ?? 0.42;
      m.depthWrite = false;
    }
    m.userData.emissive0 = m.emissive.getHex();
    regs.push({ m, sys, role, base: { o: m.opacity, t: m.transparent, dw: m.depthWrite } });
    (PART_MATS[part] ??= []).push(m);
    return m;
  }
  const sysColor = (id: string) => new THREE.Color(SYSTEMS.find((s) => s.id === id)!.color);
  /** Translucent pipe in its system colour. */
  const pipeMat = (part: string, color?: number, opacity = 0.4) =>
    M(part, { color: color ?? sysColor(PART_SYS[part]), metalness: 0.1, roughness: 0.35, opacity }, 'pipe');

  const common = {
    tyre: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.92, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x8d949b, roughness: 0.3, metalness: 0.85 }),
    rimIn: new THREE.MeshStandardMaterial({ color: 0x3a3e43, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x5d6166, roughness: 0.45, metalness: 0.8 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x34383d, roughness: 0.5, metalness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.55, metalness: 0.6 }),
    liner: new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.95, side: THREE.DoubleSide }),
  };

  /** Adds a mesh; `part` makes it clickable and ties it to the part's system. */
  function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, part?: string) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (part) {
      m.userData.part = part;
      pickables.push(m);
      (sysMeshes[PART_SYS[part]] ??= []).push(m);
    }
    parent.add(m);
    return m;
  }
  /** Tube along points, tagged with a part. */
  function pipe(parent: THREE.Object3D, part: string, pts: number[][], r: number, mat: THREE.Material, seg = 40) {
    const m = tube(parent, pts, r, mat, low ? Math.ceil(seg * 0.6) : seg);
    m.userData.part = part;
    pickables.push(m);
    (sysMeshes[PART_SYS[part]] ??= []).push(m);
    return m;
  }

  /* ---------- Environment + lights (same look as the engine presentations) ---------- */
  const envTex = canvasTex(32, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#a3acb3');
    gr.addColorStop(0.2, '#525b62');
    gr.addColorStop(0.46, '#22272c');
    gr.addColorStop(0.56, '#121518');
    gr.addColorStop(1, '#050607');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(250,248,244,.95)';
    g.fillRect(0, 30, w, 10);
    g.fillStyle = 'rgba(170,205,230,.5)';
    g.fillRect(0, 96, w, 5);
  });
  envTex.colorSpace = THREE.SRGBColorSpace;
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(gl);
  const envRT = pmrem.fromScene(envScene, 0.025);
  pmrem.dispose();
  disposeTree(envScene);
  const prevEnv = scene.environment,
    prevFog = scene.fog;
  scene.environment = envRT.texture;
  scene.fog = new THREE.Fog(0x121518, 160, 360);

  root.add(new THREE.HemisphereLight(0xc4d4e0, 0x1b1612, 0.25 * PI));
  const key = new THREE.DirectionalLight(0xfff8f0, 1.0 * PI);
  key.position.set(30, 70, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 20, far: 180 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  root.add(key);
  const rimWarm = new THREE.DirectionalLight(0xffc4a0, 0.55 * PI);
  rimWarm.position.set(-60, 20, -40);
  root.add(rimWarm);
  const rimCool = new THREE.DirectionalLight(0x9cc4ff, 0.45 * PI);
  rimCool.position.set(-40, 15, 50);
  root.add(rimCool);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25 * PI);
  fill.position.set(50, 5, -30);
  root.add(fill);

  /* ---------- Floor ---------- */
  {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.ShadowMaterial({ opacity: 0.45 }));
    sh.rotation.x = -PI / 2;
    sh.receiveShadow = true;
    root.add(sh);
    const floorMap = canvasTex(256, 256, (x, w, h) => {
      const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, 'rgba(150,165,178,.13)');
      g.addColorStop(1, 'rgba(150,165,178,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), new THREE.MeshBasicMaterial({ map: floorMap, transparent: true, depthWrite: false }));
    disc.rotation.x = -PI / 2;
    disc.position.y = -0.03;
    root.add(disc);
    const pts: number[] = [];
    const RR = 38;
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * PI * 2,
        b = ((i + 1) / 160) * PI * 2;
      pts.push(RR * Math.cos(a), 0, RR * Math.sin(a), RR * Math.cos(b), 0, RR * Math.sin(b));
    }
    for (let d = 0; d < 360; d += 5) {
      const a = d * RAD,
        l = d % 30 === 0 ? 1.8 : 0.7;
      pts.push(RR * Math.cos(a), 0, RR * Math.sin(a), (RR - l) * Math.cos(a), 0, (RR - l) * Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c343b })));
  }

  /* ---------- Body ---------- */
  const bodyG = new THREE.Group();
  root.add(bodyG);
  const paint = archCut(
    new THREE.MeshPhysicalMaterial({ color: 0x9ea6ad, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide }),
  );
  const glass = archCut(
    new THREE.MeshPhysicalMaterial({ color: 0x0c1116, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
  );
  const trim = archCut(new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0.4, roughness: 0.25, side: THREE.DoubleSide }));
  const headLamp = archCut(
    new THREE.MeshStandardMaterial({ color: 0x0e1114, metalness: 0.7, roughness: 0.12, emissive: 0x2c3540, emissiveIntensity: 1 }),
  );
  const tailLamp = archCut(new THREE.MeshStandardMaterial({ color: 0x3a0606, metalness: 0.3, roughness: 0.2, emissive: 0x9a1010, emissiveIntensity: 0.8 }));
  const solidBodyMats = [paint, glass, trim, headLamp, tailLamp];
  const bodyX = xrayMaterial(0x9fc8ee, 1);
  const shellGeo = bodyGeometry();
  const shell = add(bodyG, shellGeo, bodyX);
  shell.userData.aid = true;
  const bodyExtras = new THREE.Group(); // mirrors, grille, liners, trims: only in the painted body
  bodyG.add(bodyExtras);
  {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd6dade, metalness: 1, roughness: 0.12 });
    // grille + slats
    add(bodyExtras, rbox(0.3, 2.5, 6.8, 0.6, 0.1), trim, 23.82, 4.75, 0);
    for (let k = 0; k < 4; k++) add(bodyExtras, rbox(0.14, 0.12, 6.4, 0.05, 0.03), chrome, 23.98, 3.95 + k * 0.55, 0);
    add(bodyExtras, rbox(0.25, 0.9, 10.4, 0.4, 0.1), trim, 23.55, 2.95, 0);
    // mirrors
    for (const s of [1, -1]) {
      const mir = add(bodyExtras, rbox(1.3, 0.9, 1.6, 0.4, 0.2), paint, 6.0, 9.55, s * 10.1);
      mir.rotation.y = s * 0.12;
      add(bodyExtras, rbox(0.5, 0.25, 0.8, 0.1, 0.05), trim, 6.2, 9.15, s * 9.45);
      // tail-pipe trims in the bumper
      add(bodyExtras, rbox(0.25, 0.55, 2.4, 0.25, 0.08), chrome, -26.0, 2.9, s * 5.1);
    }
    for (const x of [AXLE_F, AXLE_R]) for (const s of [1, -1] as const) add(bodyExtras, archLiner(x, s), common.liner);
  }

  /* ---------- Interior (context only) ---------- */
  const cabin = new THREE.Group();
  bodyG.add(cabin);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.85 });
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7 });
  const cabinX = xrayMaterial(0x8fa4b8, 0.55);
  const cabinMeshes: THREE.Mesh[] = [];
  {
    const c = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
      const m = add(cabin, geo, mat, x, y, z);
      m.rotation.z = rz;
      m.userData.solidMat = mat;
      cabinMeshes.push(m);
      return m;
    };
    for (const s of [1, -1]) {
      c(rbox(4.4, 0.9, 4.6, 0.4, 0.3), seatMat, -1.4, 4.6, s * 3.6);
      c(rbox(1.0, 5.6, 4.4, 0.5, 0.3), seatMat, -3.9, 7.7, s * 3.6, 0.22);
      c(rbox(0.8, 1.1, 2.6, 0.3, 0.2), seatMat, -4.6, 10.9, s * 3.6, 0.22);
    }
    c(rbox(4.6, 1.0, 12.6, 0.4, 0.3), seatMat, -10.0, 4.8, 0);
    c(rbox(1.0, 5.0, 12.6, 0.5, 0.3), seatMat, -12.4, 7.9, 0, 0.3);
    c(rbox(3.4, 2.0, 15.4, 0.8, 0.4), dashMat, 5.0, 7.8, 0, -0.12);
    c(rbox(4.0, 1.4, 1.8, 0.4, 0.2), dashMat, 1.6, 4.4, 0);
    const wheel = c(new THREE.TorusGeometry(1.75, 0.17, 10, 40), dashMat, 2.4, 8.3, -3.6);
    wheel.rotation.set(0, PI / 2, 0.42);
    wheel.rotation.order = 'YZX';
    c(cylX(0.18, 2.6), dashMat, 3.6, 8.7, -3.6, -0.42);
  }

  /* ---------- Chassis: wheels, brakes, suspension (always shown) ---------- */
  const chassis = new THREE.Group();
  root.add(chassis);
  const wheels: THREE.Group[] = [];
  const wheelHubs: { g: THREE.Group; side: number }[] = [];
  {
    const tyreGeo = (w: number) => {
      const pts: THREE.Vector2[] = [];
      const R = WHEEL_R,
        r = 2.41,
        h = w / 2;
      const prof: [number, number][] = [
        [r - 0.05, -h + 0.15],
        [r + 0.25, -h],
        [R - 0.35, -h + 0.02],
        [R - 0.06, -h + 0.25],
        [R, -h + 0.6],
        [R, h - 0.6],
        [R - 0.06, h - 0.25],
        [R - 0.35, h - 0.02],
        [r + 0.25, h],
        [r - 0.05, h - 0.15],
      ];
      prof.forEach(([a, b]) => pts.push(new THREE.Vector2(a, b)));
      return new THREE.LatheGeometry(pts, low ? 36 : 56).rotateX(PI / 2);
    };
    const rimGeo = (w: number) => {
      const g = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, w - 0.3, low ? 28 : 44, 1, true).rotateX(PI / 2), common.rimIn);
      g.add(barrel);
      const hub = new THREE.Mesh(cylZ(0.55, 0.4), common.rim);
      hub.position.z = w / 2 - 0.35;
      g.add(hub);
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(rbox(0.42, 1.95, 0.22, 0.12, 0.06), common.rim);
        sp.position.set(0, 1.35, w / 2 - 0.35);
        const piv = new THREE.Group();
        piv.rotation.z = (k / 5) * PI * 2;
        piv.add(sp);
        g.add(piv);
      }
      return g;
    };
    const axles: [number, number, number][] = [
      [AXLE_F, TRACK_F / 2 + 4.05, 2.45],
      [AXLE_R, TRACK_R / 2 + 4.0, 2.75],
    ];
    for (const [x, , w] of axles) {
      const track = x > 0 ? TRACK_F : TRACK_R;
      for (const s of [1, -1]) {
        const hubG = new THREE.Group();
        hubG.position.set(x, WHEEL_R, (s * track) / 2);
        chassis.add(hubG);
        wheelHubs.push({ g: hubG, side: s });
        const spin = new THREE.Group();
        hubG.add(spin);
        // the outer face points away from the car
        spin.scale.z = s;
        const tyre = new THREE.Mesh(tyreGeo(w), common.tyre);
        spin.add(tyre);
        const rim = rimGeo(w);
        spin.add(rim);
        wheels.push(spin);
        if (x < 0) {
          tyre.userData.part = 'wheels';
          pickables.push(tyre);
        }
        const disc = new THREE.Mesh(cylZ(1.8, 0.28, 36), common.disc);
        disc.position.z = -s * 0.35;
        hubG.add(disc);
        const cal = new THREE.Mesh(rbox(1.1, 1.3, 0.75, 0.3, 0.15), common.caliper);
        cal.position.set(x > 0 ? 1.2 : -1.2, 1.1, -s * 0.35);
        hubG.add(cal);
        // knuckle + arms
        tube(chassis, [[x, 2.5, s * (track / 2 - 0.9)], [x + 0.4, 2.3, s * 4.4], [x + 1.0, 2.4, s * 2.6]], 0.16, common.steel, 8);
        tube(chassis, [[x, 5.4, s * (track / 2 - 1.1)], [x - 0.3, 5.6, s * 5.0], [x - 0.6, 5.5, s * 3.6]], 0.13, common.steel, 8);
        // spring/damper
        add(chassis, cylY(0.32, 3.6, 12), common.steel, x - (x > 0 ? 0.6 : -0.4), 5.4, s * (track / 2 - 1.5));
      }
    }
    // subframes, steering rack
    add(chassis, rbox(3.6, 0.5, 9.0, 0.4, 0.15), common.steel, AXLE_F + 0.6, 2.3, 0);
    add(chassis, cylZ(0.28, 8.2, 14), common.steel, AXLE_F + 1.6, 3.0, 0);
    add(chassis, rbox(3.8, 0.5, 9.6, 0.4, 0.15), common.steel, AXLE_R, 2.1, 0);
  }

  /* ---------- Engine (M254 2.0 turbo, longitudinal) ---------- */
  const engG = new THREE.Group();
  root.add(engG);
  const blockMat = M('engine', { color: 0x9aa0a6, metalness: 0.55, roughness: 0.5 }, 'shell');
  const coverMat = M('engine', { color: 0x1a1b1e, metalness: 0.2, roughness: 0.55 }, 'shell');
  add(engG, rbox(4.7, 3.3, 3.0, 0.4, 0.2), blockMat, 15.0, 4.6, 0, 'engine');
  add(engG, rbox(4.8, 1.0, 3.2, 0.3, 0.15), blockMat, 15.0, 6.75, 0, 'engine');
  add(engG, rbox(4.6, 0.65, 2.5, 0.3, 0.2), coverMat, 15.0, 7.55, 0, 'engine');
  add(engG, rbox(0.45, 4.2, 2.7, 0.4, 0.15), blockMat, 17.55, 5.0, 0, 'engine');
  const pulMat = M('engine', { color: 0x2b2d31, metalness: 0.6, roughness: 0.4 });
  add(engG, cylX(0.75, 0.3), pulMat, 17.95, CRANK_Y, 0, 'engine');

  // moving parts inside: crank, rods, pistons
  const pistonMat = M('pistons', { color: 0xc9ccd0, metalness: 0.8, roughness: 0.3 });
  const rodMat = M('pistons', { color: 0x7d8288, metalness: 0.8, roughness: 0.35 });
  const crank = new THREE.Group();
  crank.position.set(0, CRANK_Y, 0);
  engG.add(crank);
  add(crank, cylX(0.24, 4.6), rodMat, 15.0, 0, 0, 'pistons');
  CYL_X.forEach((x, i) => {
    const a = PIN[i] * RAD;
    const pin = add(crank, cylX(0.2, 0.36), rodMat, x, CR * Math.cos(a), CR * Math.sin(a), 'pistons');
    pin.userData.pin = true;
    for (const dx of [-0.24, 0.24]) {
      const w = add(crank, rbox(0.12, 1.3, 0.9, 0.3, 0.04), rodMat, x + dx, 0, 0, 'pistons');
      w.rotation.x = -a;
    }
  });
  const pistons = CYL_X.map((x) => add(engG, cylY(0.4, 0.55, 24), pistonMat, x, 5, 0, 'pistons'));
  const rods = CYL_X.map((x) => add(engG, rbox(0.14, ROD, 0.22, 0.05, 0.03), rodMat, x, 4, 0, 'pistons'));

  // ISG between engine and gearbox
  const isgMat = M('isg', { color: 0x3a3f45, metalness: 0.6, roughness: 0.45 });
  add(engG, cylX(1.85, 0.75, 40), isgMat, 12.25, CRANK_Y, 0, 'isg');
  pipe(engG, 'isg', [[12.2, 5.1, -0.8], [11.6, 5.6, -2.2], [10.4, 4.0, -2.9], [9.5, 2.6, -3.4]], 0.12, M('isg', { color: 0xe36a12, roughness: 0.5 }), 20);

  /* ---------- Transmission: 9G-TRONIC, propshaft, differential, half-shafts ---------- */
  const trG = new THREE.Group();
  root.add(trG);
  const caseMat = M('gearbox', { color: 0x8e959b, metalness: 0.6, roughness: 0.45 });
  {
    const cone = (r0: number, r1: number, x0: number, x1: number) =>
      new THREE.CylinderGeometry(r1, r0, x0 - x1, 36).rotateZ(-PI / 2).translate((x0 + x1) / 2, 0, 0);
    add(trG, cone(1.85, 1.55, 11.85, 10.3), caseMat, 0, CRANK_Y, 0, 'gearbox');
    add(trG, cone(1.55, 1.2, 10.3, 5.6), caseMat, 0, CRANK_Y, 0, 'gearbox');
    add(trG, cone(0.75, 0.5, 5.6, 4.3), caseMat, 0, CRANK_Y, 0, 'gearbox');
    add(trG, rbox(4.2, 0.6, 2.2, 0.3, 0.1), M('gearbox', { color: 0x2b2e33, metalness: 0.4, roughness: 0.6 }), 8.0, 1.95, 0, 'gearbox');
  }
  const shaftMat = M('propshaft', { color: 0x5a6068, metalness: 0.75, roughness: 0.35 });
  const stripeMat = M('propshaft', { color: 0xb07cff, metalness: 0.3, roughness: 0.5, emissive: 0x2a1450 });
  const PROP_Y = 3.4;
  const prop: THREE.Group[] = [];
  for (const [x0, x1] of [
    [4.3, -5.3],
    [-5.3, -13.45],
  ]) {
    const g = new THREE.Group();
    g.position.set((x0 + x1) / 2, PROP_Y, 0);
    trG.add(g);
    add(g, cylX(0.3, x0 - x1 - 0.4, 20), shaftMat, 0, 0, 0, 'propshaft');
    add(g, rbox(x0 - x1 - 1.4, 0.12, 0.12, 0.04, 0.02), stripeMat, 0, 0.3, 0, 'propshaft');
    for (const e of [x0, x1]) add(g, cylX(0.45, 0.3, 20), shaftMat, e - (x0 + x1) / 2 + (e === x0 ? -0.2 : 0.2), 0, 0, 'propshaft');
    prop.push(g);
  }
  add(trG, rbox(0.7, 0.9, 1.6, 0.3, 0.1), M('propshaft', { color: 0x222428, roughness: 0.7 }), -5.3, PROP_Y - 0.1, 0, 'propshaft');
  const diffMat = M('diff', { color: 0x7f868d, metalness: 0.6, roughness: 0.5 });
  add(trG, new THREE.SphereGeometry(1.3, 28, 18), diffMat, AXLE_R, 3.5, 0, 'diff');
  add(trG, cylX(1.05, 0.5, 28), diffMat, AXLE_R - 1.25, 3.5, 0, 'diff');
  add(trG, cylX(0.5, 1.1, 20), diffMat, AXLE_R + 1.2, 3.5, 0, 'diff');
  const halfMat = M('wheels', { color: 0x5c6269, metalness: 0.7, roughness: 0.4 });
  const bootMat = M('wheels', { color: 0x141518, roughness: 0.8 });
  const halfShafts: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const g = new THREE.Group();
    g.position.set(AXLE_R, WHEEL_R, s * 4.2);
    trG.add(g);
    add(g, cylZ(0.2, 5.0, 14), halfMat, 0, 0, 0, 'wheels');
    add(g, rbox(0.1, 0.5, 0.1, 0.03, 0.02), stripeMat, 0, 0.22, 0, 'wheels');
    for (const e of [-2.5, 2.5]) add(g, new THREE.CylinderGeometry(0.28, 0.45, 0.8, 16).rotateX(e > 0 ? PI / 2 : -PI / 2), bootMat, 0, 0, e * 0.9, 'wheels');
    halfShafts.push(g);
  }

  /* ---------- Intake: snorkel, air box, turbo compressor, intercooler, manifold ---------- */
  const inG = new THREE.Group();
  root.add(inG);
  const blackPl = (part: string) => M(part, { color: 0x1b1d20, roughness: 0.7, metalness: 0.1 });
  add(inG, rbox(3.2, 1.4, 2.4, 0.4, 0.2), blackPl('airfilter'), 18.1, 6.95, 5.2, 'airfilter');
  pipe(inG, 'airfilter', [[22.0, 7.3, 4.4], [21.0, 7.25, 4.7], [19.8, 7.05, 5.0]], 0.42, blackPl('airfilter'), 12);
  pipe(inG, 'airfilter', [[16.4, 6.85, 5.1], [14.6, 6.75, 4.8], [13.2, 6.3, 4.6], [12.45, 5.6, 4.6]], 0.36, pipeMat('airfilter', undefined, 0.5), 24);
  const turboMat = M('turbo', { color: 0xa9b0b6, metalness: 0.75, roughness: 0.35 });
  add(inG, new THREE.TorusGeometry(0.55, 0.3, 12, 28), turboMat, 12.4, 5.3, 4.0, 'turbo');
  add(inG, cylZ(0.42, 0.6, 20), turboMat, 12.4, 5.3, 4.3, 'turbo');
  add(inG, cylZ(0.3, 0.6, 16), M('turbo', { color: 0x4d5258, metalness: 0.7, roughness: 0.4 }), 12.4, 5.3, 3.45, 'turbo');
  pipe(inG, 'intercooler', [[12.6, 5.95, 3.9], [13.8, 5.4, 4.9], [15.5, 4.2, 5.8], [18.2, 2.9, 6.0], [20.8, 2.4, 5.6], [21.8, 2.5, 4.9]], 0.3, pipeMat('intercooler', 0xffa36a, 0.45), 40);
  const icMat = M('intercooler', { color: 0x6f777f, metalness: 0.7, roughness: 0.45 });
  add(inG, rbox(0.55, 1.4, 9.6, 0.15, 0.08), icMat, 22.0, 2.6, 0, 'intercooler');
  pipe(inG, 'manifold', [[21.8, 2.6, -4.9], [20.6, 2.6, -5.7], [17.8, 3.4, -5.4], [15.6, 5.2, -4.0], [14.4, 5.95, -3.15]], 0.3, pipeMat('manifold', undefined, 0.45), 36);
  const manMat = M('manifold', { color: 0x2a2d31, metalness: 0.3, roughness: 0.6 });
  add(inG, cylX(0.42, 0.55, 20), M('manifold', { color: 0x8e959b, metalness: 0.7, roughness: 0.4 }), 14.1, 6.0, -3.0, 'manifold');
  add(inG, rbox(3.9, 0.95, 1.0, 0.3, 0.15), manMat, 15.2, 6.05, -2.7, 'manifold');
  CYL_X.forEach((x) => pipe(inG, 'manifold', [[x, 6.05, -2.4], [x, 6.4, -1.9], [x, 6.55, -1.55]], 0.2, manMat, 6));

  /* ---------- Exhaust ---------- */
  const exG = new THREE.Group();
  root.add(exG);
  const hotMat = M('exmanifold', { color: 0x6b5a4c, metalness: 0.7, roughness: 0.5, emissive: 0x2a0c02 });
  CYL_X.forEach((x) => pipe(exG, 'exmanifold', [[x, 6.55, 1.55], [x, 6.3, 2.2], [(x + 13.0) / 2, 5.9, 2.6], [12.9, 5.45, 2.8]], 0.2, hotMat, 14));
  add(exG, new THREE.TorusGeometry(0.5, 0.28, 12, 28), hotMat, 12.4, 5.3, 2.75, 'exmanifold');
  add(exG, cylZ(0.4, 0.5, 18), hotMat, 12.4, 5.3, 2.65, 'exmanifold');
  const catMat = M('cat', { color: 0x9aa1a7, metalness: 0.8, roughness: 0.3 });
  pipe(exG, 'cat', [[12.1, 4.95, 2.6], [11.8, 4.5, 2.55], [11.5, 4.1, 2.5]], 0.3, catMat, 8);
  add(exG, cylX(0.78, 2.4, 24), catMat, 10.25, 3.95, 2.45, 'cat');
  add(exG, new THREE.SphereGeometry(0.78, 20, 12, 0, PI * 2, 0, PI / 2).rotateZ(-PI / 2), catMat, 11.45, 3.95, 2.45, 'cat');
  add(exG, new THREE.SphereGeometry(0.78, 20, 12, 0, PI * 2, 0, PI / 2).rotateZ(PI / 2), catMat, 9.05, 3.95, 2.45, 'cat');
  const exPipeMat = M('midmuffler', { color: 0x8a9096, metalness: 0.8, roughness: 0.35 });
  const EX_LINE = [
    [8.6, 3.85, 2.4],
    [7.0, 2.7, 1.9],
    [4.0, 2.15, 1.5],
    [-2.0, 2.1, 1.45],
  ];
  pipe(exG, 'midmuffler', EX_LINE, 0.27, exPipeMat, 30);
  const mufMat = M('midmuffler', { color: 0x9da3a9, metalness: 0.8, roughness: 0.35 });
  const mid = add(exG, cylX(0.75, 4.4, 28), mufMat, -4.4, 2.2, 1.45, 'midmuffler');
  mid.scale.set(1, 0.75, 1.35);
  const rearPipeMat = M('rearmuffler', { color: 0x8a9096, metalness: 0.8, roughness: 0.35 });
  pipe(exG, 'rearmuffler', [[-6.7, 2.2, 1.45], [-10.5, 2.3, 1.7], [-14.0, 2.45, 2.05], [-17.5, 2.5, 1.7], [-20.4, 2.6, 1.3]], 0.27, rearPipeMat, 36);
  add(exG, rbox(2.5, 1.3, 9.0, 0.6, 0.2), M('rearmuffler', { color: 0x9da3a9, metalness: 0.8, roughness: 0.35 }), -21.8, 2.6, 0, 'rearmuffler');
  for (const s of [1, -1]) pipe(exG, 'rearmuffler', [[-22.6, 2.6, s * 4.2], [-24.2, 2.55, s * 4.9], [-25.7, 2.75, s * 5.1]], 0.24, rearPipeMat, 12);

  /* ---------- Cooling ---------- */
  const coG = new THREE.Group();
  root.add(coG);
  const finTex = canvasTex(64, 64, (x, w, h) => {
    x.fillStyle = '#7f878f';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#4d545b';
    for (let i = 0; i < w; i += 4) x.fillRect(i, 0, 2, h);
    x.fillStyle = 'rgba(0,0,0,.35)';
    for (let j = 0; j < h; j += 16) x.fillRect(0, j, w, 2);
  }, [14, 4]);
  const radMat = M('radiator', { color: 0xffffff, map: finTex, metalness: 0.6, roughness: 0.5 });
  add(coG, rbox(0.5, 3.8, 12.2, 0.1, 0.05), radMat, 20.6, 4.9, 0, 'radiator');
  const tankMat = M('radiator', { color: 0x1d1f22, roughness: 0.7 });
  for (const s of [1, -1]) add(coG, rbox(0.75, 3.9, 0.6, 0.15, 0.08), tankMat, 20.6, 4.9, s * 6.4, 'radiator');
  const fanMat = M('fan', { color: 0x1c1e21, roughness: 0.65 });
  add(coG, new THREE.TorusGeometry(1.95, 0.12, 8, 40).rotateY(PI / 2), fanMat, 19.9, 4.9, 0, 'fan');
  const fan = new THREE.Group();
  fan.position.set(19.75, 4.9, 0);
  coG.add(fan);
  add(fan, cylX(0.45, 0.4, 20), fanMat, 0, 0, 0, 'fan');
  for (let k = 0; k < 7; k++) {
    const piv = new THREE.Group();
    piv.rotation.x = (k / 7) * PI * 2;
    fan.add(piv);
    const b = add(piv, rbox(0.06, 1.45, 0.7, 0.2, 0.02), fanMat, 0, 1.15, 0, 'fan');
    b.rotation.y = 0.5;
  }
  const pumpMat = M('pump', { color: 0x8a9198, metalness: 0.6, roughness: 0.45 });
  add(coG, cylX(0.5, 0.55, 20), pumpMat, 17.95, 4.75, -0.85, 'pump');
  add(coG, cylX(0.45, 0.12, 20), M('pump', { color: 0x2b2d31, metalness: 0.5, roughness: 0.5 }), 18.3, 4.75, -0.85, 'pump');
  const thMat = M('thermostat', { color: 0x9aa1a7, metalness: 0.6, roughness: 0.45 });
  add(coG, cylY(0.36, 0.6, 18), thMat, 17.75, 6.6, 0.9, 'thermostat');
  // hot hose (engine → radiator) and cold hose (radiator → pump)
  const hotHose = pipeMat('radiator', 0xd84a3a, 0.5);
  const coldHose = pipeMat('pump', 0x3f7cff, 0.5);
  const UPPER = [
    [17.75, 6.85, 1.1],
    [18.6, 7.05, 2.4],
    [19.6, 6.85, 4.6],
    [20.35, 6.4, 6.2],
  ];
  const LOWER = [
    [20.35, 3.4, -6.2],
    [19.5, 3.3, -4.2],
    [18.6, 3.9, -2.0],
    [18.1, 4.6, -1.15],
  ];
  pipe(coG, 'radiator', UPPER, 0.26, hotHose, 20);
  pipe(coG, 'pump', LOWER, 0.26, coldHose, 20);
  pipe(coG, 'thermostat', [[17.85, 6.3, 0.6], [18.2, 5.8, 0.0], [18.2, 5.2, -0.6], [18.0, 4.95, -0.85]], 0.13, pipeMat('thermostat', 0xd84a3a, 0.5), 10);
  // heater circuit through the firewall
  const HEAT_OUT = [
    [12.9, 6.9, -0.8],
    [11.4, 7.3, -1.2],
    [9.6, 7.25, -1.3],
    [7.7, 7.0, -1.0],
  ];
  const HEAT_BACK = [
    [7.7, 6.4, -1.7],
    [9.6, 5.2, -2.3],
    [12.0, 4.5, -2.3],
    [16.0, 4.2, -2.1],
    [17.7, 4.55, -1.3],
  ];
  pipe(coG, 'exptank', HEAT_OUT, 0.15, pipeMat('exptank', 0xd84a3a, 0.45), 20);
  pipe(coG, 'exptank', HEAT_BACK, 0.15, pipeMat('exptank', 0x6b8cff, 0.45), 24);
  add(coG, rbox(1.7, 1.2, 1.5, 0.4, 0.2), M('exptank', { color: 0xe6e2d6, roughness: 0.4, transparent: true, opacity: 0.75 }), 17.8, 7.55, -5.6, 'exptank');
  pipe(coG, 'exptank', [[17.4, 7.0, -4.9], [17.5, 7.2, -2.5], [17.7, 6.95, 0.4]], 0.09, pipeMat('exptank', 0xc9d4e8, 0.45), 12);

  /* ---------- Lubrication ---------- */
  const luG = new THREE.Group();
  root.add(luG);
  const sumpMat = M('sump', { color: 0x9aa0a6, metalness: 0.55, roughness: 0.5 }, 'shell');
  add(luG, rbox(4.4, 1.0, 2.8, 0.35, 0.15), sumpMat, 15.0, 2.45, 0, 'sump');
  add(luG, cylX(0.36, 0.7, 18), M('sump', { color: 0xd9a441, metalness: 0.5, roughness: 0.4 }), 16.9, 2.75, 0.6, 'sump');
  const filtMat = M('oilfilter', { color: 0x2b3a5c, metalness: 0.4, roughness: 0.4 });
  add(luG, cylY(0.42, 1.2, 22), filtMat, 15.8, 4.6, 2.0, 'oilfilter');
  add(luG, cylY(0.46, 0.18, 22), M('oilfilter', { color: 0x1c1d20, roughness: 0.5 }), 15.8, 5.25, 2.0, 'oilfilter');
  const pcvMat = M('pcv', { color: 0x202226, roughness: 0.6 });
  add(luG, rbox(0.9, 0.5, 0.9, 0.2, 0.1), pcvMat, 13.3, 7.75, 1.3, 'pcv');
  pipe(luG, 'pcv', [[13.3, 7.95, 1.75], [13.2, 7.85, 3.0], [13.4, 7.2, 4.2], [13.5, 6.75, 4.55]], 0.11, pipeMat('pcv', 0x9ab0c8, 0.5), 14);
  // galleries drawn as thin translucent ducts inside the block
  const galMat = pipeMat('galleries', 0xe3a52a, 0.3);
  const OIL_MAIN = [
    [17.0, 2.2, 0.0],
    [16.95, 2.7, 0.55],
    [16.6, 3.9, 1.3],
    [16.1, 4.4, 1.85],
    [15.5, 4.1, 1.6],
    [15.0, 3.95, 0.9],
    [12.9, 3.95, 0.9],
  ];
  const OIL_RISE = [
    [16.95, 3.95, 0.9],
    [17.0, 5.5, 1.1],
    [16.95, 6.9, 0.7],
    [15.0, 7.1, 0.65],
    [12.9, 7.1, 0.65],
  ];
  const OIL_DRAIN = [
    [13.1, 7.0, -0.9],
    [13.05, 5.2, -1.35],
    [13.15, 3.2, -1.2],
    [13.6, 2.35, -0.6],
    [15.5, 2.2, 0.0],
  ];
  pipe(luG, 'galleries', OIL_MAIN, 0.1, galMat, 30);
  pipe(luG, 'galleries', OIL_RISE, 0.1, galMat, 30);

  /* ---------- Cabin ventilation / HVAC ---------- */
  const hvG = new THREE.Group();
  root.add(hvG);
  add(hvG, rbox(1.0, 0.45, 13.0, 0.2, 0.1), M('cowl', { color: 0x16181b, roughness: 0.7 }), 8.35, 8.95, 0, 'cowl');
  add(hvG, rbox(0.85, 0.22, 1.6, 0.05, 0.05), M('cowl', { color: 0xe8e4d8, roughness: 0.8 }), 7.55, 7.85, 3.6, 'cowl');
  const hvacMat = M('hvac', { color: 0x2a2d31, roughness: 0.65 }, 'shell');
  add(hvG, rbox(2.8, 2.2, 5.0, 0.4, 0.15), hvacMat, 6.6, 6.9, 0.4, 'hvac');
  add(hvG, cylY(0.95, 1.0, 26), hvacMat, 6.8, 6.6, 3.6, 'hvac');
  const coreMat = M('hvac', { color: 0xffffff, map: finTex, metalness: 0.5, roughness: 0.5 });
  add(hvG, rbox(0.25, 1.6, 2.4, 0.05, 0.03), coreMat, 7.3, 6.9, -0.6, 'hvac');
  add(hvG, rbox(0.25, 1.6, 2.4, 0.05, 0.03), M('hvac', { color: 0xb7d8f0, map: finTex, metalness: 0.5, roughness: 0.5 }), 6.6, 6.9, 0.6, 'hvac');
  const ventMat = M('vents', { color: 0xc8ccd0, metalness: 0.8, roughness: 0.25 });
  for (const s of [1, -1]) {
    add(hvG, rbox(0.3, 0.45, 1.0, 0.1, 0.05), ventMat, 3.45, 8.25, s * 0.9, 'vents');
    add(hvG, rbox(0.3, 0.6, 0.6, 0.15, 0.05), ventMat, 4.05, 8.35, s * 7.6, 'vents');
    pipe(hvG, 'vents', [[5.6, 7.6, s * 0.6], [4.4, 8.15, s * 0.85], [3.6, 8.25, s * 0.9]], 0.24, pipeMat('vents', undefined, 0.3), 10);
    pipe(hvG, 'vents', [[6.0, 7.5, s * 2.6], [5.4, 7.9, s * 5.0], [4.2, 8.35, s * 7.4]], 0.24, pipeMat('vents', undefined, 0.3), 12);
    pipe(hvG, 'vents', [[5.6, 6.0, s * 1.4], [5.2, 5.2, s * 2.2], [4.6, 4.8, s * 2.6]], 0.24, pipeMat('vents', undefined, 0.3), 10);
    add(hvG, rbox(0.4, 1.0, 1.5, 0.2, 0.06), M('rearvents', { color: 0x16181b, roughness: 0.7 }), -25.2, 4.3, s * 7.3, 'rearvents');
  }
  add(hvG, rbox(0.6, 0.15, 7.0, 0.05, 0.03), ventMat, 6.4, 9.0, 0, 'vents');
  // A/C: compressor on the belt, condenser in front of the radiator, lines to the evaporator
  const acMat = M('ac', { color: 0x8f969c, metalness: 0.65, roughness: 0.4 });
  add(hvG, cylX(0.6, 1.6, 22), acMat, 16.85, 3.25, 2.3, 'ac');
  add(hvG, cylX(0.5, 0.25, 22), M('ac', { color: 0x2b2d31, metalness: 0.5, roughness: 0.5 }), 17.85, 3.25, 2.3, 'ac');
  add(hvG, rbox(0.22, 3.6, 12.0, 0.08, 0.04), M('ac', { color: 0xffffff, map: finTex, metalness: 0.5, roughness: 0.55, transparent: true, opacity: 0.85 }), 21.2, 4.9, 0, 'ac');
  const acLine = M('ac', { color: 0x9aa1a7, metalness: 0.8, roughness: 0.3 });
  pipe(hvG, 'ac', [[16.2, 3.6, 2.6], [17.5, 3.2, 4.6], [20.0, 3.2, 6.2], [21.1, 3.3, 6.3]], 0.08, acLine, 16);
  pipe(hvG, 'ac', [[21.1, 6.3, 6.2], [18.0, 7.3, 6.6], [12.0, 7.8, 3.0], [9.4, 7.6, 1.6], [7.8, 7.2, 1.0]], 0.08, acLine, 24);

  /* ---------- Particles ---------- */
  const C = (hex: number) => new THREE.Color(hex);
  const ramp = (stops: [number, number][]) => (u: number, out: THREE.Color) => {
    let i = 0;
    while (i < stops.length - 2 && u > stops[i + 1][0]) i++;
    const [u0, c0] = stops[i],
      [u1, c1] = stops[i + 1];
    return out.copy(C(c0)).lerp(C(c1), Math.min(1, Math.max(0, (u - u0) / (u1 - u0))));
  };
  const flat = (hex: number) => (_u: number, out: THREE.Color) => out.setHex(hex);
  const curve = (pts: number[][], closed = false) =>
    new THREE.CatmullRomCurve3(
      pts.map((p) => V3(p[0], p[1], p[2])),
      closed,
      'catmullrom',
      0.3,
    );
  const K = low ? 0.6 : 1;
  const n = (c: number) => Math.max(6, Math.round(c * K));
  const defs: (FlowPathDef & { sys: string; key: string })[] = [];
  const flow = (sys: string, key: string, d: FlowPathDef) => defs.push({ ...d, sys, key });

  // intake air: cold → compressed (warm) → cooled → into the ports
  flow('admisie', 'airIn', {
    curve: curve([[23.2, 7.3, 4.3], [21.0, 7.25, 4.7], [19.6, 7.0, 5.0], [18.0, 6.95, 5.2], [16.4, 6.85, 5.1], [14.6, 6.75, 4.8], [13.2, 6.3, 4.6], [12.45, 5.6, 4.6], [12.4, 5.3, 4.1]]),
    count: n(70), speed: 7, size: 0.224, spread: 0.18, color: flat(0x7fd8f5),
  });
  flow('admisie', 'charge', {
    curve: curve([[12.6, 5.95, 3.9], [13.8, 5.4, 4.9], [15.5, 4.2, 5.8], [18.2, 2.9, 6.0], [20.8, 2.4, 5.6], [21.9, 2.5, 4.6], [22.0, 2.6, 0], [21.9, 2.6, -4.6], [20.6, 2.6, -5.7], [17.8, 3.4, -5.4], [15.6, 5.2, -4.0], [14.4, 5.95, -3.15], [15.2, 6.05, -2.7]]),
    count: n(130), speed: 9, size: 0.224, spread: 0.16,
    color: ramp([[0, 0xffa060], [0.42, 0xffb070], [0.62, 0x7fd8f5], [1, 0x7fd8f5]]),
  });
  CYL_X.forEach((x, i) =>
    flow('admisie', 'port' + i, { curve: curve([[15.2, 6.05, -2.7], [x, 6.1, -2.4], [x, 6.4, -1.9], [x, 6.55, -1.4]]), count: n(10), speed: 3, size: 0.196, spread: 0.08, color: flat(0x7fd8f5) }),
  );
  // exhaust
  CYL_X.forEach((x, i) =>
    flow('evacuare', 'runner' + i, { curve: curve([[x, 6.55, 1.55], [x, 6.3, 2.2], [(x + 13.0) / 2, 5.9, 2.6], [12.9, 5.45, 2.8], [12.4, 5.3, 2.75]]), count: n(14), speed: 4, size: 0.238, spread: 0.08, color: flat(0xff7a2e) }),
  );
  flow('evacuare', 'exMain', {
    curve: curve([[12.4, 5.3, 2.7], [12.1, 4.95, 2.6], [11.5, 4.1, 2.5], [10.25, 3.95, 2.45], [9.0, 3.95, 2.45], ...EX_LINE, [-4.4, 2.2, 1.45], [-6.7, 2.2, 1.45], [-10.5, 2.3, 1.7], [-14.0, 2.45, 2.05], [-17.5, 2.5, 1.7], [-20.4, 2.6, 1.3], [-21.8, 2.6, 0]]),
    count: n(260), speed: 11, size: 0.252, spread: 0.14,
    color: ramp([[0, 0xff6a20], [0.08, 0xff8a3a], [0.2, 0xe08050], [0.5, 0x9a8a80], [1, 0x7d7a78]]),
  });
  for (const s of [1, -1])
    flow('evacuare', 'tail' + s, { curve: curve([[-21.8, 2.6, 0], [-22.0, 2.6, s * 2.5], [-22.6, 2.6, s * 4.2], [-24.2, 2.55, s * 4.9], [-25.7, 2.75, s * 5.1], [-27.6, 3.0, s * 5.3]]), count: n(36), speed: 6, size: 0.28, spread: 0.12, color: flat(0x8a8784) });

  // cooling: small loop (always), big loop through the radiator (thermostat), heater loop
  const JACKET = [
    [18.1, 4.7, -0.9],
    [17.2, 4.6, -0.7],
    [15.0, 4.8, -1.05],
    [13.0, 4.8, -0.95],
    [12.85, 6.3, 0.0],
    [15.0, 6.6, 0.45],
    [17.3, 6.65, 0.75],
    [17.75, 6.75, 0.95],
  ];
  flow('racire', 'small', {
    curve: curve([...JACKET, [17.85, 6.3, 0.6], [18.2, 5.8, 0.0], [18.2, 5.2, -0.6]], true),
    count: n(70), speed: 4.5, size: 0.21, spread: 0.12, loop: true, color: ramp([[0, 0xff7a50], [1, 0xff5a40]]),
  });
  flow('racire', 'big', {
    curve: curve([...JACKET, ...UPPER, [20.6, 6.0, 4.0], [20.6, 5.2, 1.0], [20.6, 4.4, -2.0], [20.6, 3.6, -5.0], ...LOWER], true),
    count: n(200), speed: 7, size: 0.224, spread: 0.12, loop: true,
    color: ramp([[0, 0x6aa0ff], [0.18, 0xff5a40], [0.5, 0xff5a40], [0.62, 0xb070c0], [0.75, 0x4f86ff], [1, 0x4f86ff]]),
  });
  flow('racire', 'heater', {
    curve: curve([...HEAT_OUT, [7.3, 6.9, -0.6], ...HEAT_BACK]),
    count: n(70), speed: 5, size: 0.196, spread: 0.08,
    color: ramp([[0, 0xff5a40], [0.4, 0xff5a40], [0.6, 0xc06a80], [1, 0x6a90ff]]),
  });
  // lubrication
  flow('lubrifiere', 'oilMain', { curve: curve(OIL_MAIN), count: n(60), speed: 3.5, size: 0.182, spread: 0.06, color: flat(0xf0b030) });
  flow('lubrifiere', 'oilRise', { curve: curve(OIL_RISE), count: n(50), speed: 3.5, size: 0.168, spread: 0.06, color: flat(0xf0b030) });
  flow('lubrifiere', 'oilDrain', { curve: curve(OIL_DRAIN), count: n(40), speed: 2.2, size: 0.21, spread: 0.18, color: flat(0xc88a20) });
  CYL_X.forEach((x, i) =>
    flow('lubrifiere', 'oilJet' + i, { curve: curve([[x, 3.95, 0.9], [x, 3.7, 0.4], [x, CRANK_Y, 0]]), count: n(6), speed: 1.5, size: 0.154, spread: 0.05, color: flat(0xf0b030) }),
  );
  flow('lubrifiere', 'pcv', { curve: curve([[14.6, 7.6, 0.3], [13.3, 7.75, 1.3], [13.3, 7.95, 1.75], [13.2, 7.85, 3.0], [13.4, 7.2, 4.2], [13.5, 6.75, 4.55], [12.45, 5.6, 4.6]]), count: n(24), speed: 2.5, size: 0.168, spread: 0.06, color: flat(0x9ab0c8) });

  // cabin air: fresh air in, conditioned air out of the vents (cool/warm), out through the rear vents
  const PRE = [
    [8.6, 9.3, 4.6],
    [8.3, 8.95, 4.0],
    [7.6, 7.9, 3.7],
    [6.9, 6.8, 3.5],
    [6.6, 6.7, 2.0],
    [6.9, 6.9, 0.6],
    [7.3, 6.9, -0.6],
    [6.2, 6.9, -0.2],
  ];
  flow('ventilatie', 'fresh', { curve: curve(PRE), count: n(60), speed: 4, size: 0.238, spread: 0.2, color: flat(0xcfe8f0) });
  const OUT: number[][][] = [];
  for (const s of [1, -1]) {
    OUT.push([[6.2, 6.9, 0], [5.6, 7.6, s * 0.6], [4.4, 8.15, s * 0.85], [3.4, 8.25, s * 0.9], [1.2, 8.6, s * 1.4], [-1.0, 8.9, s * 2.6]]);
    OUT.push([[6.2, 6.9, 0], [6.0, 7.5, s * 2.6], [5.4, 7.9, s * 5.0], [4.0, 8.35, s * 7.4], [1.8, 8.8, s * 7.0], [-0.5, 9.0, s * 6.0]]);
    OUT.push([[6.2, 6.9, 0], [5.6, 6.0, s * 1.4], [5.2, 5.2, s * 2.2], [4.4, 4.8, s * 2.6], [2.4, 3.8, s * 3.2], [0.8, 3.6, s * 3.6]]);
    OUT.push([[6.2, 6.9, 0], [6.4, 8.4, s * 0.8], [6.4, 9.1, s * 1.8], [5.0, 10.2, s * 2.6], [3.2, 11.6, s * 3.2], [1.6, 12.6, s * 3.6]]);
  }
  OUT.forEach((p, i) => {
    flow('ventilatie', 'cool' + i, { curve: curve(p), count: n(22), speed: 4, size: 0.238, spread: 0.18, color: flat(0x6fb6ff) });
    flow('ventilatie', 'warm' + i, { curve: curve(p), count: n(22), speed: 4, size: 0.238, spread: 0.18, color: flat(0xff9a5a) });
  });
  for (const s of [1, -1])
    flow('ventilatie', 'exit' + s, {
      curve: curve([[-1.0, 8.9, s * 2.6], [-5.5, 8.6, s * 3.4], [-10.5, 7.8, s * 4.4], [-15.5, 6.4, s * 6.0], [-20.5, 5.0, s * 7.0], [-25.0, 4.3, s * 7.3], [-26.4, 4.2, s * 7.4]]),
      count: n(60), speed: 4.5, size: 0.252, spread: 0.45, color: ramp([[0, 0x9ad8c0], [1, 0x6a9a8a]]),
    });

  const flows = new PathFlow(defs);
  root.add(flows.points);
  const fkey = (k: string) => defs.findIndex((d) => d.key === k);
  const idx = {
    small: fkey('small'),
    big: fkey('big'),
    heater: fkey('heater'),
    cool: OUT.map((_, i) => fkey('cool' + i)),
    warm: OUT.map((_, i) => fkey('warm' + i)),
  };

  /* ---------- Shadows ---------- */
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.aid) return;
    const mat = m.material as THREE.Material;
    if (!mat.transparent && !(mat as THREE.ShadowMaterial).isShadowMaterial && mat.blending === THREE.NormalBlending) m.castShadow = m.receiveShadow = true;
  });
  shell.castShadow = false;

  /* ---------- State ---------- */
  const sim: MercSim = { ...newDrive(), explode: 0, hvac: 'cool', system: null, theta: 0, exhaustC: 400 };
  let mode = 'xray';
  let lastCold = 0;

  function applyBody() {
    const solid = mode === 'solid';
    (shell as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>).material = solid ? solidBodyMats : bodyX;
    shell.castShadow = solid;
    bodyG.visible = mode !== 'none';
    bodyExtras.visible = solid;
    cabinMeshes.forEach((m) => {
      m.material = solid ? (m.userData.solidMat as THREE.Material) : cabinX;
      m.castShadow = solid;
    });
  }

  function applySystem() {
    const a = sim.system;
    for (const r of regs) {
      let o = r.base.o,
        t = r.base.t,
        dw = r.base.dw;
      if (a && r.sys !== a) {
        o = r.role === 'shell' ? 0.1 : 0.05;
        t = true;
        dw = false;
      } else if (a && r.role === 'shell') {
        o = 0.2;
        t = true;
        dw = false;
      }
      if (r.m.transparent !== t) r.m.needsUpdate = true;
      r.m.opacity = o;
      r.m.transparent = t;
      r.m.depthWrite = dw;
    }
    for (const [sys, list] of Object.entries(sysMeshes)) for (const m of list) m.castShadow = !a || a === sys;
    // wheels and suspension stay as context, but fade unless the drivetrain is shown
    const fadeChassis = !!a && a !== 'transmisie';
    for (const m of [common.tyre, common.rim, common.rimIn, common.disc, common.caliper, common.steel]) {
      if (m.transparent !== fadeChassis) m.needsUpdate = true;
      m.transparent = fadeChassis;
      m.opacity = fadeChassis ? 0.18 : 1;
      m.depthWrite = !fadeChassis;
    }
    chassis.traverse((o) => (o.castShadow = !fadeChassis && (o as THREE.Mesh).isMesh));
  }

  applyBody();
  applySystem();

  /** Flow visibility + speed from the system filter and the driving state. */
  function updateFlows(dt: number, playing: boolean) {
    const a = sim.system;
    const k = Math.max(0.35, sim.rpm / 2000);
    defs.forEach((d, i) => {
      let vis = !a || a === d.sys ? 1 : 0;
      let rate = 1;
      if (d.sys === 'admisie' || d.sys === 'evacuare') rate = k;
      if (d.sys === 'lubrifiere') rate = 0.6 + k * 0.4;
      if (d.sys === 'racire') rate = 0.6 + k * 0.4;
      if (i === idx.big) vis *= sim.thermo > 0.02 ? 0.35 + sim.thermo * 0.65 : 0;
      if (i === idx.small) vis *= 1 - sim.thermo * 0.6;
      if (idx.cool.includes(i)) vis *= sim.hvac === 'cool' ? 1 : 0;
      if (idx.warm.includes(i)) vis *= sim.hvac === 'heat' ? 1 : 0;
      flows.setVisible(i, vis * (a ? 1 : 0.75));
      flows.setRate(i, rate);
    });
    flows.update(dt, playing);
  }

  const UP = V3(0, 1, 0),
    P = V3(0, 0, 0),
    Q = V3(0, 0, 0),
    dir = V3(0, 0, 0);
  function animate(dt: number, playing: boolean) {
    if (playing) {
      sim.theta = (sim.theta + (dt * sim.rpm * 6) / SLOW) % 1440;
      const wheelDeg = (dt * sim.wheelRpm * 6) / SLOW;
      wheels.forEach((w) => (w.rotation.z -= wheelDeg * RAD));
      halfShafts.forEach((h) => (h.rotation.z -= wheelDeg * RAD));
      const propDeg = wheelDeg * 2.65;
      prop.forEach((p) => (p.rotation.x -= propDeg * RAD));
      fan.rotation.x += dt * (sim.fan * 2400 + (sim.kmh > 0 ? sim.kmh * 4 : 0)) * 6 * RAD / SLOW;
    }
    const th = sim.theta * RAD;
    crank.rotation.x = -th;
    CYL_X.forEach((x, i) => {
      const a = PIN[i] * RAD - th;
      P.set(x, CRANK_Y + CR * Math.cos(a), CR * Math.sin(a));
      const perp = CR * Math.sin(a);
      const yPin = CRANK_Y + CR * Math.cos(a) + Math.sqrt(ROD * ROD - perp * perp);
      Q.set(x, yPin, 0);
      pistons[i].position.set(x, yPin + 0.22, 0);
      rods[i].position.copy(P).add(Q).multiplyScalar(0.5);
      dir.copy(Q).sub(P).normalize();
      rods[i].quaternion.setFromUnitVectors(UP, dir);
    });
    const ex = sim.explode;
    bodyG.position.y = ex * 16;
    wheelHubs.forEach((h) => (h.g.position.z = h.side * ((h.g.position.x > 0 ? TRACK_F : TRACK_R) / 2 + ex * 3)));
  }
  animate(0, false);

  const parts = makeParts(sim);

  return {
    root,
    pickables,
    parts,
    homeView: HOME_VIEW,
    systems: SYSTEMS,
    setSystem(id) {
      sim.system = id;
      applySystem();
    },
    modes: [
      { id: 'xray', label: 'X-ray', revealsInternals: true },
      { id: 'solid', label: 'Caroserie' },
      { id: 'none', label: 'Fără caroserie', revealsInternals: true },
    ],
    defaultMode: 'xray',
    setMode(id) {
      mode = id;
      applyBody();
    },
    highlight(k) {
      Object.entries(PART_MATS).forEach(([p, ms]) => ms.forEach((m) => m.emissive.setHex(p === k ? 0x1a1206 : m.userData.emissive0 ?? 0x000000)));
    },
    acceptHit(h) {
      const part = h.object.userData.part as string | undefined;
      if (!part) return false;
      return !sim.system || PART_SYS[part] === sim.system;
    },
    update({ dt, playing, explode, params }) {
      const el = gl.domElement;
      flows.setViewport(el.clientHeight, el.clientWidth / el.clientHeight < 0.85 ? 52 : 34);
      sim.explode = explode;
      sim.hvac = params.hvac;
      if (params.coldStart !== lastCold) {
        lastCold = params.coldStart;
        sim.temp = 20;
        sim.kmh = 0;
      }
      if (playing) stepDrive(sim, DRIVES[params.drive].kmh, dt);
      sim.exhaustC = exhaustTemp(sim);
      animate(dt, playing);
      updateFlows(dt, playing);
    },
    dispose() {
      flows.dispose();
      disposeTree(root);
      envRT.dispose();
      if (scene.environment === envRT.texture) scene.environment = prevEnv;
      scene.fog = prevFog;
    },
    sim,
  };
}

