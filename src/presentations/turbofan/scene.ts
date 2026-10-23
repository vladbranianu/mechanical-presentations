/*
 * CFM56-7B turbofan, procedural. Two co-axial spools (N1: fan + booster + LP turbine,
 * N2: HP compressor + HP turbine), a quarter section through casings and nacelle, gas
 * particles coloured by temperature, a cascade thrust reverser and the 737 cowl halves that
 * swing open on the pylon hinge in the exploded view.
 */
import * as THREE from 'three';
import type { BuildContext, PresentationInstance } from '../../framework/types';
import { SectionView, type SectionMode } from '../../framework/three/section';
import { canvasTex, cylX, cylY, disposeTree, fillNoise, rbox, tube, V3 } from '../../framework/three/geometry';
import {
  CORE_EXIT_X,
  INLET_X,
  N1_RPM_100,
  N2_RPM_100,
  NOZZLE_X,
  ROWS,
  SLOWS,
  SPINNER_TIP,
  SPLIT_X,
  coreTipR,
  cowlR,
  ductOutR,
  hubR,
  leverToN1,
  nacelleR,
  smooth,
  stations,
  steadyState,
  stepEngine,
  vsvClosure,
  type EngineState,
  type RowDef,
  type Stations,
} from './engine';
import { BladeRow, bladeGeometry, lathe, sampled, shell, type BladeSpec, type PP } from './shapes';
import { CASCADE_X, Flow } from './flow';
import { HOME_VIEW, makeParts } from './content';

export interface TurbofanParams {
  /** throttle lever 0 (idle) .. 100 (take-off) */
  lever: number;
  reverse: boolean;
  flow: boolean;
  slowIdx: number;
}

export interface TurbofanSim {
  eng: EngineState;
  st: Stations;
  /** spool angles, radians */
  a1: number;
  a2: number;
  explode: number;
  reverse: boolean;
}

export type TurbofanInstance = PresentationInstance<TurbofanParams> & { sim: TurbofanSim };

/** Explode offsets along x, per module. */
export const EX = { inlet: -30, core: 24, lpt: 50 };
export const HINGE_Y = 46.6;
export const COWL_OPEN = 56 * (Math.PI / 180);
/** Thrust-reverser sleeve travel. */
export const SLEEVE_TRAVEL = 14;

const TAU = Math.PI * 2;

export function buildTurbofan({ gl, scene }: BuildContext): TurbofanInstance {
  const root = new THREE.Group();
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

  /* ---------- Textures ---------- */
  const castBump = canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = '#808080';
      x.fillRect(0, 0, w, h);
      fillNoise(x, w, h, 64, 60);
      x.globalAlpha = 0.5;
      fillNoise(x, w, h, 256, 50);
      x.globalAlpha = 1;
    },
    [6, 2],
  );
  const linerMap = canvasTex(
    64,
    64,
    (x, w, h) => {
      x.fillStyle = '#4b5157';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#2a2e32';
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          x.beginPath();
          x.arc(i * 8 + (j % 2) * 4 + 2, j * 8 + 4, 1.3, 0, TAU);
          x.fill();
        }
    },
    [220, 40],
  );
  linerMap.colorSpace = THREE.SRGBColorSpace;
  // CFM56 spinner: a white spiral so ground crew can see the fan turning
  const spinnerMap = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const x = c.getContext('2d')!;
    const id = x.createImageData(512, 256);
    for (let py = 0; py < 256; py++)
      for (let px = 0; px < 512; px++) {
        const u = px / 512,
          v = 1 - py / 255;
        const w = 0.02 + 0.09 * v * v;
        const d = (((u - 0.62 * Math.pow(v, 0.8)) % 1) + 1) % 1;
        const on = v > 0.08 && d < w;
        const k = (py * 512 + px) * 4;
        const base = 58 + (v < 0.07 ? -20 : 0);
        id.data[k] = id.data[k + 1] = id.data[k + 2] = on ? 236 : base;
        id.data[k + 3] = 255;
      }
    x.putImageData(id, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();
  // heat tint along a lathed part (u around, v along the profile)
  const heatTex = (stops: [number, string][]) => {
    const t = canvasTex(8, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, h, 0, 0);
      stops.forEach(([o, c]) => g.addColorStop(o, c));
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const linerHeat = heatTex([
    [0, '#9a9286'],
    [0.35, '#a2865c'],
    [0.6, '#6f5d78'],
    [0.85, '#4f5f7c'],
    [1, '#8a8e94'],
  ]);
  const nozzleHeat = heatTex([
    [0, '#8b9096'],
    [0.6, '#857a6c'],
    [1, '#6b5a4a'],
  ]);
  const plugHeat = heatTex([
    [0, '#7b6a58'],
    [0.5, '#8e7a63'],
    [1, '#5c4c3e'],
  ]);
  const floorMap = canvasTex(256, 256, (x, w, h) => {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(150,165,178,.13)');
    g.addColorStop(1, 'rgba(150,165,178,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });

  /* ---------- Environment ---------- */
  const envTex = canvasTex(32, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#a3acb3');
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
  scene.fog = new THREE.Fog(0x121518, 320, 720);

  /* ---------- Lights ---------- */
  root.add(new THREE.HemisphereLight(0xc4d4e0, 0x1b1612, 1.1));
  const key = new THREE.DirectionalLight(0xfff8f0, 3.3);
  key.position.set(-60, 140, 110);
  key.target.position.set(45, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 20, far: 450 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.06;
  root.add(key, key.target);
  const rimWarm = new THREE.DirectionalLight(0xffc4a0, 1.6);
  rimWarm.position.set(160, 30, -110);
  root.add(rimWarm);
  const rimCool = new THREE.DirectionalLight(0x9cc4ff, 1.1);
  rimCool.position.set(-150, 20, -80);
  root.add(rimCool);
  const fill = new THREE.DirectionalLight(0xdfe8f0, 1.2);
  fill.position.set(40, -30, 140);
  root.add(fill);

  /* ---------- Section ---------- */
  // cut region = y > 0 AND z > 0 along the whole engine (the classic quarter cutaway)
  const section = new SectionView([new THREE.Plane(V3(0, -1, 0), 0), new THREE.Plane(V3(0, 0, -1), 0)], 0x9a2119);

  /* ---------- Materials ---------- */
  const PART_MATS: Record<string, THREE.MeshStandardMaterial[]> = {};
  const innerMats: THREE.Material[] = [];
  /**
   * Material owned by one part (for the highlight). 'case' = cut in section view and faded in
   * X-ray; 'inner' = cut in section view only; 'rotor' = never cut (blades keep turning whole).
   */
  function pm<M extends THREE.MeshStandardMaterial>(part: string, m: M, kind: 'case' | 'inner' | 'rotor' = 'case'): M {
    (PART_MATS[part] ??= []).push(m);
    if (kind === 'case') section.material(m);
    if (kind === 'inner') {
      m.clipIntersection = true;
      innerMats.push(m);
    }
    return m;
  }
  const paint = () =>
    new THREE.MeshPhysicalMaterial({
      color: 0xe6e9ec,
      metalness: 0.05,
      roughness: 0.38,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
    });
  const liner = () => std({ color: 0xffffff, map: linerMap, metalness: 0.35, roughness: 0.62 });

  const M = {
    inletPaint: pm('inlet', paint()),
    inletLiner: pm('inlet', liner()),
    lip: pm('inlet', std({ color: 0xd9dde1, metalness: 1, roughness: 0.2 })),
    cowlPaint: pm('inlet', paint()),
    fanCase: pm('fan', std({ color: 0x5f666c, metalness: 0.6, roughness: 0.5, bumpMap: castBump, bumpScale: 0.01 })),
    fanBlade: pm('fan', std({ color: 0xc4cad0, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide }), 'rotor'),
    spinner: pm('fan', std({ color: 0xffffff, map: spinnerMap, metalness: 0.55, roughness: 0.32 }), 'inner'),
    fanHub: pm('fan', std({ color: 0x9aa2a9, metalness: 0.85, roughness: 0.32 }), 'inner'),
    boostBlade: pm('booster', std({ color: 0xbcc2c8, metalness: 0.7, roughness: 0.32, side: THREE.DoubleSide }), 'rotor'),
    boostVane: pm('booster', std({ color: 0x8f979e, metalness: 0.85, roughness: 0.34, side: THREE.DoubleSide }), 'inner'),
    boostCase: pm('booster', std({ color: 0x7d858c, metalness: 0.7, roughness: 0.42, bumpMap: castBump, bumpScale: 0.008 })),
    boostDrum: pm('booster', std({ color: 0xa3abb2, metalness: 0.85, roughness: 0.3 }), 'inner'),
    ogv: pm('bypass', std({ color: 0x8c949b, metalness: 0.8, roughness: 0.36, side: THREE.DoubleSide })),
    strut: pm('bypass', std({ color: 0x737b82, metalness: 0.75, roughness: 0.4, side: THREE.DoubleSide })),
    frame: pm('bypass', std({ color: 0x6c747b, metalness: 0.7, roughness: 0.45, bumpMap: castBump, bumpScale: 0.008 })),
    hpcBlade: pm('hpc', std({ color: 0xc8cac4, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }), 'rotor'),
    hpcVane: pm('hpc', std({ color: 0x9b9e99, metalness: 0.85, roughness: 0.33, side: THREE.DoubleSide }), 'inner'),
    hpcCase: pm('hpc', std({ color: 0x878c88, metalness: 0.75, roughness: 0.4, bumpMap: castBump, bumpScale: 0.008 })),
    hpcDrum: pm('hpc', std({ color: 0xa9aca7, metalness: 0.85, roughness: 0.3 }), 'inner'),
    vsv: pm('hpc', std({ color: 0xc2a46a, metalness: 0.8, roughness: 0.35 })),
    combCase: pm('combustor', std({ color: 0x8e8577, metalness: 0.75, roughness: 0.42, bumpMap: castBump, bumpScale: 0.008 })),
    combLiner: pm('combustor', std({ color: 0xffffff, map: linerHeat, metalness: 0.7, roughness: 0.42, side: THREE.DoubleSide }), 'inner'),
    fuel: pm('combustor', std({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.25 })),
    hptBlade: pm('hpt', std({ color: 0xd2b88f, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }), 'rotor'),
    hptVane: pm('hpt', std({ color: 0xd8d0c0, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide }), 'inner'),
    hptCase: pm('hpt', std({ color: 0x7d746a, metalness: 0.75, roughness: 0.45, bumpMap: castBump, bumpScale: 0.008 })),
    hptDisk: pm('hpt', std({ color: 0xa8a49c, metalness: 0.85, roughness: 0.32 }), 'inner'),
    lptBlade: pm('lpt', std({ color: 0xb3ab9f, metalness: 0.7, roughness: 0.36, side: THREE.DoubleSide }), 'rotor'),
    lptVane: pm('lpt', std({ color: 0x8f877c, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }), 'inner'),
    lptCase: pm('lpt', std({ color: 0x6f6961, metalness: 0.75, roughness: 0.45, bumpMap: castBump, bumpScale: 0.008 })),
    lptDrum: pm('lpt', std({ color: 0x9d988f, metalness: 0.85, roughness: 0.33 }), 'inner'),
    acc: pm('lpt', std({ color: 0xb5b9bd, metalness: 0.9, roughness: 0.28 })),
    lpShaft: pm('shafts', std({ color: 0xd2c08a, metalness: 0.95, roughness: 0.25 }), 'inner'),
    hpShaft: pm('shafts', std({ color: 0x7f93ab, metalness: 0.9, roughness: 0.3 }), 'inner'),
    bearing: pm('shafts', std({ color: 0xb98a4e, metalness: 0.9, roughness: 0.3 }), 'inner'),
    sump: pm('shafts', std({ color: 0x5b6268, metalness: 0.65, roughness: 0.5 }), 'inner'),
    trfStrut: pm('exhaust', std({ color: 0x8a8279, metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide }), 'inner'),
    nozzle: pm('exhaust', std({ color: 0xffffff, map: nozzleHeat, metalness: 0.75, roughness: 0.38 })),
    plug: pm('exhaust', std({ color: 0xffffff, map: plugHeat, metalness: 0.7, roughness: 0.45 }), 'inner'),
    trPaint: pm('reverser', paint()),
    trLiner: pm('reverser', liner()),
    ifs: pm('reverser', std({ color: 0x6f777e, metalness: 0.35, roughness: 0.55 })),
    cascade: pm('reverser', std({ color: 0x30353a, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide })),
    door: pm('reverser', std({ color: 0x5a6168, metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide })),
    agb: pm('gearbox', std({ color: 0x6d747b, metalness: 0.65, roughness: 0.48, bumpMap: castBump, bumpScale: 0.01 })),
    gear: pm('gearbox', std({ color: 0xc3c7cb, metalness: 0.95, roughness: 0.25 }), 'inner'),
    idg: pm('gearbox', std({ color: 0x3e4b5e, metalness: 0.5, roughness: 0.45 }), 'inner'),
    access: pm('gearbox', std({ color: 0x8d8f86, metalness: 0.7, roughness: 0.4 }), 'inner'),
    shaftRad: pm('gearbox', std({ color: 0xc9cdd1, metalness: 0.95, roughness: 0.25 }), 'inner'),
  };
  const stand = std({ color: 0xd9a441, metalness: 0.25, roughness: 0.55 });
  const standDark = std({ color: 0x2a2e33, metalness: 0.5, roughness: 0.5 });

  /* ---------- Picking ---------- */
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

  /** Adds a lathed solid; `cut` adds the red section face. */
  function solid(parent: THREE.Object3D, part: string, geo: THREE.BufferGeometry, mat: THREE.Material, cut = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    reg(part, m);
    if (cut) section.addBack(parent, m);
    return m;
  }

  /* ---------- Groups ---------- */
  const fanMod = new THREE.Group(),
    inletG = new THREE.Group(),
    coreMod = new THREE.Group(),
    lptMod = new THREE.Group();
  const lpFan = new THREE.Group(),
    lpTurb = new THREE.Group(),
    hpRot = new THREE.Group();
  fanMod.add(lpFan);
  coreMod.add(hpRot);
  lptMod.add(lpTurb);
  root.add(fanMod, inletG, coreMod, lptMod);

  /* ---------- Blade rows ---------- */
  const variable: BladeRow[] = [];
  const rowMats: Record<RowDef['part'], [THREE.Material, THREE.Material]> = {
    fan: [M.fanBlade, M.fanBlade],
    booster: [M.boostBlade, M.boostVane],
    bypass: [M.ogv, M.ogv],
    hpc: [M.hpcBlade, M.hpcVane],
    hpt: [M.hptBlade, M.hptVane],
    lpt: [M.lptBlade, M.lptVane],
    exhaust: [M.trfStrut, M.trfStrut],
  };
  for (const r of ROWS) {
    const xc = (r.x0 + r.x1) / 2,
      ca = r.x1 - r.x0;
    let spec: BladeSpec;
    const tipR = r.duct ? ductOutR(xc) : coreTipR(xc);
    const rotating = r.spool !== null;
    let rh = r.duct ? cowlR(xc) - 0.2 : hubR(xc) - 0.25;
    let rt = rotating ? tipR - 0.12 : tipR + 0.2;
    if (r.id === 'STRUT') rh = coreTipR(xc) + 0.9;
    if (r.id === 'TRF') rt = coreTipR(xc) + 0.3;
    const chord = (mean: number) => ca / Math.max(Math.cos((mean * Math.PI) / 180), 0.3);
    const small = r.n > 40;
    switch (r.kind) {
      case 'fan':
        rh = 12.2;
        rt = 38.55;
        spec = {
          rHub: rh,
          rTip: rt,
          chord: [11.5, 17.5],
          le: [42, 66],
          te: [8, 54],
          thick: [0.1, 0.028],
          sweep: -1.2,
          nSpan: 12,
          nChord: 13,
        };
        break;
      case 'rotor':
        spec = { rHub: rh, rTip: rt, chord: [chord(32), chord(48)], le: [46, 60], te: [18, 36], thick: [0.09, 0.05] };
        break;
      case 'stator':
        spec = {
          rHub: rh,
          rTip: rt,
          chord: [chord(-22), chord(-22)],
          le: [-42, -40],
          te: [-4, -2],
          thick: [0.08, 0.07],
          nSpan: r.duct ? 4 : 2,
        };
        break;
      case 'ngv':
        spec = { rHub: rh, rTip: rt, chord: [chord(-38), chord(-38)], le: [4, 4], te: [-68, -66], thick: [0.24, 0.22], nSpan: 2 };
        break;
      case 'turbine':
        spec = { rHub: rh, rTip: rt, chord: [chord(14), chord(14)], le: [-36, -26], te: [62, 58], thick: [0.22, 0.12], nSpan: 3 };
        break;
      case 'strut':
      default:
        spec = { rHub: rh, rTip: rt, chord: [ca, ca], le: [0, 0], te: [0, 0], thick: [0.18, 0.18], nSpan: 3 };
    }
    if (small) {
      spec.nChord ??= 7;
      spec.nSpan ??= 3;
    }
    const geo = bladeGeometry(spec);
    const mats = rowMats[r.part];
    const row = new BladeRow(geo, rotating ? mats[0] : mats[1], r.n, xc, rotating ? 0 : Math.PI / r.n);
    const parent =
      r.spool === 'lp'
        ? r.part === 'lpt'
          ? lpTurb
          : lpFan
        : r.spool === 'hp'
          ? hpRot
          : r.part === 'lpt' || r.part === 'exhaust'
            ? lptMod
            : r.part === 'hpc' || r.part === 'hpt'
              ? coreMod
              : fanMod;
    parent.add(row.mesh);
    reg(r.part, row.mesh);
    if (r.variable) variable.push(row);
  }

  /* ---------- Fan rotor ---------- */
  solid(lpFan, 'fan', lathe(shell(hubR, SPINNER_TIP, -1, -0.45, 20), { seg: 128 }), M.spinner);
  solid(
    lpFan,
    'fan',
    lathe([
      [-1, 12.5, 1],
      [12, 14.4, 1],
      [12, 13.0, 1],
      [7, 12.0],
      [6.2, 9.5],
      [6.6, 7.0],
      [6.6, 4.4, 1],
      [2.4, 4.4, 1],
      [2.4, 7.0],
      [2.8, 9.5],
      [2.0, 11.4, 1],
      [-1, 11.6, 1],
    ]),
    M.fanHub,
  );
  // spinner bolts + fan blade retainer ring
  {
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 6).rotateZ(Math.PI / 2), M.fanHub, 12);
    const d = new THREE.Object3D();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      d.position.set(-1.6, 11.6 * Math.cos(a), 11.6 * Math.sin(a));
      d.updateMatrix();
      bolts.setMatrixAt(i, d.matrix);
    }
    lpFan.add(bolts);
  }
  // booster drum + discs
  solid(lpFan, 'booster', lathe(shell(hubR, 12, 34.6, -0.6, 12)), M.boostDrum);
  ROWS.filter((r) => r.part === 'booster' && r.spool).forEach((r) => {
    const xc = (r.x0 + r.x1) / 2,
      h = hubR(xc) - 0.5;
    solid(
      lpFan,
      'booster',
      lathe([
        [xc - 0.5, h, 1],
        [xc + 0.5, h, 1],
        [xc + 0.3, 10.8],
        [xc + 0.9, 10.2, 1],
        [xc + 0.9, 9.0, 1],
        [xc - 0.9, 9.0, 1],
        [xc - 0.9, 10.2, 1],
        [xc - 0.3, 10.8],
      ]),
      M.boostDrum,
    );
  });
  // fan shaft (LP, front part)
  solid(
    lpFan,
    'shafts',
    lathe([
      [3, 4.4, 1],
      [18, 4.4, 1],
      [18, 3.6, 1],
      [3, 3.6, 1],
    ]),
    M.lpShaft,
  );

  /* ---------- Inlet ---------- */
  {
    const lipEnd = -50;
    const lipProf: PP[] = [
      [lipEnd, ductOutR(lipEnd), 1],
      ...sampled(ductOutR, lipEnd, INLET_X, 24).slice(1),
      ...sampled(nacelleR, INLET_X, lipEnd, 24).slice(1),
    ];
    lipProf[lipProf.length - 1] = [lipEnd, nacelleR(lipEnd), 1];
    solid(inletG, 'inlet', lathe(lipProf, { seg: 128 }), M.lip);
    solid(inletG, 'inlet', lathe(shell(nacelleR, lipEnd, -8, -0.6, 16), { seg: 128 }), M.inletPaint);
    solid(inletG, 'inlet', lathe(shell(ductOutR, lipEnd, -8, 0.6, 16), { seg: 128 }), M.inletLiner);
    // aft bulkhead and anti-ice duct (hot bleed air to the lip)
    solid(
      inletG,
      'inlet',
      lathe([
        [-9.2, ductOutR(-9) + 0.6, 1],
        [-8.6, ductOutR(-9) + 0.6, 1],
        [-8.6, nacelleR(-9) - 0.6, 1],
        [-9.2, nacelleR(-9) - 0.6, 1],
      ]),
      M.inletLiner,
    );
    const ai = new THREE.Mesh(new THREE.TorusGeometry(42.3, 0.32, 8, 128).rotateY(Math.PI / 2), M.lip);
    ai.position.x = -50.8;
    inletG.add(ai);
    reg('inlet', ai);
  }

  /* ---------- Fan case, booster case, fan frame ---------- */
  solid(
    fanMod,
    'fan',
    lathe(
      [
        [-8, ductOutR(-8), 1],
        ...sampled(ductOutR, -7, 33, 10),
        [34, ductOutR(34), 1],
        [34, 42.6, 1],
        [33, 42.6, 1],
        [33, 41.3, 1],
        [12, 41.3, 1],
        [11, 42.2, 1],
        [-2, 42.2, 1],
        [-3, 41.3, 1],
        [-7, 41.3, 1],
        [-7, 42.6, 1],
        [-8, 42.6, 1],
      ],
      { seg: 128 },
    ),
    M.fanCase,
  );
  // containment ribs
  for (const x of [0.5, 4, 7.5]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(42.25, 0.22, 6, 128).rotateY(Math.PI / 2), M.fanCase);
    t.position.x = x;
    fanMod.add(t);
  }
  solid(
    fanMod,
    'booster',
    lathe([
      [SPLIT_X, coreTipR(SPLIT_X) + 0.05, 1],
      ...sampled(cowlR, SPLIT_X + 0.2, 20.5, 5),
      [20.5, cowlR(20.5), 1],
      [20.5, 20.4, 1],
      [35, 19.8, 1],
      [35, coreTipR(35) + 0.05, 1],
      ...sampled((x) => coreTipR(x) + 0.05, 34.5, 17.2, 10),
    ]),
    M.boostCase,
  );
  // fan frame: gooseneck outer wall + sump housing (inner wall)
  solid(
    fanMod,
    'bypass',
    lathe([
      ...sampled((x) => coreTipR(x) + 0.05, 35, 44.5, 8),
      [44.5, coreTipR(44.5) + 1.4, 1],
      [41, 17.4, 1],
      [35, 19.6, 1],
    ]),
    M.frame,
  );
  solid(
    fanMod,
    'bypass',
    lathe([
      ...sampled((x) => hubR(x) - 0.05, 34.8, 44, 8),
      [44, 8.6, 1],
      [40.5, 7.6],
      [37, 6.2, 1],
      [34.8, 6.2, 1],
    ]),
    M.frame,
  );
  // fan frame outer ring at the strut tips
  solid(
    fanMod,
    'bypass',
    lathe([
      [33, ductOutR(33), 1],
      [41.5, ductOutR(41.5), 1],
      [41.5, ductOutR(41.5) + 1.3, 1],
      [33, ductOutR(33) + 1.3, 1],
    ]),
    M.frame,
  );
  // forward sump: bearings 1, 2 (fan shaft), 3 (HP thrust bearing)
  const bearingRing = (parent: THREE.Object3D, x: number, r: number, w = 1.1) => {
    solid(
      parent,
      'shafts',
      lathe([
        [x - w / 2, r, 1],
        [x + w / 2, r, 1],
        [x + w / 2, r + 1.0, 1],
        [x - w / 2, r + 1.0, 1],
      ]),
      M.bearing,
    );
  };
  bearingRing(fanMod, 8, 4.45);
  bearingRing(fanMod, 15.5, 4.45);
  bearingRing(fanMod, 39.2, 5.25, 1.4);
  solid(
    fanMod,
    'shafts',
    lathe([
      [7, 5.5, 1],
      [9, 5.5, 1],
      [12, 8.6],
      [14.5, 5.5, 1],
      [16.5, 5.5, 1],
      [16.5, 6.2, 1],
      [34.8, 6.2, 1],
      [34.8, 6.9, 1],
      [15, 6.9, 1],
      [12, 9.4],
      [7, 6.3, 1],
    ]),
    M.sump,
  );

  /* ---------- Accessory drive + gearbox ---------- */
  const gears: { g: THREE.Object3D; ratio: number }[] = [];
  const radial = new THREE.Group();
  {
    // bevel gear on the HP shaft, radial shaft down the 6 o'clock strut, transfer shaft forward
    const bevel = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 6.4, 1.2, 36).rotateZ(Math.PI / 2), M.gear);
    bevel.position.x = 40.6;
    hpRot.add(bevel);
    reg('gearbox', bevel);
    const len = 35;
    const rs = new THREE.Mesh(cylY(0.55, len, 14), M.shaftRad);
    rs.position.y = -len / 2;
    radial.add(rs);
    const stripes = new THREE.Mesh(new THREE.BoxGeometry(0.14, len, 1.18), M.agb);
    stripes.position.y = -len / 2;
    radial.add(stripes);
    radial.position.set(39.4, -6.6, 0);
    radial.rotation.z = -0.17;
    fanMod.add(radial);
    reg('gearbox', radial);
    const tgb = new THREE.Mesh(rbox(3.4, 2.4, 3.4, 0.5, 0.25), M.agb);
    tgb.position.set(33.4, -42.4, 0);
    fanMod.add(tgb);
    reg('gearbox', tgb);
    const ts = new THREE.Mesh(cylX(0.5, 11, 12), M.shaftRad);
    ts.position.set(26.8, -42.7, 0);
    fanMod.add(ts);
    reg('gearbox', ts);
    // banana-shaped gearbox hugging the fan case
    const phi0 = Math.PI / 2 - 0.22,
      phiL = 1.05;
    solid(
      fanMod,
      'gearbox',
      lathe(
        [
          [2, 41.9, 1],
          [22, 41.9, 1],
          [22, 44.3, 1],
          [2, 44.3, 1],
        ],
        { seg: 24, phi: [phi0, phiL] },
      ),
      M.agb,
      false,
    );
    // gear train inside (seen in X-ray), axes along x
    const at = (phi: number, r: number, x: number) => V3(x, -r * Math.sin(phi), r * Math.cos(phi));
    const toothGeo = new THREE.BoxGeometry(0.9, 0.34, 0.3);
    for (let k = 0; k < 6; k++) {
      const phi = phi0 + 0.08 + (k * (phiL - 0.16)) / 5,
        gr = new THREE.Group(),
        r = k % 2 ? 0.95 : 1.15;
      gr.position.copy(at(phi, 43.1, 12));
      const disc = new THREE.Mesh(cylX(r, 0.8, 24), M.gear);
      gr.add(disc);
      const nt = Math.round(r * 16);
      const teeth = new THREE.InstancedMesh(toothGeo, M.gear, nt),
        d = new THREE.Object3D();
      for (let i = 0; i < nt; i++) {
        const a = (i / nt) * TAU;
        d.position.set(0, (r + 0.1) * Math.cos(a), (r + 0.1) * Math.sin(a));
        d.rotation.set(a, 0, 0);
        d.updateMatrix();
        teeth.setMatrixAt(i, d.matrix);
      }
      gr.add(teeth);
      const ax = new THREE.Mesh(cylX(0.25, 22, 8), M.gear);
      gr.add(ax);
      fanMod.add(gr);
      reg('gearbox', gr);
      gears.push({ g: gr, ratio: (k % 2 ? -1 : 1) * (0.9 + k * 0.12) });
    }
    // accessories on the gearbox faces
    const acc = (mat: THREE.Material, phi: number, x0: number, x1: number, r: number) => {
      const m = new THREE.Mesh(cylX(r, Math.abs(x1 - x0), 28), mat);
      m.position.copy(at(phi, 43.1, (x0 + x1) / 2));
      m.castShadow = true;
      fanMod.add(m);
      reg('gearbox', m);
    };
    acc(M.idg, phi0 + 0.2, -5.6, 2, 1.45); // integrated drive generator
    acc(M.access, phi0 + 0.62, -2.5, 2, 1.1); // lube unit
    acc(M.access, phi0 + 0.42, 22, 27, 1.2); // pneumatic starter
    acc(M.idg, phi0 + 0.85, 22, 25.5, 1.0); // hydraulic pump
    acc(M.access, phi0 + 0.15, 22, 26, 1.05); // fuel pump + HMU
  }

  /* ---------- Core: HPC ---------- */
  // HP spool: drum, discs, front stub shaft, aft cone to the HPT disc, the shaft itself
  solid(hpRot, 'hpc', lathe(shell(hubR, 44.2, 78, -0.55, 16)), M.hpcDrum);
  ROWS.filter((r) => r.part === 'hpc' && r.spool).forEach((r) => {
    const xc = (r.x0 + r.x1) / 2,
      h = hubR(xc) - 0.5,
      w = Math.max(0.5, (r.x1 - r.x0) * 0.35);
    solid(
      hpRot,
      'hpc',
      lathe([
        [xc - w, h, 1],
        [xc + w, h, 1],
        [xc + 0.25, 8.6],
        [xc + 0.75, 7.6, 1],
        [xc + 0.75, 6.4, 1],
        [xc - 0.75, 6.4, 1],
        [xc - 0.75, 7.6, 1],
        [xc - 0.25, 8.6],
      ]),
      M.hpcDrum,
    );
  });
  solid(
    hpRot,
    'shafts',
    lathe([
      [38.6, 5.0, 1],
      [97, 5.0, 1],
      [97, 4.2, 1],
      [38.6, 4.2, 1],
    ]),
    M.hpShaft,
  );
  solid(
    hpRot,
    'shafts',
    lathe([
      [44.4, 9.1, 1],
      [41, 5.0, 1],
      [41, 5.6, 1],
      [44.4, 9.7, 1],
    ]),
    M.hpShaft,
  );
  solid(
    hpRot,
    'shafts',
    lathe([
      [77.5, 10.9, 1],
      [95, 7.6, 1],
      [95, 8.2, 1],
      [77.5, 11.5, 1],
    ]),
    M.hpShaft,
  );
  // HPC case with flanges
  {
    const t = 1.1;
    const prof: PP[] = [...sampled((x) => coreTipR(x) + 0.05, 44, 78, 12)];
    const out: PP[] = [];
    const flanges = [44.5, 52, 62.5, 70, 77.5];
    for (let i = 0; i <= 34; i++) {
      const x = 44 + i;
      out.push([x, coreTipR(x) + t + (flanges.some((f) => Math.abs(f - x) < 0.6) ? 0.9 : 0)]);
    }
    prof[0] = [prof[0][0], prof[0][1], 1];
    solid(coreMod, 'hpc', lathe([...prof, [78, coreTipR(78) + t, 1], ...out.reverse()]), M.hpcCase);
  }
  // VSV actuation: unison rings + levers for IGV and stators 1–3
  const vsvRings: THREE.Group[] = [];
  ROWS.filter((r) => r.variable).forEach((r) => {
    const xc = (r.x0 + r.x1) / 2,
      rc = coreTipR(xc) + 1.1,
      rr = rc + 1.2;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.2, 6, 96).rotateY(Math.PI / 2), M.vsv);
    ring.position.x = xc + 0.6;
    g.add(ring);
    const n = Math.min(r.n, 36);
    const lev = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.4, 0.18), M.vsv, n),
      d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      d.position.set(xc + 0.3, (rc + 0.6) * Math.cos(a), (rc + 0.6) * Math.sin(a));
      d.rotation.set(a, 0, 0);
      d.updateMatrix();
      lev.setMatrixAt(i, d.matrix);
    }
    g.add(lev);
    coreMod.add(g);
    reg('hpc', g);
    vsvRings.push(g);
  });
  // VSV actuator (fuel-driven ram) + bleed ducts on the case
  {
    const act = new THREE.Mesh(cylX(0.7, 8, 16), M.vsv);
    act.position.set(49, 0.6, -(coreTipR(49) + 2.4));
    coreMod.add(act);
    reg('hpc', act);
    const at = (x: number, r: number, ph: number) => [x, -r * Math.sin(ph), r * Math.cos(ph)];
    for (const ph of [1.0, 2.4]) {
      const pts = [at(60, coreTipR(60) + 1.6, ph), at(66, coreTipR(66) + 3.6, ph + 0.15), at(75, 18.8, ph + 0.2)];
      reg('hpc', tube(coreMod, pts, 0.55, M.hpcCase, 20));
    }
  }

  /* ---------- Combustor ---------- */
  solid(
    coreMod,
    'combustor',
    lathe([
      [78, coreTipR(78) + 0.05, 1],
      [80.5, 17.6],
      [92, 17.6, 1],
      [93.5, 15.6, 1],
      [93.5, 17.0, 1],
      [92.8, 18.6, 1],
      [92.2, 18.6, 1],
      [80, 18.5],
      [78.6, 15.4, 1],
      [78, 15.4, 1],
    ]),
    M.combCase,
  );
  solid(
    coreMod,
    'combustor',
    lathe([
      [78, 11.55, 1],
      [93, 11.2, 1],
      [93, 10.3, 1],
      [86, 10.1],
      [78, 10.7, 1],
    ]),
    M.combCase,
  );
  // liners + dome
  const linerProf = (rIn: number, rOut0: number, rOut1: number): PP[] => [
    [82.4, rOut0, 1],
    [85, rOut0 + 0.1, 1],
    [85.2, rOut0 - 0.12],
    [88, rOut0 - 0.12 - (rOut0 - rOut1) * 0.4, 1],
    [88.2, rOut0 - 0.32 - (rOut0 - rOut1) * 0.4],
    [92.6, rOut1, 1],
    [92.6, rOut1 - rIn, 1],
    [82.4, rOut0 - rIn, 1],
  ];
  solid(coreMod, 'combustor', lathe(linerProf(0.3, 15.5, 14.5)), M.combLiner);
  solid(
    coreMod,
    'combustor',
    lathe([
      [82.4, 11.9, 1],
      [92.6, 11.45, 1],
      [92.6, 11.75, 1],
      [82.4, 12.2, 1],
    ]),
    M.combLiner,
  );
  solid(
    coreMod,
    'combustor',
    lathe([
      [81.6, 11.6, 1],
      [82.5, 11.9, 1],
      [82.5, 15.5, 1],
      [81.6, 15.8, 1],
      [80.8, 13.7],
    ]),
    M.combLiner,
  );
  // 20 fuel nozzles + swirlers, manifold, 2 igniters
  {
    const N = 20;
    const sw = new THREE.InstancedMesh(cylX(0.85, 0.9, 16), M.fuel, N);
    const stemGeo = cylY(0.28, 5.4, 10);
    const stems = new THREE.InstancedMesh(stemGeo, M.fuel, N);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), M.fuel, N);
    const d = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + 0.08;
      d.rotation.set(a, 0, 0);
      d.position.set(81.4, 13.7 * Math.cos(a), 13.7 * Math.sin(a));
      d.updateMatrix();
      sw.setMatrixAt(i, d.matrix);
      d.position.set(80.9, 16.4 * Math.cos(a), 16.4 * Math.sin(a));
      d.rotation.set(a, 0, 0.12);
      d.updateMatrix();
      stems.setMatrixAt(i, d.matrix);
      d.position.set(80.4, 19.0 * Math.cos(a), 19.0 * Math.sin(a));
      d.rotation.set(a, 0, 0);
      d.updateMatrix();
      heads.setMatrixAt(i, d.matrix);
    }
    coreMod.add(sw, stems, heads);
    const man = new THREE.Mesh(new THREE.TorusGeometry(19.7, 0.32, 8, 128).rotateY(Math.PI / 2), M.fuel);
    man.position.x = 80.4;
    coreMod.add(man);
    const ign = new THREE.InstancedMesh(cylY(0.45, 5, 12), M.vsv, 2);
    [Math.PI * 0.62, Math.PI * 1.38].forEach((a, i) => {
      d.position.set(85, 17.7 * Math.cos(a), 17.7 * Math.sin(a));
      d.rotation.set(a, 0, 0);
      d.updateMatrix();
      ign.setMatrixAt(i, d.matrix);
    });
    coreMod.add(ign);
    [sw, stems, heads, man, ign].forEach((m) => reg('combustor', m));
  }
  // flame
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff8a32,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flame = new THREE.Mesh(
    lathe([
      [82.6, 13.3],
      [84, 12.4],
      [88, 12.1],
      [92.4, 11.9, 1],
      [92.4, 14.2, 1],
      [88, 14.8],
      [84, 14.9],
    ]),
    flameMat,
  );
  coreMod.add(flame);
  flameMat.clipIntersection = true;
  innerMats.push(flameMat);
  const flameCore = new THREE.Mesh(
    lathe([
      [82.6, 13.65],
      [84, 13.1],
      [86.5, 13.0],
      [89, 13.4],
      [86.5, 14.0],
      [84, 14.1],
    ]),
    new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  coreMod.add(flameCore);
  innerMats.push(flameCore.material);
  flameCore.material.clipIntersection = true;
  const fireLight = new THREE.PointLight(0xff7a2e, 0, 40, 2);
  fireLight.position.set(87, 9.5, 9.5);
  coreMod.add(fireLight);

  /* ---------- HP turbine ---------- */
  solid(
    hpRot,
    'hpt',
    lathe([
      [95.4, 11.1, 1],
      [98.3, 11.1, 1],
      [98.0, 9.6],
      [97.6, 8.6],
      [98.5, 7.0, 1],
      [98.5, 5.2, 1],
      [95.1, 5.2, 1],
      [95.1, 7.0, 1],
      [96.0, 8.6],
      [95.6, 9.6],
    ]),
    M.hptDisk,
  );
  solid(
    coreMod,
    'hpt',
    lathe([
      ...sampled((x) => coreTipR(x) + 0.08, 93.5, 101.5, 6),
      [101.5, coreTipR(101.5) + 1.4, 1],
      [100.8, coreTipR(100.8) + 1.4, 1],
      [100.8, coreTipR(100.8) + 1.0, 1],
      [94.5, coreTipR(94.5) + 1.0, 1],
      [93.5, coreTipR(93.5) + 1.5, 1],
    ]),
    M.hptCase,
  );
  for (const x of [95.5, 97.8]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(coreTipR(x) + 1.55, 0.3, 8, 96).rotateY(Math.PI / 2), M.acc);
    t.position.x = x;
    coreMod.add(t);
    reg('hpt', t);
  }
  // bearing 4: inter-shaft roller (HP rotor rides on the LP shaft)
  bearingRing(coreMod, 97.6, 3.35, 1.0);

  /* ---------- LP turbine ---------- */
  solid(lpTurb, 'lpt', lathe(shell(hubR, 102.6, 124.2, -0.55, 12)), M.lptDrum);
  ROWS.filter((r) => r.part === 'lpt' && r.spool).forEach((r) => {
    const xc = (r.x0 + r.x1) / 2,
      h = hubR(xc) - 0.5;
    solid(
      lpTurb,
      'lpt',
      lathe([
        [xc - 0.6, h, 1],
        [xc + 0.6, h, 1],
        [xc + 0.25, 9.2],
        [xc + 0.7, 8.0, 1],
        [xc + 0.7, 7.0, 1],
        [xc - 0.7, 7.0, 1],
        [xc - 0.7, 8.0, 1],
        [xc - 0.25, 9.2],
      ]),
      M.lptDrum,
    );
  });
  solid(
    lpTurb,
    'shafts',
    lathe([
      [123.6, 11.8, 1],
      [127.2, 3.3, 1],
      [127.8, 3.3, 1],
      [124.2, 11.8, 1],
    ]),
    M.lpShaft,
  );
  solid(
    lpTurb,
    'shafts',
    lathe([
      [10, 3.3, 1],
      [128.5, 3.3, 1],
      [128.5, 2.4, 1],
      [10, 2.4, 1],
    ]),
    M.lpShaft,
  );
  bearingRing(lptMod, 126.3, 3.35, 1.0);
  {
    const t = 0.8;
    const inner = sampled((x) => coreTipR(x) + 0.08, 101.5, 124, 14);
    inner[0] = [inner[0][0], inner[0][1], 1];
    const out: PP[] = [];
    for (let i = 0; i <= 45; i++) {
      const x = 101.5 + i * 0.5;
      const fl = [102, 107.6, 113.2, 118.8].some((f) => Math.abs(f - x) < 0.4);
      out.push([x, coreTipR(x) + t + (fl ? 0.6 : 0)]);
    }
    solid(lptMod, 'lpt', lathe([...inner, [124, coreTipR(124) + t, 1], ...out.reverse()]), M.lptCase);
    // active clearance control: cooling-air manifolds around the case
    for (const x of [105, 110.4, 116]) {
      const tor = new THREE.Mesh(new THREE.TorusGeometry(coreTipR(x) + t + 0.75, 0.32, 8, 96).rotateY(Math.PI / 2), M.acc);
      tor.position.x = x;
      lptMod.add(tor);
      reg('lpt', tor);
    }
    reg(
      'lpt',
      tube(
        lptMod,
        [
          [96, -21.2, 0],
          [104, -20.6, 0],
          [112, -21.6, 0],
          [117, -21.2, 0],
        ].map(([x, y, z]) => [x, y, z]),
        0.45,
        M.acc,
        20,
      ),
    );
  }
  // turbine rear frame hub + exhaust plug + core nozzle (aft core cowl)
  solid(
    lptMod,
    'exhaust',
    lathe([
      [124.6, hubR(124.6) - 0.05, 1],
      [131, hubR(131) - 0.05, 1],
      [131, 8, 1],
      [127.6, 4.4, 1],
      [124.6, 4.4, 1],
    ]),
    M.trfStrut,
  );
  solid(lptMod, 'exhaust', lathe(shell(hubR, 131, 152, -0.45, 24), { seg: 96 }), M.plug);
  solid(lptMod, 'exhaust', lathe(shell(cowlR, NOZZLE_X, CORE_EXIT_X, -0.6, 24), { seg: 128 }), M.nozzle);
  // nozzle inner skin closes the gas path from the LPT case to the exit
  solid(lptMod, 'exhaust', lathe(shell((x) => coreTipR(x) + 0.05, 124, CORE_EXIT_X, 0.35, 8)), M.nozzle);

  /* ---------- Cowl halves: fan cowl + thrust reverser (hinged at the pylon) ---------- */
  const halves: { pivot: THREE.Group; sleeve: THREE.Group; doors: THREE.Object3D[]; side: 1 | -1 }[] = [];
  const DOORS_PER_HALF = 5;
  const doorLen = 14.2;
  const doorGeo = (() => {
    // flat trapezoid in the local xz plane: x along the door (from the hinge), z tangential
    const w0 = 21,
      w1 = 13.5,
      th = 0.35;
    const g = new THREE.BufferGeometry();
    const p = [
      [0, 0, -w0 / 2],
      [0, 0, w0 / 2],
      [doorLen, 0, w1 / 2],
      [doorLen, 0, -w1 / 2],
    ];
    const pos: number[] = [];
    [0, -th].forEach((y) => p.forEach(([x, , z]) => pos.push(x, y, z)));
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
    g.computeVertexNormals();
    return g;
  })();
  ([1, -1] as const).forEach((side) => {
    // side 1 = +z half (φ from the top, -π/2, round to the bottom, +π/2)
    const phi: [number, number] = side > 0 ? [-Math.PI / 2, Math.PI] : [Math.PI / 2, Math.PI];
    const pivot = new THREE.Group();
    pivot.position.y = HINGE_Y;
    root.add(pivot);
    const half = new THREE.Group();
    half.position.y = -HINGE_Y;
    pivot.add(half);
    const L = (prof: PP[], seg = 64) => lathe(prof, { seg, phi });
    solid(half, 'inlet', L(shell(nacelleR, -8, 34, -0.6, 20)), M.cowlPaint);
    // inner fixed structure (core cowl, forms the inner wall of the bypass duct)
    solid(half, 'reverser', L(shell(cowlR, 20.5, NOZZLE_X, -0.5, 20)), M.ifs);
    // torque box + cascades (fixed), exposed when the sleeve slides aft
    solid(
      half,
      'reverser',
      L([
        [33.2, 39.6, 1],
        [34.2, 39.6, 1],
        [34.2, 43.2, 1],
        [33.2, 43.2, 1],
      ]),
      M.cascade,
    );
    for (let k = 0; k < 9; k++) {
      const x = CASCADE_X[0] + 1.2 + k * 1.35;
      solid(
        half,
        'reverser',
        L(
          [
            [x, 39.7, 1],
            [x + 0.14, 39.7, 1],
            [x - 0.8, 42.0, 1],
            [x - 0.94, 42.0, 1],
          ],
          48,
        ),
        M.cascade,
        false,
      );
    }
    {
      const ribs = 14,
        rib = new THREE.InstancedMesh(new THREE.BoxGeometry(CASCADE_X[1] - CASCADE_X[0], 2.4, 0.2), M.cascade, ribs),
        d = new THREE.Object3D();
      for (let i = 0; i < ribs; i++) {
        const ph = phi[0] + ((i + 0.5) / ribs) * phi[1];
        d.position.set((CASCADE_X[0] + CASCADE_X[1]) / 2 + 0.5, -40.85 * Math.sin(ph), 40.85 * Math.cos(ph));
        d.rotation.set(ph + Math.PI / 2, 0, 0);
        d.updateMatrix();
        rib.setMatrixAt(i, d.matrix);
      }
      half.add(rib);
      reg('reverser', rib);
    }
    // translating sleeve: outer skin, inner (acoustic) skin
    const sleeve = new THREE.Group();
    half.add(sleeve);
    solid(sleeve, 'reverser', L(shell(nacelleR, 34, NOZZLE_X, -0.6, 24)), M.trPaint);
    solid(sleeve, 'reverser', L(shell(ductOutR, 34, NOZZLE_X - 0.3, 0.6, 24)), M.trLiner);
    solid(
      sleeve,
      'reverser',
      L([
        [34, ductOutR(34) + 0.6, 1],
        [34.6, ductOutR(34) + 0.6, 1],
        [34.6, nacelleR(34.6) - 0.6, 1],
        [34, nacelleR(34) - 0.6, 1],
      ]),
      M.trPaint,
    );
    // blocker doors, hinged at their front edge on the sleeve's inner skin
    const doors: THREE.Object3D[] = [];
    for (let i = 0; i < DOORS_PER_HALF; i++) {
      const ph = phi[0] + ((i + 0.5) / DOORS_PER_HALF) * phi[1];
      const frame = new THREE.Group();
      // local +y = radial out, local +z = tangential, x = axial
      frame.rotation.x = ph + Math.PI / 2;
      frame.position.x = 35;
      const rH = ductOutR(35) - 0.2;
      const hinge = new THREE.Group();
      hinge.position.y = rH;
      frame.add(hinge);
      const door = new THREE.Mesh(doorGeo, M.door);
      door.castShadow = true;
      hinge.add(door);
      sleeve.add(frame);
      reg('reverser', door);
      doors.push(hinge);
    }
    halves.push({ pivot, sleeve, doors, side });
  });

  /* ---------- Gas flow ---------- */
  const flow = new Flow();
  root.add(flow.points);
  flow.points.onBeforeRender = (r, _s, cam) => {
    const c = cam as THREE.PerspectiveCamera;
    flow.setViewport(r.domElement.height, c.fov);
  };

  /* ---------- Transport stand + floor ---------- */
  const FLOOR = -62;
  const standG = new THREE.Group();
  root.add(standG);
  {
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = stand) => {
      const m = new THREE.Mesh(rbox(w, h, d, 0.4, 0.2), mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      standG.add(m);
      return m;
    };
    [-21, 21].forEach((z) => box(150, 2.4, 2.4, 52, FLOOR + 3.6, z));
    [-18, 30, 118].forEach((x) => box(2.4, 2.4, 44, x, FLOOR + 3.6, 0));
    // casters
    [-18, 118].forEach((x) =>
      [-21, 21].forEach((z) => {
        const w = new THREE.Mesh(cylZ2(1.6, 1.2), standDark);
        w.position.set(x, FLOOR + 1.6, z);
        w.castShadow = true;
        standG.add(w);
      }),
    );
    // forward cradle under the fan case
    const cr = new THREE.Mesh(
      lathe(
        [
          [-4, 45.7, 1],
          [6, 45.7, 1],
          [6, 47.2, 1],
          [-4, 47.2, 1],
        ],
        { seg: 24, phi: [Math.PI / 2 - 0.5, 1.0] },
      ),
      stand,
    );
    cr.castShadow = true;
    standG.add(cr);
    [-1, 1].forEach((s) => {
      const y0 = FLOOR + 4.8,
        y1 = -40.6;
      const m = new THREE.Mesh(cylY(1.1, y1 - y0, 16), stand);
      m.position.set(1, (y0 + y1) / 2, s * 21.6);
      m.castShadow = true;
      standG.add(m);
    });
    // aft mount post to the turbine rear frame
    const top = -cowlR(112) - 0.9;
    box(3, top - (FLOOR + 4.8), 3, 112, (top + FLOOR + 4.8) / 2, 0);
    box(8, 1.2, 6, 112, top + 0.3, 0, standDark);

    const sh = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.42 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = FLOOR;
    sh.receiveShadow = true;
    root.add(sh);
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(380, 380),
      new THREE.MeshBasicMaterial({ map: floorMap, transparent: true, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(50, FLOOR - 0.05, 0);
    root.add(disc);
    const pts: number[] = [];
    const R0 = 140;
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * TAU,
        b = ((i + 1) / 200) * TAU;
      pts.push(50 + R0 * Math.cos(a), FLOOR, R0 * Math.sin(a), 50 + R0 * Math.cos(b), FLOOR, R0 * Math.sin(b));
    }
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180,
        l = d % 30 === 0 ? 6 : 2.5;
      pts.push(50 + R0 * Math.cos(a), FLOOR, R0 * Math.sin(a), 50 + (R0 - l) * Math.cos(a), FLOOR, (R0 - l) * Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c343b })));
  }
  function cylZ2(r: number, len: number) {
    return new THREE.CylinderGeometry(r, r, len, 20).rotateX(Math.PI / 2);
  }

  /* ---------- Simulation ---------- */
  const eng = steadyState(leverToN1(84, false));
  const sim: TurbofanSim = { eng, st: stations(eng.n1, eng.egt), a1: 0, a2: 0, explode: 0, reverse: false };
  let time = 0;

  function pose(dt: number, playing: boolean, slow: number, showFlow: boolean) {
    const e = sim.eng,
      ex = smooth(sim.explode);
    if (playing) {
      sim.a1 = (sim.a1 + dt * (e.n1 / 100) * (N1_RPM_100 / 60) * TAU * slow) % TAU;
      sim.a2 = (sim.a2 + dt * (e.n2 / 100) * (N2_RPM_100 / 60) * TAU * slow) % TAU;
    }
    lpFan.rotation.x = lpTurb.rotation.x = sim.a1;
    hpRot.rotation.x = sim.a2;
    radial.children[1].rotation.y = sim.a2 * 1.2;
    gears.forEach(({ g, ratio }) => (g.rotation.x = sim.a2 * ratio * 0.6));
    // variable stators
    const vsv = (vsvClosure(e.n2) * Math.PI) / 180;
    variable.forEach((r) => r.setPitch(-vsv));
    vsvRings.forEach((g) => (g.rotation.x = -vsv * 0.06));
    // modules
    inletG.position.x = EX.inlet * ex;
    coreMod.position.x = EX.core * ex;
    lptMod.position.x = EX.lpt * ex;
    const rv = smooth(e.rev);
    halves.forEach((h) => {
      h.pivot.rotation.x = -h.side * COWL_OPEN * ex;
      h.sleeve.position.x = SLEEVE_TRAVEL * rv;
      const open = smooth(Math.min(1, Math.max(0, (e.rev - 0.25) / 0.75)));
      h.doors.forEach((d) => (d.rotation.z = -1.38 * open));
    });
    // combustion
    const ffN = Math.min(1.2, e.ff / 4430);
    const flick = playing ? 0.9 + 0.06 * Math.sin(time * 37) + 0.04 * Math.sin(time * 91 + 1.3) : 1;
    flameMat.opacity = (0.12 + 0.45 * ffN) * flick;
    flameMat.color.setHSL(0.07 + 0.03 * ffN, 1, 0.5);
    (flameCore.material as THREE.MeshBasicMaterial).opacity = (0.05 + 0.3 * ffN) * flick;
    fireLight.intensity = (20 + 260 * ffN) * flick;
    flow.update(playing ? dt : 0, slow * 50, e.n1, sim.st, e.rev, showFlow && sim.explode < 0.04);
  }

  pose(0, false, SLOWS[1].f, true);

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
      section.apply(id as SectionMode, 0.1);
      innerMats.forEach((m) => {
        m.clippingPlanes = id === 'cut' ? section.planes : null;
        m.needsUpdate = true;
      });
    },
    highlight(k) {
      Object.entries(PART_MATS).forEach(([p, ms]) => ms.forEach((m) => m.emissive.setHex(p === k ? 0x2a1c08 : 0x000000)));
    },
    acceptHit(h, mode) {
      if (mode !== 'cut') return true;
      const p = h.point;
      const clipped = !!((h.object as THREE.Mesh).material as THREE.Material).clippingPlanes;
      return !(p.y > 0 && p.z > 0) || !clipped;
    },
    tags: (
      [
        ['s2', '2', -3, 30],
        ['s25', '25', 44.5, 13.5],
        ['s3', '3', 78.5, 13.4],
        ['s4', '4', 93, 14.4],
        ['s495', '49.5', 107.5, 17.6],
        ['s5', '5', 125, 19.5],
      ] as const
    ).map(([id, text, x, r]) => ({
      id,
      text,
      position: (out) => {
        const off = x < 40 ? 0 : x < 102 ? EX.core : EX.lpt;
        const a = (72 * Math.PI) / 180;
        return out.set(x + off * smooth(sim.explode), r * Math.sin(a), r * Math.cos(a));
      },
    })),
    update({ dt, playing, explode, params }) {
      time += dt;
      sim.explode = explode;
      sim.reverse = params.reverse;
      stepEngine(sim.eng, leverToN1(params.lever, params.reverse), params.reverse, dt);
      sim.st = stations(sim.eng.n1, sim.eng.egt);
      pose(dt, playing, SLOWS[params.slowIdx].f, params.flow);
    },
    dispose() {
      flow.dispose();
      disposeTree(root);
      [spinnerMap, linerMap, linerHeat, nozzleHeat, plugHeat, castBump, floorMap].forEach((t) => t.dispose());
      envRT.dispose();
      if (scene.environment === envRT.texture) scene.environment = prevEnv;
      scene.fog = prevFog;
    },
    sim,
  };
}
