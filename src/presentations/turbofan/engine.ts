/*
 * CFM56-7B26 (Boeing 737-800): flowpath, blade rows and a simplified performance model.
 * 1 scene unit = 20 mm. The engine axis is +x (air flows towards +x), the fan face is at x = 0.
 */

/* ---------- Ratings ---------- */
export const N1_RPM_100 = 5175; // 100 % N1
export const N2_RPM_100 = 14460; // 100 % N2
export const N1_IDLE = 21;
export const N1_TO = 98;
export const N1_REV_MAX = 82;
export const EGT_LIMIT = 950;
export const THRUST_TO_KN = 117; // 26 300 lbf
export const AIRFLOW_TO = 345; // kg/s
export const FAN_D = 1.55; // m

/* ---------- Flowpath (x, r) tables ---------- */
type Table = [number, number][];

function interp(t: Table, x: number) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1],
        [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

export const SPINNER_TIP = -17;
export const FAN_X = 0;
export const SPLIT_X = 16.5;
export const INLET_X = -56.2;
export const NOZZLE_X = 72; // fan (bypass) nozzle exit
export const CORE_EXIT_X = 132; // core nozzle exit
export const PLUG_TIP = 152;

/** Spinner profile: blunt ogive from the tip to the fan hub. */
const spinner: Table = [];
for (let i = 0; i <= 16; i++) {
  const t = i / 16;
  spinner.push([SPINNER_TIP + t * 16, 12.5 * Math.pow(Math.sin((t * Math.PI) / 2), 0.82)]);
}
const plug: Table = [];
for (let i = 0; i <= 12; i++) {
  const t = i / 12;
  plug.push([131 + t * (PLUG_TIP - 131), 12.5 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.7)))]);
}

/** Inner wall of the gas path (spinner, rotor drums, combustor inner casing, exhaust plug). */
export const HUB: Table = [
  ...spinner,
  [12, 14.4],
  [18, 14.6],
  [34, 15.3],
  [36, 15.0],
  [40, 12.2],
  [44, 9.6],
  [78, 11.6],
  [82, 11.2],
  [93, 11.3],
  [100, 11.5],
  [103, 11.8],
  [124, 12.5],
  ...plug,
];
/** Outer wall of the core gas path, from the splitter lip to the core nozzle. */
export const CORE_TIP: Table = [
  [SPLIT_X, 19.9],
  [18, 19.3],
  [34, 17.6],
  [36, 17.2],
  [40, 15.6],
  [44, 14.4],
  [78, 12.6],
  [80, 14.0],
  [82, 15.6],
  [86, 15.9],
  [91, 15.3],
  [93, 14.4],
  [100, 15.0],
  [103, 16.3],
  [124, 20.0],
  [128, 19.8],
  [CORE_EXIT_X, 19.0],
];
/** Outer wall of the inlet + bypass duct (nacelle inner skin). */
export const DUCT_OUT: Table = [
  [-56.2, 41.6],
  [-56.0, 41.0],
  [-55.5, 40.6],
  [-54.5, 40.25],
  [-53, 40.0],
  [-50, 39.9],
  [-40, 39.7],
  [-20, 39.4],
  [-6, 39.05],
  [12, 39.05],
  [20, 39.3],
  [30, 39.5],
  [40, 39.0],
  [50, 37.8],
  [60, 36.0],
  [NOZZLE_X, 33.9],
];
/** Inner wall of the bypass duct (core cowl outer skin). */
export const CORE_COWL: Table = [
  [SPLIT_X, 20.0],
  [18, 20.8],
  [22, 22.0],
  [30, 23.2],
  [45, 24.3],
  [60, 24.4],
  [72, 24.1],
  [85, 24.0],
  [100, 23.8],
  [112, 23.5],
  [120, 22.6],
  [126, 21.4],
  [CORE_EXIT_X, 19.5],
];
/** Nacelle outer skin. */
export const NACELLE_OUT: Table = [
  [-56.2, 41.6],
  [-56.1, 42.3],
  [-55.7, 42.95],
  [-54.8, 43.6],
  [-53, 44.3],
  [-49, 44.95],
  [-35, 45.4],
  [-10, 45.5],
  [20, 45.3],
  [35, 44.6],
  [50, 42.6],
  [62, 38.6],
  [NOZZLE_X, 34.4],
];

export const hubR = (x: number) => interp(HUB, x);
export const coreTipR = (x: number) => interp(CORE_TIP, x);
export const ductOutR = (x: number) => interp(DUCT_OUT, x);
export const cowlR = (x: number) => interp(CORE_COWL, x);
export const nacelleR = (x: number) => interp(NACELLE_OUT, x);

/* ---------- Blade rows ---------- */
export type RowKind = 'fan' | 'rotor' | 'stator' | 'ngv' | 'turbine' | 'strut';
export interface RowDef {
  id: string;
  part: 'fan' | 'booster' | 'bypass' | 'hpc' | 'hpt' | 'lpt' | 'exhaust';
  kind: RowKind;
  /** Which spool turns it (stators: null). */
  spool: 'lp' | 'hp' | null;
  x0: number;
  x1: number;
  n: number;
  /** Bypass-duct row (between the core cowl and the nacelle). */
  duct?: boolean;
  /** Variable stator vane row. */
  variable?: boolean;
}

function stages(
  prefix: string,
  part: RowDef['part'],
  spool: 'lp' | 'hp',
  x0: number,
  x1: number,
  count: number,
  rotorN: number[],
  statorN: number[],
  turbine = false,
  variable = 0,
): RowDef[] {
  const out: RowDef[] = [];
  const pitch = (x1 - x0) / count;
  for (let i = 0; i < count; i++) {
    const a = x0 + i * pitch;
    const first: RowDef = {
      id: `${prefix}${turbine ? 'N' : 'R'}${i + 1}`,
      part,
      kind: turbine ? 'ngv' : 'rotor',
      spool: turbine ? null : spool,
      x0: a + pitch * 0.05,
      x1: a + pitch * 0.45,
      n: turbine ? statorN[i] : rotorN[i],
    };
    const second: RowDef = {
      id: `${prefix}${turbine ? 'R' : 'S'}${i + 1}`,
      part,
      kind: turbine ? 'turbine' : 'stator',
      spool: turbine ? spool : null,
      x0: a + pitch * 0.55,
      x1: a + pitch * 0.93,
      n: turbine ? rotorN[i] : statorN[i],
      variable: !turbine && i < variable,
    };
    out.push(first, second);
  }
  return out;
}

export const ROWS: RowDef[] = [
  { id: 'FAN', part: 'fan', kind: 'fan', spool: 'lp', x0: -1, x1: 10, n: 24 },
  ...stages('B', 'booster', 'lp', 19.2, 34.6, 3, [64, 72, 76], [88, 96, 100]),
  { id: 'OGV', part: 'bypass', kind: 'stator', spool: null, x0: 24, x1: 30, n: 68, duct: true },
  { id: 'STRUT', part: 'bypass', kind: 'strut', spool: null, x0: 33, x1: 41, n: 12, duct: true },
  { id: 'CSTRUT', part: 'bypass', kind: 'strut', spool: null, x0: 36, x1: 41.5, n: 12 },
  { id: 'IGV', part: 'hpc', kind: 'stator', spool: null, x0: 44.2, x1: 45.6, n: 44, variable: true },
  ...stages(
    'C',
    'hpc',
    'hp',
    46,
    77.2,
    9,
    [38, 53, 60, 68, 75, 82, 82, 80, 76],
    [52, 64, 72, 80, 88, 100, 108, 116, 124],
    false,
    3,
  ),
  ...stages('H', 'hpt', 'hp', 92.8, 98.8, 1, [80], [42], true),
  ...stages('L', 'lpt', 'lp', 102.6, 124, 4, [162, 150, 150, 134], [96, 104, 108, 112], true),
  { id: 'TRF', part: 'exhaust', kind: 'strut', spool: null, x0: 125, x1: 130, n: 16 },
];

/* ---------- Simplified performance model ----------
 * Calibrated on two anchors (ground idle and take-off, sea-level static, ISA) and
 * interpolated with smooth power laws. Good for trends, not for an engine shop. */
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Power fraction 0 (idle) .. 1 (take-off) from N1 %. */
export const powerFrac = (n1: number) => clamp((n1 - N1_IDLE) / (N1_TO - N1_IDLE), 0, 1.06);

export const n2Steady = (n1: number) => 60 + 37 * Math.pow(powerFrac(n1), 0.75);
/** Fuel flow at steady state, kg/h. */
export const ffSteady = (n1: number) => 330 + 4100 * Math.pow(powerFrac(n1), 1.9);
export const thrustSteady = (n1: number) => THRUST_TO_KN * Math.pow(Math.max(n1, 0) / N1_TO, 2.4);
export const airflow = (n1: number) => AIRFLOW_TO * Math.pow(Math.max(n1, 1) / N1_TO, 1.15);
export const bypassRatio = (n1: number) => 5.1 + 2 * (1 - Math.min(1, powerFrac(n1)));

export interface Stations {
  /** °C */
  t2: number;
  t25: number;
  t3: number;
  tFlame: number;
  t4: number;
  egt: number;
  t5: number;
  /** bar */
  p2: number;
  p25: number;
  p3: number;
  p4: number;
  p495: number;
  p5: number;
}

export function stations(n1: number, egt: number): Stations {
  const p = powerFrac(n1);
  const pa = 1.013;
  const t3 = 170 + 420 * Math.pow(p, 1.2);
  const t4 = 560 + 840 * Math.pow(p, 1.3);
  const p3 = pa * (3.5 + 28.5 * Math.pow(p, 1.6));
  return {
    t2: 15,
    t25: 25 + 85 * Math.pow(p, 1.4),
    t3,
    tFlame: t4 + 380 + 220 * p,
    t4,
    egt,
    t5: egt - 60 - 140 * p,
    p2: pa,
    p25: pa * (1.1 + 1.7 * Math.pow(p, 1.5)),
    p3,
    p4: p3 * 0.95,
    p495: pa * (1.3 + 4 * Math.pow(p, 1.4)),
    p5: pa * (1.04 + 0.62 * Math.pow(p, 1.3)),
  };
}

const egtSteady = (n1: number) => 440 + 460 * Math.pow(powerFrac(n1), 1.5);

export interface EngineState {
  /** % */
  n1: number;
  n2: number;
  /** kg/h */
  ff: number;
  egt: number;
  /** commanded N1 % */
  n1Cmd: number;
  /** 0..1 thrust-reverser sleeve travel */
  rev: number;
}

export function steadyState(n1: number): EngineState {
  return { n1, n2: n2Steady(n1), ff: ffSteady(n1), egt: egtSteady(n1), n1Cmd: n1, rev: 0 };
}

/** Lever 0..100 → commanded N1 %. */
export const leverToN1 = (lever: number, reverse: boolean) => {
  const n1 = N1_IDLE + ((N1_TO - N1_IDLE) * lever) / 100;
  return reverse ? Math.min(n1, N1_REV_MAX) : n1;
};

/**
 * One step of the spool dynamics, in real time (not slowed down).
 * The fuel control adds fuel above the steady-state need to accelerate (capped by an
 * acceleration schedule) and cuts it to decelerate. Excess fuel shows up as EGT overshoot.
 */
export function stepEngine(s: EngineState, n1Cmd: number, reverse: boolean, dt: number) {
  s.n1Cmd = n1Cmd;
  const need = ffSteady(s.n1);
  const k = clamp((n1Cmd - s.n1) * 0.09, -0.5, 0.6);
  const ffTarget = need * (1 + k);
  s.ff += (ffTarget - s.ff) * (1 - Math.exp(-dt / 0.25));
  const excess = s.ff / need - 1;
  s.n1 = clamp(s.n1 + 21 * excess * dt, 0, 106);
  s.n2 += (n2Steady(s.n1) + 5 * excess - s.n2) * (1 - Math.exp(-dt / 0.3));
  s.egt += (egtSteady(s.n1) + 70 * excess - s.egt) * (1 - Math.exp(-dt / 0.6));
  // sleeve travel ~2 s
  s.rev = clamp(s.rev + (reverse ? 1 : -1) * dt * 0.5, 0, 1);
}

/** Net thrust in kN (negative = reverse). The core jet still pushes forward in reverse. */
export function netThrust(s: EngineState) {
  const t = thrustSteady(s.n1);
  const rv = smooth(s.rev);
  return t * (1 - rv) + t * (0.2 - 0.8 * 0.55) * rv;
}

export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Variable stator closure, degrees: closed at low N2, open at high N2. */
export const vsvClosure = (n2: number) => 32 * clamp((93 - n2) / 33, 0, 1);

/** Gas velocity at take-off, m/s, along the core and the bypass stream. */
export const V_CORE: Table = [
  [-90, 110],
  [-17, 150],
  [0, 170],
  [SPLIT_X, 160],
  [34, 150],
  [44, 140],
  [78, 105],
  [82, 45],
  [90, 40],
  [93, 260],
  [100, 300],
  [103, 220],
  [124, 250],
  [CORE_EXIT_X, 390],
  [220, 300],
];
export const V_BYPASS: Table = [
  [-90, 110],
  [0, 170],
  [20, 160],
  [40, 170],
  [60, 230],
  [NOZZLE_X, 300],
  [170, 240],
];
export const vCore = (x: number) => interp(V_CORE, x);
export const vBypass = (x: number) => interp(V_BYPASS, x);

/** Core gas temperature along x for the given station temperatures, °C. */
export function coreTemp(st: Stations, x: number) {
  const t: Table = [
    [-90, st.t2],
    [0, st.t2],
    [12, (st.t2 + st.t25) / 2],
    [34, st.t25],
    [44, st.t25],
    [78, st.t3],
    [82, st.t3],
    [84.5, st.tFlame * 0.7],
    [87, st.tFlame],
    [91, st.t4 * 1.06],
    [93, st.t4],
    [99, st.egt + 70],
    [104, st.egt],
    [124, st.t5],
    [CORE_EXIT_X, st.t5],
    [220, st.t5 * 0.6],
  ];
  return interp(t, x);
}

export const SLOWS = [
  { f: 1 / 100, t: '×1/100' },
  { f: 1 / 200, t: '×1/200' },
  { f: 1 / 1000, t: '×1/1000' },
];

export const fmt = (v: number, d = 0) =>
  v.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
