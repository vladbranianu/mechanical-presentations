/*
 * Renault D4F 1.2 16V (Dacia Sandero 2009): geometry + kinematics. 1 scene unit = 10 mm.
 * Crank along x (cylinder 1 at the flywheel end, +x, Renault numbering), cylinders up (+y),
 * intake at the back (z < 0), exhaust at the front (z > 0).
 */

export const BORE = 6.9;
export const R = 3.84; // crank radius (stroke 76,8 mm)
export const L = 12.8; // rod length (centres), model value
export const CH = 2.6; // pin-to-crown height
export const DECK = R + L + CH + 0.1;
export const PITCH = 7.6; // cylinder pitch
export const LAMBDA = R / L;

/** Block / head extents along the crank. */
export const BLOCK_X = 16.9;
export const HEAD_TOP = DECK + 9;

/** Valve train. Valves lean out of the pent roof by VALVE_ANG; s = -1 intake (back), +1 exhaust. */
export const VALVE_ANG = 18;
export const VALVE_SEAT = { z: 1.55, y: DECK + 0.6 };
export const VALVE_STEM = 8.8;
export const VALVE_DX = 1.45; // the two valves of a side sit at cx ± VALVE_DX
export const MAX_LIFT = 0.78;
export const CAM_Y = 27.91;
export const CAM_RB = 1.15; // base circle
export const ROLLER_R = 0.45;
export const ROCKER_SHAFT = { z: 2.8, y: 29.6 };
export const ROLLER = { z: 0.8, y: 29.3 };
export const LOBE_DX = 1.1; // intake lobe at cx - LOBE_DX, exhaust at cx + LOBE_DX
/** Spark plug leans towards the exhaust side, between the two exhaust valves. */
export const PLUG_ANG = 28;

/** Valve timing in crank degrees of the 720° cycle (0 = TDC firing). Model values. */
export const IN_OPEN = 350,
  IN_CLOSE = 590,
  EX_OPEN = 130,
  EX_CLOSE = 370,
  SPARK_ADV = 12;

/** Timing belt (toothed) in the plane x = TB_X, pulleys given as (z, y, r). */
export const TB_X = -19;
export const TB = {
  crank: { z: 0, y: 0, r: 1.75 },
  wp: { z: -4.2, y: 9, r: 2.0 },
  cam: { z: 0, y: CAM_Y, r: 3.5 },
  tens: { z: 3.4, y: 10, r: 1.5 },
};

/** Accessory belt (poly-V) in the plane x = AB_X. */
export const AB_X = -21.9;
export const AB = {
  crank: { z: 0, y: 0, r: 2.9 },
  ps: { z: -9.8, y: 3, r: 2.4 },
  alt: { z: -10.2, y: 13.5, r: 1.3 },
  tens: { z: -1.5, y: 10.2, r: 1.2 },
};

export interface Pulley {
  z: number;
  y: number;
  r: number;
}

/** T = firing offset in the 720° cycle (order 1-3-4-2). phi = crankpin phase. */
export interface CylDef {
  n: number;
  x: number;
  T: number;
  phi: number;
}

export const CYL: CylDef[] = (
  [
    { n: 1, x: 1.5 * PITCH, T: 0 },
    { n: 2, x: 0.5 * PITCH, T: 540 },
    { n: 3, x: -0.5 * PITCH, T: 180 },
    { n: 4, x: -1.5 * PITCH, T: 360 },
  ] as const
).map((c) => ({ ...c, phi: c.T % 360 }));

export const FIRING = [1, 3, 4, 2];

export const PHASES = [
  { name: 'Admisie', col: '#5ec8d8' },
  { name: 'Compresie', col: '#8f9cf2' },
  { name: 'Detentă', col: '#ff7a2e' },
  { name: 'Evacuare', col: '#a39383' },
];
/** Phase index for a cylinder at cycle angle p (0..720, 0 = firing TDC). */
export const phaseIdx = (p: number) => (p < 180 ? 2 : p < 360 ? 3 : p < 540 ? 0 : 1);

/** Normalised valve lift 0..1 for cycle angle p, open window [o, c). */
export function lift(p: number, o: number, c: number) {
  const dur = (((c - o) % 720) + 720) % 720,
    d = (((p - o) % 720) + 720) % 720;
  return d > dur ? 0 : Math.pow(Math.sin((Math.PI * d) / dur), 1.4);
}

export const SLOWS = [
  { f: 1 / 10, t: '×1/10' },
  { f: 1 / 40, t: '×1/40' },
  { f: 1 / 200, t: '×1/200' },
];

export const RPM_MIN = 700,
  RPM_MAX = 6200;

export const omega = (rpm: number) => (rpm * 2 * Math.PI) / 60;
export const fmt = (v: number, d = 0) =>
  v.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
