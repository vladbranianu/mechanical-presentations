/*
 * Ferrari F154 (3.9 L twin-turbo 90° V8) geometry + kinematics. 1 scene unit = 10 mm.
 *
 * Crank axis = x (front/accessories at -x, flywheel + timing chain at +x). Cylinder axes lie in
 * the y-z plane, 45° either side of vertical. Angles in the y-z plane are measured from +y
 * towards +z, so bank A (cylinders 1-4) sits at +45° (z > 0) and bank B (5-8) at -45°.
 */

export const R = 4.15; // crank radius (stroke 83 mm)
export const L = 14.4; // rod length between centres (not published; model value)
export const BORE = 8.65; // 86.5 mm
export const CH = 2.9; // pin-to-crown height
export const DECK = R + L + CH + 0.45;
export const PITCH = 10.6; // crankpin spacing
export const OFF = 1.2; // the two rods on one pin sit side by side
export const LAMBDA = R / L;
export const BANK_DEG = 45; // half of the 90° V

/** Valve timing in crank degrees of the 720° cycle (0 = firing TDC). Illustrative: the real
 *  engine varies both cams continuously and Ferrari does not publish the diagram. */
export const IN_OPEN = 345,
  IN_CLOSE = 575,
  EX_OPEN = 150,
  EX_CLOSE = 375,
  SPARK_ADV = 15;

export type CrankType = 'flat' | 'cross';

/** Firing orders, Ferrari numbering (1-4 bank A, 5-8 bank B; pin j carries cylinders j and j+4). */
export const CRANKS: Record<CrankType, { label: string; short: string; order: number[]; note: string }> = {
  flat: { label: 'Flat-plane 180°', short: 'Flat-plane', order: [1, 5, 3, 7, 4, 8, 2, 6], note: 'Ferrari F154' },
  cross: { label: 'Cross-plane 90°', short: 'Cross-plane', order: [1, 3, 7, 2, 6, 5, 4, 8], note: 'ex. Ford Coyote 5.0' },
};

export interface CylDef {
  n: number;
  /** +1 = bank A (the cut one), -1 = bank B */
  s: 1 | -1;
  /** crankpin index 0..3 */
  pin: number;
  x: number;
  /** bank axis angle in degrees (from +y towards +z) */
  alpha: number;
}

export const CYL: CylDef[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
  const s = n <= 4 ? 1 : -1,
    pin = (n - 1) % 4;
  return { n, s, pin, x: (pin - 1.5) * PITCH - s * OFF, alpha: s * BANK_DEG } as CylDef;
});

/** Firing offset (720° cycle) for every cylinder, indexed by n - 1. */
export function firingOffsets(t: CrankType) {
  const T: number[] = [];
  CRANKS[t].order.forEach((n, i) => (T[n - 1] = i * 90));
  return T;
}

/**
 * Crankpin phases (degrees) that make each cylinder reach firing TDC at its offset. The crank
 * turns so a pin's angle is (phase - θ); a cylinder is at TDC when that equals its bank angle.
 * Both cylinders on a pin must agree; that is what makes a firing order valid for a crank.
 */
export function pinPhases(t: CrankType) {
  const T = firingOffsets(t),
    ph: number[] = [];
  for (const c of CYL) {
    const p = (((c.alpha + T[c.n - 1]) % 360) + 360) % 360;
    if (ph[c.pin] !== undefined && Math.abs(ph[c.pin] - p) > 1e-6)
      throw new Error(`firing order ${t} does not fit pin ${c.pin + 1}`);
    ph[c.pin] = p;
  }
  return ph;
}

/** Crank-degree gaps between consecutive firings within one bank, starting at its first cylinder. */
export function bankIntervals(t: CrankType, s: 1 | -1) {
  const T = firingOffsets(t);
  const times = CYL.filter((c) => c.s === s)
    .map((c) => T[c.n - 1])
    .sort((a, b) => a - b);
  return times.map((v, i) => (i < times.length - 1 ? times[i + 1] - v : 720 - v + times[0]));
}

export const PHASES = [
  { name: 'Admisie', col: '#5ec8d8' },
  { name: 'Compresie', col: '#8f9cf2' },
  { name: 'Detentă', col: '#ff7a2e' },
  { name: 'Evacuare', col: '#a39383' },
];
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

export const omega = (rpm: number) => (rpm * 2 * Math.PI) / 60;
export const fmt = (v: number, d = 0) =>
  v.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Front accessory drive, pulleys in the y-z plane at x = BELT_X. All sit on the belt's hull. */
export const BELT_X = -29.4;
export const PUL = {
  crank: { y: 0, z: 0, r: 4.6 },
  ac: { y: -2, z: -10, r: 2.8 },
  idler: { y: 12, z: -7, r: 1.5 },
  wp: { y: 16, z: 0, r: 3.0 },
  alt: { y: 12, z: 8, r: 2.2 },
  tens: { y: -1, z: 8, r: 1.6 },
};
export type PulleyKey = keyof typeof PUL;
