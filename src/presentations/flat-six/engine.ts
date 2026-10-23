/* Engine geometry + kinematics. 1 scene unit = 10 mm. */

export const R = 3.82; // crank radius
export const L = 12.7; // rod length (centres)
export const BORE = 9.6;
export const CH = 3.0; // pin-to-crown height
export const DECK = R + L + CH + 0.45;
export const PAIR = 11.8; // cylinder pitch along the crank
export const OFF = 1.35; // bank offset
export const LAMBDA = R / L;

/** Valve timing in crank degrees of the 720° cycle (0 = TDC firing). */
export const IN_OPEN = 345,
  IN_CLOSE = 575,
  EX_OPEN = 155,
  EX_CLOSE = 375,
  SPARK_ADV = 15;

export const BELT_X = -25.6;
export const PUL = {
  crank: { y: 0, z: 0, r: 5.5 },
  ac: { y: -7.5, z: -9, r: 3.1 },
  wp: { y: 5.5, z: -8.5, r: 2.9 },
  idler: { y: 11.5, z: -1.5, r: 1.6 },
  alt: { y: 11.5, z: 7, r: 2.2 },
  tens: { y: 2.5, z: 9, r: 1.7 },
};
export type PulleyKey = keyof typeof PUL;

/** s = bank (+1 = A, the cut one; -1 = B). T = firing offset in the 720° cycle (order 1-6-2-4-3-5). */
export interface CylDef {
  n: number;
  s: 1 | -1;
  x: number;
  T: number;
  /** crankpin phase in degrees */
  phi: number;
}

export const CYL: CylDef[] = (
  [
    { n: 1, s: 1, x: -PAIR - OFF, T: 0 },
    { n: 2, s: 1, x: -OFF, T: 240 },
    { n: 3, s: 1, x: PAIR - OFF, T: 480 },
    { n: 4, s: -1, x: -PAIR + OFF, T: 360 },
    { n: 5, s: -1, x: OFF, T: 600 },
    { n: 6, s: -1, x: PAIR + OFF, T: 120 },
  ] as const
).map((c) => ({ ...c, phi: (((c.s > 0 ? -c.T : 180 - c.T) % 360) + 360) % 360 }));

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

export const omega = (rpm: number) => (rpm * 2 * Math.PI) / 60;
export const fmt = (v: number, d = 0) =>
  v.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
