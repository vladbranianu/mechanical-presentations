/*
 * Flat-six cutaway, ported from the standalone three.js r128 page.
 * Geometry is procedural; motion follows the real slider-crank kinematics.
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
  PUL,
  R,
  SLOWS,
  SPARK_ADV,
  lift,
  type CylDef,
  type PulleyKey,
} from './engine';
import { makeParts, HOME_VIEW } from './content';

export interface FlatSixParams {
  rpm: number;
  slowIdx: number;
}

/** Per-cylinder runtime state, read by the HUD and the part panel. */
export interface CylState extends CylDef {
  piston: THREE.Group;
  rod: THREE.Group;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  spark: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  valves: THREE.Group[];
  lobes: THREE.Group[];
  /** cycle angle 0..720 */
  p: number;
  rodAng: number;
  crown: number;
  liftI: number;
  liftE: number;
}

export interface FlatSixSim {
  theta: number;
  rpm: number;
  explode: number;
  fire: CylState | null;
  cyl: CylState[];
}

export type FlatSixInstance = PresentationInstance<FlatSixParams> & { sim: FlatSixSim };

// Lights were tuned for three.js' legacy lighting; physically-based units need ×π.
const PI = Math.PI;

export function buildFlatSix({ gl, scene }: BuildContext): FlatSixInstance {
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
      x.globalAlpha = 0.45;
      fillNoise(x, w, h, 256, 60);
      x.globalAlpha = 1;
    },
    [0.35, 0.35],
  );
  const wrinkleBump = canvasTex(256, 256, (x, w, h) => fillNoise(x, w, h, 256, 115), [0.25, 0.25]);
  const carbonMap = canvasTex(
    128,
    128,
    (x, w) => {
      const n = 8,
        cs = w / n;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const hor = (i + j) % 4 < 2,
            g = hor
              ? x.createLinearGradient(0, j * cs, 0, j * cs + cs)
              : x.createLinearGradient(i * cs, 0, i * cs + cs, 0);
          g.addColorStop(0, '#141518');
          g.addColorStop(0.5, hor ? '#3a3d43' : '#2b2e33');
          g.addColorStop(1, '#141518');
          x.fillStyle = g;
          x.fillRect(i * cs, j * cs, cs, cs);
        }
    },
    [0.45, 0.45],
  );
  const headerMap = canvasTex(
    256,
    8,
    (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#3f3159');
      g.addColorStop(0.08, '#5c4a7a');
      g.addColorStop(0.18, '#8a6a3a');
      g.addColorStop(0.32, '#b29a72');
      g.addColorStop(0.55, '#b7babd');
      g.addColorStop(1, '#c2c5c8');
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
      x.fillStyle = '#222429';
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
  scene.fog = new THREE.Fog(0x121518, 120, 260);

  /* ---------- Lights ---------- */
  root.add(new THREE.HemisphereLight(0xc4d4e0, 0x1b1612, 0.18 * PI));
  const key = new THREE.DirectionalLight(0xfff8f0, 1.05 * PI);
  key.position.set(-30, 60, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 10, far: 180 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.04;
  root.add(key);
  const rimWarm = new THREE.DirectionalLight(0xffc4a0, 0.6 * PI);
  rimWarm.position.set(45, 8, -50);
  root.add(rimWarm);
  const rimCool = new THREE.DirectionalLight(0x9cc4ff, 0.35 * PI);
  rimCool.position.set(-55, 5, -30);
  root.add(rimCool);
  // Physically-based point lights fall off with 1/d²; scaled to roughly match the old linear falloff.
  const FIRE_GAIN = 60;
  const fireLight = new THREE.PointLight(0xff7a2e, 0, 32, 2);
  root.add(fireLight);

  /* ---------- Section planes ---------- */
  // cut region = y>0 AND z>0 AND -20.5<x<20.5 (a quarter of the crankcase + top half of bank A)
  const section = new SectionView([
    new THREE.Plane(V3(0, -1, 0), 0),
    new THREE.Plane(V3(0, 0, -1), 0),
    new THREE.Plane(V3(-1, 0, 0), -20.5),
    new THREE.Plane(V3(1, 0, 0), -20.5),
  ]);
  const housing = section.housing.bind(section);

  /* ---------- Materials ---------- */
  const st = <M extends THREE.Material>(m: M) => section.material(m);
  const MS = {
    cast: st(std({ color: 0x80878c, metalness: 0.55, roughness: 0.58, bumpMap: castBump, bumpScale: 0.012 })),
    castDark: st(std({ color: 0x5b6267, metalness: 0.55, roughness: 0.6, bumpMap: castBump, bumpScale: 0.012 })),
    wrinkle: st(std({ color: 0x111214, metalness: 0.15, roughness: 0.9, bumpMap: wrinkleBump, bumpScale: 0.006 })),
    carbon: st(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: carbonMap,
        metalness: 0.25,
        roughness: 0.42,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
      }),
    ),
    machined: st(std({ color: 0xcfd3d6, metalness: 0.85, roughness: 0.28 })),
    black: st(std({ color: 0x202225, metalness: 0.4, roughness: 0.5 })),
    rubber: st(std({ color: 0x141516, metalness: 0, roughness: 0.85 })),
    bolt: st(std({ color: 0x9da3a8, metalness: 0.9, roughness: 0.32 })),
    bore: st(std({ color: 0xa2a7ab, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide })),
    gasket: st(std({ color: 0x3a3d40, metalness: 0.6, roughness: 0.5 })),
  };
  const M = {
    crank: std({ color: 0xb9c0c6, metalness: 0.9, roughness: 0.26 }),
    rod: std({ color: 0x9fa7af, metalness: 0.9, roughness: 0.3 }),
    piston: std({ color: 0xd9dcde, metalness: 0.7, roughness: 0.32 }),
    valve: std({ color: 0xaab0b5, metalness: 0.85, roughness: 0.3 }),
    cam: std({ color: 0x8b939a, metalness: 0.85, roughness: 0.32 }),
    plug: std({ color: 0xf0ede6, metalness: 0, roughness: 0.35 }),
    plugHex: std({ color: 0xa8adb2, metalness: 0.9, roughness: 0.3 }),
    fly: std({ color: 0x7a8288, metalness: 0.85, roughness: 0.34 }),
    exhaust: std({ color: 0xffffff, map: headerMap, metalness: 0.85, roughness: 0.3 }),
    cat: std({ color: 0xb6babd, metalness: 0.8, roughness: 0.36 }),
    coil: std({ color: 0x2b2e33, metalness: 0.3, roughness: 0.38 }),
    belt: std({ color: 0xffffff, map: beltMap, metalness: 0.1, roughness: 0.75, side: THREE.DoubleSide }),
    pulley: std({ color: 0x3c4146, metalness: 0.75, roughness: 0.38 }),
    acc: std({ color: 0x8f969b, metalness: 0.7, roughness: 0.45, bumpMap: castBump, bumpScale: 0.01 }),
  };
  const PART_MATS: Record<string, THREE.MeshStandardMaterial[]> = {
    crank: [M.crank],
    rod: [M.rod],
    piston: [M.piston],
    valve: [M.valve],
    cam: [M.cam],
    plug: [M.plug, M.plugHex, M.coil],
    fly: [M.fly],
    exhaust: [M.exhaust, M.cat],
    intake: [MS.carbon],
    belt: [M.belt, M.pulley, M.acc],
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

  /* ---------- Groups ---------- */
  const bankG: Record<number, THREE.Group> = {},
    blockG: Record<number, THREE.Group> = {};
  [1, -1].forEach((s) => {
    bankG[s] = new THREE.Group();
    blockG[s] = new THREE.Group();
    root.add(bankG[s], blockG[s]);
  });
  const intakeG = new THREE.Group(),
    exhaustG = new THREE.Group(),
    caseG = new THREE.Group(),
    frontG = new THREE.Group();
  root.add(intakeG, exhaustG, caseG, frontG);

  /* ---------- Crankcase ---------- */
  housing(caseG, rbox(42, 15.6, 11.4, 2.2, 0.6), MS.cast, 0, -0.2, 0);
  housing(caseG, new THREE.BoxGeometry(43, 16.6, 0.7), MS.castDark, 0, -0.2, 0); // split-line flange
  housing(caseG, rbox(30, 4.2, 9.4, 1.2, 0.4), MS.castDark, 1, -9.6, 0); // sump
  for (let i = 0; i < 9; i++) housing(caseG, new THREE.BoxGeometry(0.35, 1.4, 8.6), MS.castDark, -11 + i * 3, -12.2, 0, false);
  // main bearing bulkhead bosses
  [-17.7, -5.9, 5.9, 17.7].forEach((x) => housing(caseG, cylX(2.7, 1.6, 24), MS.cast, x, 0, 0, false));
  // rear engine mounts
  [1, -1].forEach((s) => {
    housing(caseG, rbox(4, 3, 3, 0.6, 0.3), MS.castDark, 17, 8.4, s * 2.6, false);
    const mt = new THREE.Mesh(cylY(1.3, 1.6, 20), MS.rubber);
    mt.position.set(17, 10.6, s * 2.6);
    mt.castShadow = true;
    caseG.add(mt);
  });
  {
    const l1: BoltSpec[] = [];
    for (let i = 0; i < 11; i++) {
      const x = -19 + i * 3.8;
      l1.push([x, 7.6, 0, 'y', 1], [x, -8.1, 0, 'y', -1]);
    }
    bolts(caseG, l1, MS.bolt);
  }
  // oil filler cap + dipstick
  {
    const cap = new THREE.Mesh(cylY(1.2, 1, 24), std({ color: 0xd8b02a, metalness: 0.2, roughness: 0.45 }));
    cap.position.set(-18.5, 8.1, -2.6);
    cap.castShadow = true;
    caseG.add(cap);
    const nk = new THREE.Mesh(cylY(0.8, 0.8, 16), MS.black);
    nk.position.set(-18.5, 7.4, -2.6);
    caseG.add(nk);
    const dip = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.18, 8, 20), std({ color: 0xe0702a, roughness: 0.5 }));
    dip.position.set(-18.5, 8.6, 2.8);
    dip.rotation.y = Math.PI / 2;
    caseG.add(dip);
  }
  // oil filter
  {
    const f = new THREE.Mesh(cylY(2.2, 4.4, 32), std({ color: 0x1d3c6e, metalness: 0.35, roughness: 0.4 }));
    f.position.set(-7, -12.6, 7.6);
    f.rotation.x = 0.35;
    f.castShadow = true;
    caseG.add(f);
    const band = new THREE.Mesh(cylY(2.23, 0.6, 32), std({ color: 0xe8e8e8, roughness: 0.5 }));
    band.position.copy(f.position);
    band.rotation.x = 0.35;
    caseG.add(band);
    const base = new THREE.Mesh(cylY(1.6, 1.2, 24), MS.cast);
    base.position.set(-7, -10.3, 6.8);
    base.rotation.x = 0.35;
    caseG.add(base);
  }

  /* ---------- Crankshaft (moving) ---------- */
  const crank = new THREE.Group();
  root.add(crank);
  function webArm(x: number, a: number) {
    const inner = -1.6,
      outer = R + 1.7,
      len = outer - inner,
      c = (inner + outer) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.2, len), M.crank);
    m.position.set(x, c * Math.sin(a), c * Math.cos(a));
    m.rotation.x = -a;
    crank.add(m);
    const span = Math.PI * 0.85;
    const cw = new THREE.Mesh(
      new THREE.CylinderGeometry(6.0, 6.0, 1.1, 28, 1, false, a + Math.PI - span / 2, span).rotateZ(Math.PI / 2),
      M.crank,
    );
    cw.position.x = x;
    crank.add(cw);
  }
  [
    [0, 3],
    [1, 4],
    [2, 5],
  ].forEach(([ia, ib]) => {
    const a = CYL[ia],
      b = CYL[ib],
      xp = (a.x + b.x) / 2;
    [a, b].forEach((c) => {
      const ph = c.phi * RAD,
        m = new THREE.Mesh(cylX(1.55, 2.3, 24), M.crank);
      m.position.set(c.x, R * Math.sin(ph), R * Math.cos(ph));
      crank.add(m);
    });
    webArm(xp - 3.05, a.phi * RAD);
    webArm(xp + 3.05, b.phi * RAD);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.4, 2 * R + 3), M.crank);
    mid.position.x = xp;
    mid.rotation.x = -a.phi * RAD;
    crank.add(mid);
  });
  [
    [-24.6, -15.4],
    [-8.2, -3.6],
    [3.6, 8.2],
    [15.4, 24.2],
  ].forEach(([x0, x1]) => {
    const m = new THREE.Mesh(cylX(1.9, x1 - x0, 28), M.crank);
    m.position.x = (x0 + x1) / 2;
    crank.add(m);
  });
  reg('crank', crank);

  // flywheel + clutch (child of the crank so it turns with it)
  const fly = new THREE.Group();
  crank.add(fly);
  {
    const d = new THREE.Mesh(cylX(12, 1.6, 72), M.fly);
    d.position.x = 24.9;
    fly.add(d);
    const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.5, 0.8), M.fly, 96),
      dm = new THREE.Object3D();
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      dm.position.set(24.9, 12.35 * Math.sin(a), 12.35 * Math.cos(a));
      dm.rotation.set(-a, 0, 0);
      dm.updateMatrix();
      teeth.setMatrixAt(i, dm.matrix);
    }
    fly.add(teeth);
    const cover = new THREE.Mesh(
      new THREE.CylinderGeometry(10.2, 10.6, 2.2, 48).rotateZ(Math.PI / 2),
      std({ color: 0x4a5056, metalness: 0.8, roughness: 0.35 }),
    );
    cover.position.x = 26.8;
    fly.add(cover);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2,
        f = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 4.6), M.fly);
      f.position.set(28, 3.4 * Math.sin(a), 3.4 * Math.cos(a));
      f.rotation.x = -a;
      fly.add(f);
    }
    const hb = new THREE.Mesh(cylX(1.6, 1.2, 24), M.fly);
    hb.position.x = 28.3;
    fly.add(hb);
    const bl: BoltSpec[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bl.push([27.9, 8.6 * Math.sin(a), 8.6 * Math.cos(a), 'x', 1]);
    }
    bolts(fly, bl, M.fly);
    const mk = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 1.6, 0.6),
      std({ color: 0xd9a441, metalness: 0.3, roughness: 0.4, emissive: 0x2a1d05 }),
    );
    mk.position.set(25.75, 10.6, 0);
    fly.add(mk);
  }
  reg('fly', fly);

  /* ---------- Per-cylinder parts ---------- */
  const UP = V3(0, 1, 0);
  const lobeGeo = (() => {
    const sh = new THREE.Shape(),
      N = 96;
    for (let i = 0; i <= N; i++) {
      const psi = (i / N) * Math.PI * 2 - Math.PI,
        half = 57.5 * RAD,
        f = Math.abs(psi) < half ? Math.pow(Math.cos(((Math.PI / 2) * psi) / half), 1.6) : 0;
      const r = 1.1 + 1.0 * f,
        x = r * Math.cos(psi),
        y = r * Math.sin(psi);
      if (i) sh.lineTo(x, y);
      else sh.moveTo(x, y);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.3, bevelEnabled: false, curveSegments: 4 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.65, 0, 0);
    return g;
  })();
  const springMat = std({ color: 0x5a6268, metalness: 0.7, roughness: 0.4 });
  const springGeo = (() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120,
        a = t * Math.PI * 2 * 6;
      pts.push(V3(0.6 * Math.cos(a), 0.6 * Math.sin(a), t * 2.6));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.09, 6);
  })();
  const ringMat = std({ color: 0x3a4249, metalness: 0.7, roughness: 0.45 });

  const cyl: CylState[] = CYL.map((c) => {
    const s = c.s;
    // piston
    const pg = new THREE.Group();
    pg.add(new THREE.Mesh(cylZ(BORE / 2 - 0.1, 6, 40), M.piston));
    [2.4, 1.8, 1.2].forEach((z) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(BORE / 2 - 0.08, 0.09, 6, 40), ringMat);
      t.position.z = z;
      pg.add(t);
    });
    pg.add(new THREE.Mesh(cylX(0.9, BORE - 1.4, 16), M.rod));
    if (s < 0) pg.rotation.y = Math.PI;
    root.add(pg);
    reg('piston', pg);
    // rod
    const rg = new THREE.Group();
    rg.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, L - 3.4, 1.5), M.rod));
    const be = new THREE.Mesh(cylX(2.15, 1.4, 28), M.rod);
    be.position.y = -L / 2;
    rg.add(be);
    const se = new THREE.Mesh(cylX(1.3, 1.25, 20), M.rod);
    se.position.y = L / 2;
    rg.add(se);
    const bt = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 4.6), M.rod);
    bt.position.y = -L / 2 - 0.4;
    rg.add(bt);
    root.add(rg);
    reg('rod', rg);
    // bore liner (cylinder wall visible in section)
    const bl = DECK - 5.6;
    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(BORE / 2 + 0.05, BORE / 2 + 0.05, bl, 40, 1, true).rotateX(Math.PI / 2),
      MS.bore,
    );
    liner.position.set(c.x, 0, s * (5.6 + bl / 2));
    liner.receiveShadow = true;
    blockG[s].add(liner);
    // water jacket bulge
    housing(blockG[s], cylZ(5.75, bl - 1.6, 40), MS.cast, c.x, 0, s * (5.6 + bl / 2));
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
    root.add(glow);
    // valves: intake top, exhaust bottom
    const valves = [2.3, -2.3].map((y) => {
      const v = new THREE.Group();
      v.add(new THREE.Mesh(cylZ(1.7, 0.3, 24), M.valve));
      const stm = new THREE.Mesh(cylZ(0.24, 6.2, 10), M.valve);
      stm.position.z = 3.15;
      v.add(stm);
      const rt = new THREE.Mesh(cylZ(0.78, 0.35, 16), M.valve);
      rt.position.z = 5.6;
      v.add(rt);
      const sp = new THREE.Mesh(springGeo, springMat);
      sp.position.z = 3.0;
      v.add(sp);
      v.position.set(c.x, y, 0);
      if (s < 0) v.rotation.y = Math.PI;
      bankG[s].add(v);
      reg('valve', v);
      return v;
    });
    // cam lobes
    const lobes = [
      { y: 2.3, peak: (IN_OPEN + IN_CLOSE) / 2 },
      { y: -2.3, peak: (EX_OPEN + EX_CLOSE) / 2 },
    ].map((o) => {
      const pv = new THREE.Group();
      pv.position.set(c.x, o.y, s * (DECK + 7.2));
      const lobe = new THREE.Mesh(lobeGeo, M.cam);
      if (s > 0) lobe.rotation.x = Math.PI;
      pv.add(lobe);
      bankG[s].add(pv);
      reg('cam', lobe);
      pv.userData.peak = o.peak;
      return pv;
    });
    // spark plug + coil-on-plug
    const sg = new THREE.Group();
    const th = new THREE.Mesh(cylZ(0.55, 1.2, 12), M.plugHex);
    th.position.z = 0.6;
    sg.add(th);
    const hx = new THREE.Mesh(cylZ(0.95, 1.0, 6), M.plugHex);
    hx.position.z = 1.7;
    sg.add(hx);
    const ins = new THREE.Mesh(cylZ(0.48, 2.8, 16), M.plug);
    ins.position.z = 3.6;
    sg.add(ins);
    const boot = new THREE.Mesh(cylZ(0.85, 4.2, 16), MS.rubber);
    boot.position.z = 7.1;
    sg.add(boot);
    const coil = new THREE.Mesh(rbox(2.6, 3.6, 3.2, 0.6, 0.3), M.coil);
    coil.position.set(0, 0.5, 10.6);
    coil.castShadow = true;
    sg.add(coil);
    const conn = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.4), MS.black);
    conn.position.set(0, 2.6, 10.8);
    sg.add(conn);
    sg.position.set(c.x, 0, s * DECK);
    if (s < 0) sg.rotation.y = Math.PI;
    bankG[s].add(sg);
    reg('plug', sg);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff2d0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spark.position.set(c.x, 0, s * (DECK - 0.3));
    bankG[s].add(spark);

    return { ...c, piston: pg, rod: rg, glow, spark, valves, lobes, p: 0, rodAng: 0, crown: 15, liftI: 0, liftE: 0 };
  });

  /* ---------- Blocks, heads, covers ---------- */
  [1, -1].forEach((s) => {
    const xs = CYL.filter((c) => c.s === s).map((c) => c.x),
      x0 = Math.min(...xs) - 5.9,
      x1 = Math.max(...xs) + 5.9,
      xm = (x0 + x1) / 2,
      w = x1 - x0;
    const bl = DECK - 5.6;
    housing(blockG[s], rbox(w, 11.6, bl, 1.2, 0.5), MS.cast, xm, 0, s * (5.6 + bl / 2));
    housing(blockG[s], new THREE.BoxGeometry(w + 0.6, 13.4, 0.5), MS.castDark, xm, 0, s * (DECK - 0.25)); // deck flange
    housing(blockG[s], new THREE.BoxGeometry(w + 0.4, 13.2, 0.25), MS.gasket, xm, 0, s * (DECK + 0.12), false);
    // cylinder head
    housing(bankG[s], rbox(w + 0.4, 14, 5.4, 1.4, 0.5), MS.cast, xm, 0, s * (DECK + 2.95));
    // port bosses (intake top, exhaust bottom)
    CYL.filter((c) => c.s === s).forEach((c) => {
      housing(bankG[s], rbox(4.2, 1.4, 3, 0.5, 0.25), MS.cast, c.x, 7.4, s * (DECK + 2.8), false);
      housing(bankG[s], rbox(3.6, 1.4, 2.8, 0.5, 0.25), MS.cast, c.x, -7.4, s * (DECK + 2.8), false);
    });
    // cam carrier + wrinkle-finish valve cover
    housing(bankG[s], rbox(w - 0.2, 12.6, 2.0, 1.2, 0.4), MS.castDark, xm, 0, s * (DECK + 6.6));
    housing(bankG[s], rbox(w - 1, 11.6, 3.4, 2.2, 0.8), MS.wrinkle, xm, 0, s * (DECK + 9.1));
    [-4.2, 4.2].forEach((y) =>
      housing(bankG[s], rbox(w - 5, 0.7, 0.9, 0.3, 0.15), MS.wrinkle, xm, y, s * (DECK + 10.9), false),
    );
    // cover + head bolts
    const bl1: BoltSpec[] = [];
    for (let i = 0; i < 7; i++) {
      const x = x0 + 2.2 + (i * (w - 4.4)) / 6;
      bl1.push([x, 5.1, s * (DECK + 10.75), 'z', s], [x, -5.1, s * (DECK + 10.75), 'z', s]);
    }
    bolts(bankG[s], bl1, MS.bolt);
    const bl2: BoltSpec[] = [];
    for (let i = 0; i < 9; i++) {
      const x = x0 + 1.4 + (i * (w - 2.8)) / 8;
      bl2.push([x, 6.8, s * (DECK + 5.2), 'y', 1], [x, -6.8, s * (DECK + 5.2), 'y', -1]);
    }
    bolts(bankG[s], bl2, MS.bolt);
    // camshafts + sprockets
    [2.3, -2.3].forEach((y) => {
      const sh = new THREE.Mesh(cylX(0.6, w + 1.5, 16), M.cam);
      sh.position.set(xm, y, s * (DECK + 7.2));
      bankG[s].add(sh);
      reg('cam', sh);
      const sp = new THREE.Mesh(cylX(2.4, 0.8, 30), M.cam);
      sp.position.set(x0 - 0.3, y, s * (DECK + 7.2));
      bankG[s].add(sp);
      reg('cam', sp);
    });
    // timing chain covers
    housing(bankG[s], rbox(1.6, 13.6, 10, 1.2, 0.4), MS.castDark, x0 - 1, 0, s * (DECK + 5.2));
    housing(blockG[s], rbox(1.6, 10, bl, 1.2, 0.4), MS.castDark, x0 - 1, 0, s * (5.6 + bl / 2));
    // fuel rail + injectors
    const rail = new THREE.Mesh(cylX(0.55, w - 2, 16), MS.machined);
    rail.position.set(xm, 9.6, s * (DECK + 0.6));
    rail.castShadow = true;
    bankG[s].add(rail);
    const injRing = std({ color: 0x1f6b3a, roughness: 0.5 });
    CYL.filter((c) => c.s === s).forEach((c) => {
      const inj = new THREE.Mesh(cylY(0.45, 2.2, 16), MS.black);
      inj.position.set(c.x, 8.4, s * (DECK + 0.6));
      bankG[s].add(inj);
      const ring = new THREE.Mesh(cylY(0.55, 0.4, 16), injRing);
      ring.position.set(c.x, 9.0, s * (DECK + 0.6));
      bankG[s].add(ring);
    });
    // coil harness
    tube(
      bankG[s],
      [
        [x0 + 0.5, 4.9, s * (DECK + 11.2)],
        [xm, 5.0, s * (DECK + 11.35)],
        [x1 - 1.5, 4.9, s * (DECK + 11.2)],
      ],
      0.3,
      MS.rubber,
      40,
    );
    CYL.filter((c) => c.s === s).forEach((c) =>
      tube(
        bankG[s],
        [
          [c.x + 0.6, 4.9, s * (DECK + 11.3)],
          [c.x + 0.3, 3.9, s * (DECK + 11.4)],
          [c.x, 3.1, s * (DECK + 10.9)],
        ],
        0.18,
        MS.rubber,
        10,
      ),
    );
  });

  /* ---------- Intake: carbon plenum, rear throttle body, runners ---------- */
  housing(intakeG, rbox(31, 5.2, 10, 2.2, 0.8), MS.carbon, 0, 16, 0);
  housing(intakeG, rbox(28, 0.8, 7, 0.3, 0.2), MS.carbon, 0, 18.9, 0, false);
  {
    const tb = new THREE.Mesh(cylX(2.8, 4, 40), MS.machined);
    tb.position.set(17.5, 16, 0);
    tb.castShadow = true;
    intakeG.add(tb);
    const act = new THREE.Mesh(rbox(3, 3.4, 3, 0.5, 0.25), MS.black);
    act.position.set(17.5, 16, 3.6);
    intakeG.add(act);
    const box = new THREE.Mesh(rbox(6.6, 7, 12, 1.5, 0.6), MS.black);
    box.position.set(23, 16.4, 0);
    box.castShadow = true;
    intakeG.add(box);
    const lid = new THREE.Mesh(rbox(6.8, 0.7, 12.2, 0.3, 0.2), MS.wrinkle);
    lid.position.set(23, 20, 0);
    intakeG.add(lid);
    const snorkel = new THREE.Mesh(cylZ(2.2, 4, 32), MS.black);
    snorkel.position.set(23, 15.6, 7.8);
    intakeG.add(snorkel);
    const bl: BoltSpec[] = [];
    [-1, 1].forEach((z) => [-1, 1].forEach((x) => bl.push([23 + x * 2.6, 20.35, z * 5.2, 'y', 1])));
    bolts(intakeG, bl, MS.bolt);
  }
  CYL.forEach((c) => {
    const s = c.s;
    const r = tube(
      intakeG,
      [
        [c.x, 14.2, s * 4],
        [c.x, 13.8, s * 8.5],
        [c.x, 11.5, s * (DECK - 2.5)],
        [c.x, 8.6, s * (DECK + 2.6)],
      ],
      1.2,
      MS.cast,
      30,
    );
    section.addBack(intakeG, r);
    housing(intakeG, rbox(3.6, 0.6, 3.6, 0.4, 0.15), MS.cast, c.x, 8.4, s * (DECK + 2.6), false);
  });
  reg('intake', intakeG);

  /* ---------- Exhaust ---------- */
  const heatShield = std({ color: 0xc9ccce, metalness: 0.9, roughness: 0.45 });
  [1, -1].forEach((s) => {
    CYL.filter((c) => c.s === s).forEach((c) => {
      tube(
        exhaustG,
        [
          [c.x, -8.1, s * (DECK + 2.8)],
          [c.x, -11.5, s * (DECK + 2.2)],
          [c.x + 1.5, -15, s * (DECK - 2.5)],
          [c.x + 4, -17, s * 13.4],
        ],
        0.85,
        M.exhaust,
        30,
      );
      const fl = new THREE.Mesh(rbox(3.4, 0.6, 3.2, 0.4, 0.15), MS.cast);
      fl.position.set(c.x, -8, s * (DECK + 2.8));
      exhaustG.add(fl);
    });
    tube(
      exhaustG,
      [
        [-10, -17, s * 13.4],
        [0, -17.2, s * 13.4],
        [10, -17.3, s * 13.2],
        [14, -17.4, s * 13],
      ],
      1.35,
      M.exhaust,
      30,
    );
    const cat = new THREE.Mesh(rbox(9, 6, 6, 2.6, 0.8), M.cat);
    cat.position.set(19, -17.4, s * 12.4);
    cat.castShadow = true;
    exhaustG.add(cat);
    [14.3, 23.7].forEach((x) => {
      const cn = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 2.6, 1.4, 24).rotateZ(x < 19 ? -Math.PI / 2 : Math.PI / 2),
        M.cat,
      );
      cn.position.set(x, -17.4, s * 12.4);
      exhaustG.add(cn);
    });
    tube(
      exhaustG,
      [
        [24.4, -17.4, s * 12.4],
        [28, -17.6, s * 11],
        [30, -18, s * 8],
      ],
      1.2,
      M.cat,
      20,
    );
    const hs = new THREE.Mesh(rbox(9.6, 0.4, 6.8, 1, 0.15), heatShield);
    hs.position.set(19, -13.9, s * 12.4);
    exhaustG.add(hs);
  });
  {
    const muf = new THREE.Mesh(rbox(7, 7.6, 22, 3, 1), M.cat);
    muf.position.set(32, -18, 0);
    muf.castShadow = true;
    exhaustG.add(muf);
    const tipMat = std({ color: 0x111111, side: THREE.DoubleSide });
    [1, -1].forEach((s) => {
      const tp = new THREE.Mesh(cylX(1.25, 5, 24), MS.machined);
      tp.position.set(37, -18.6, s * 6.5);
      exhaustG.add(tp);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.4, 24, 1, true).rotateZ(Math.PI / 2), tipMat);
      tip.position.set(39.4, -18.6, s * 6.5);
      exhaustG.add(tip);
    });
  }
  reg('exhaust', exhaustG);

  /* ---------- Front accessory drive ---------- */
  const pulleys: THREE.Group[] = [];
  const grooveMat = std({ color: 0x22262a, metalness: 0.6, roughness: 0.5 });
  const spokeMat = std({ color: 0x15171a, roughness: 0.6 });
  const darkPulley = std({ color: 0x2a2e32, metalness: 0.7, roughness: 0.4 });
  function pulley(k: PulleyKey, mat: THREE.Material = M.pulley) {
    const p = PUL[k],
      g = new THREE.Group();
    g.position.set(BELT_X, p.y, p.z);
    g.add(new THREE.Mesh(cylX(p.r, 2.4, 48), mat));
    for (let i = -1; i <= 1; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(p.r + 0.02, 0.1, 6, 48).rotateY(Math.PI / 2), grooveMat);
      t.position.x = i * 0.6;
      g.add(t);
    }
    g.add(new THREE.Mesh(cylX(Math.min(1.2, p.r * 0.45), 2.9, 20), MS.machined));
    const nSp = k === 'crank' ? 6 : 5;
    for (let i = 0; i < nSp; i++) {
      const a = (i / nSp) * Math.PI * 2,
        h = new THREE.Mesh(cylX(p.r * 0.16, 2.6, 12), spokeMat);
      h.position.set(0, p.r * 0.6 * Math.sin(a), p.r * 0.6 * Math.cos(a));
      g.add(h);
    }
    frontG.add(g);
    g.userData.ratio = PUL.crank.r / p.r;
    pulleys.push(g);
    return g;
  }
  pulley('crank', darkPulley);
  {
    const damp = new THREE.Mesh(cylX(5.6, 0.9, 48), MS.rubber);
    damp.position.set(BELT_X + 1.9, 0, 0);
    frontG.add(damp);
    const d2 = new THREE.Mesh(cylX(5.3, 1.2, 48), darkPulley);
    d2.position.set(BELT_X + 2.9, 0, 0);
    frontG.add(d2);
  }
  (['ac', 'wp', 'idler', 'alt', 'tens'] as const).forEach((k) => pulley(k));
  // alternator
  {
    const a = PUL.alt,
      b = new THREE.Mesh(cylX(3.9, 7, 40), M.acc);
    b.position.set(BELT_X + 5.4, a.y, a.z);
    b.castShadow = true;
    frontG.add(b);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2,
        f = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.25, 0.6), MS.castDark);
      f.position.set(BELT_X + 5.2, a.y + 3.95 * Math.sin(ang), a.z + 3.95 * Math.cos(ang));
      f.rotation.x = -ang;
      frontG.add(f);
    }
    const rear = new THREE.Mesh(cylX(3.2, 1, 32), MS.black);
    rear.position.set(BELT_X + 9.3, a.y, a.z);
    frontG.add(rear);
    const br = new THREE.Mesh(rbox(5, 2, 2.4, 0.4, 0.2), MS.castDark);
    br.position.set(BELT_X + 6, a.y - 3.6, a.z - 2.4);
    frontG.add(br);
  }
  // A/C compressor
  {
    const a = PUL.ac,
      b = new THREE.Mesh(cylX(3.4, 8, 40), M.acc);
    b.position.set(BELT_X + 5.8, a.y, a.z);
    b.castShadow = true;
    frontG.add(b);
    const cl = new THREE.Mesh(cylX(3.5, 0.9, 40), MS.black);
    cl.position.set(BELT_X + 2.2, a.y, a.z);
    frontG.add(cl);
    [-1.6, 1.6].forEach((dy) => {
      const f = new THREE.Mesh(rbox(1.6, 1.6, 1.4, 0.3, 0.15), MS.machined);
      f.position.set(BELT_X + 9, a.y + dy, a.z + 2.6);
      frontG.add(f);
    });
  }
  // water pump
  {
    const a = PUL.wp,
      b = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 4, 32).rotateZ(Math.PI / 2), M.acc);
    b.position.set(BELT_X + 3.4, a.y, a.z);
    b.castShadow = true;
    frontG.add(b);
  }
  // belt: convex hull around the pulleys, resampled, extruded as a flat band
  const belt = (() => {
    const P: [number, number][] = [];
    Object.values(PUL).forEach((p) => {
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
    const th = 0.45,
      hw = 1.05,
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
      const ring = [
        [p[0], p[1], -hw],
        [p[0] + nz * th, p[1] + ny * th, -hw],
        [p[0] + nz * th, p[1] + ny * th, hw],
        [p[0], p[1], hw],
      ];
      ring.forEach((r, j) => {
        pos.push(BELT_X + r[2], r[1], r[0]);
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
    const m = new THREE.Mesh(g, M.belt);
    m.castShadow = true;
    frontG.add(m);
    return { mesh: m, len: tot };
  })();
  reg('belt', frontG);

  // coolant hoses with clamps
  function hose(pts: number[][], r = 0.8) {
    tube(caseG, pts, r, MS.rubber, 30);
    [pts[0], pts[pts.length - 1]].forEach((p, i) => {
      const q = pts[i ? pts.length - 2 : 1],
        d = V3(q[0], q[1], q[2]).sub(V3(p[0], p[1], p[2])).normalize();
      const cl = new THREE.Mesh(new THREE.TorusGeometry(r + 0.08, 0.14, 6, 20), MS.machined);
      cl.position.set(p[0], p[1], p[2]).addScaledVector(d, 0.6);
      cl.quaternion.setFromUnitVectors(V3(0, 0, 1), d);
      caseG.add(cl);
    });
  }
  hose([
    [BELT_X + 5.4, PUL.wp.y, PUL.wp.z],
    [-21, 6.5, -11],
    [-19.6, 4, -14],
  ]);
  hose([
    [BELT_X + 4.6, PUL.wp.y + 1.4, PUL.wp.z + 1.6],
    [-22, 9.5, 0],
    [-21.5, 6.5, 9],
    [-20.8, 3.5, 13],
  ]);
  hose(
    [
      [2, -6.8, -13],
      [4, -9.5, -7],
      [6, -10, 0],
      [8, -9.5, 7],
      [10, -6.8, 13],
    ],
    0.65,
  );
  // starter motor
  {
    const sm = new THREE.Mesh(cylX(2.3, 8, 32), M.acc);
    sm.position.set(23, -8.5, -11.6);
    sm.castShadow = true;
    caseG.add(sm);
    const sol = new THREE.Mesh(cylX(1.2, 4.6, 24), MS.machined);
    sol.position.set(22.4, -6, -12.6);
    caseG.add(sol);
    const nose = new THREE.Mesh(cylX(1.5, 2, 24), MS.castDark);
    nose.position.set(18.6, -8.5, -11.6);
    caseG.add(nose);
  }

  /* ---------- Floor ---------- */
  {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.ShadowMaterial({ opacity: 0.42 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = -21.4;
    sh.receiveShadow = true;
    root.add(sh);
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshBasicMaterial({ map: floorMap, transparent: true, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -21.45;
    root.add(disc);
    const pts: number[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2,
        b = ((i + 1) / 160) * Math.PI * 2;
      pts.push(52 * Math.cos(a), -21.4, 52 * Math.sin(a), 52 * Math.cos(b), -21.4, 52 * Math.sin(b));
    }
    for (let d = 0; d < 360; d += 5) {
      const a = d * RAD,
        l = d % 30 === 0 ? 2.6 : 1;
      pts.push(52 * Math.cos(a), -21.4, 52 * Math.sin(a), (52 - l) * Math.cos(a), -21.4, (52 - l) * Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c343b })));
  }

  // shadows
  [crank, ...cyl.map((c) => c.piston), ...cyl.map((c) => c.rod)].forEach((o) =>
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
    }),
  );
  [intakeG, exhaustG, frontG, bankG[1], bankG[-1]].forEach((g) =>
    g.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).blending === THREE.NormalBlending) mesh.castShadow = true;
    }),
  );

  /* ---------- Simulation ---------- */
  const sim: FlatSixSim = { theta: 0, rpm: 2400, explode: 0, fire: null, cyl };
  const C_HOT = new THREE.Color(0xff6a1e),
    C_EX = new THREE.Color(0x3a332c),
    C_IN = new THREE.Color(0x1d4a52),
    C_CO = new THREE.Color(0x2b3166);
  const P = V3(0, 0, 0),
    Q = V3(0, 0, 0),
    dir = V3(0, 0, 0);

  function simulate() {
    const th = sim.theta,
      thr = th * RAD;
    crank.rotation.x = -(th % 360) * RAD;
    pulleys.forEach((p) => {
      p.rotation.x = -thr * p.userData.ratio;
    });
    M.belt.map!.offset.x = ((thr * PUL.crank.r) / belt.len * 60) % 1;
    const ex = sim.explode;
    [1, -1].forEach((s) => {
      bankG[s].position.z = s * ex * 12;
      blockG[s].position.z = s * ex * 6;
    });
    intakeG.position.y = ex * 10;
    exhaustG.position.y = -ex * 8;
    frontG.position.x = -ex * 8;
    let fire: CylState | null = null;
    for (const c of cyl) {
      const a = (th + c.phi) * RAD,
        py = R * Math.sin(a),
        pz = R * Math.cos(a),
        root2 = Math.sqrt(L * L - py * py),
        d = (c.s > 0 ? pz : -pz) + root2;
      c.piston.position.set(c.x, 0, c.s * d);
      P.set(c.x, py, pz);
      Q.set(c.x, 0, c.s * d);
      c.rod.position.copy(P).add(Q).multiplyScalar(0.5);
      dir.copy(Q).sub(P).normalize();
      c.rod.quaternion.setFromUnitVectors(UP, dir);
      c.rodAng = Math.asin(py / L) / RAD;
      c.crown = d + CH;
      const deck = DECK + ex * 12,
        len = Math.max(deck - c.crown, 0.01);
      c.glow.scale.z = len;
      c.glow.position.set(c.x, 0, c.s * (c.crown + len / 2));
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
      c.valves[0].position.z = c.s * (DECK - 0.15 - c.liftI);
      c.valves[1].position.z = c.s * (DECK - 0.15 - c.liftE);
      c.lobes.forEach((pv) => {
        pv.rotation.x = -((th - c.T - pv.userData.peak) / 2) * RAD;
      });
      const sp = p >= 720 - SPARK_ADV ? Math.sin(((p - (720 - SPARK_ADV)) / SPARK_ADV) * Math.PI) : 0;
      c.spark.material.opacity = sp;
      c.spark.scale.setScalar(0.6 + sp * 0.8);
    }
    const f = fire as CylState | null;
    if (f) {
      fireLight.intensity = 3.2 * PI * FIRE_GAIN * Math.pow(1 - f.p / 180, 2);
      fireLight.position.set(f.x, 1, f.s * (DECK + ex * 12 - 1.5));
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
    setMode: (id) => section.apply(id as SectionMode),
    highlight(k) {
      Object.entries(PART_MATS).forEach(([p, ms]) => ms.forEach((m) => m.emissive.setHex(p === k ? 0x110c04 : 0x000000)));
    },
    acceptHit(h, mode) {
      if (mode !== 'cut') return true;
      const p = h.point;
      const clipped = !!((h.object as THREE.Mesh).material as THREE.Material).clippingPlanes;
      return !(p.y > 0 && p.z > 0 && Math.abs(p.x) < 20.5) || !clipped;
    },
    tags: cyl.map((c) => ({
      id: String(c.n),
      text: String(c.n),
      position: (out) => out.set(c.x, -9.6, c.s * (DECK + 9.2 + sim.explode * 12)),
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
