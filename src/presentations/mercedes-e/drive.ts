/*
 * Driving state of the car: speed, gear, engine rpm, coolant warm-up, oil pressure.
 * Published values: W214 E 200 (ADAC / Mercedes data). Shift points, final drive, thermostat and
 * oil-pressure curves are model values, labelled as such in the UI.
 */

export type DriveMode = 'idle' | 'city' | 'highway';

export const DRIVES: Record<DriveMode, { label: string; kmh: number; title: string }> = {
  idle: { label: 'Ralanti', kmh: 0, title: 'Mașina stă pe loc, motorul merge în gol' },
  city: { label: 'Oraș 50', kmh: 50, title: 'Viteză constantă 50 km/h' },
  highway: { label: 'Autostradă 130', kmh: 130, title: 'Viteză constantă 130 km/h' },
};

/** 9G-TRONIC (725.0) ratios. */
export const GEARS = [5.5, 3.33, 2.31, 1.65, 1.21, 1.0, 0.87, 0.72, 0.6];
/** Model value: Mercedes doesn't list it for this version. */
export const FINAL_DRIVE = 2.65;
/** Upshift speeds, km/h, gears 2..9 (model shift map for light-load cruising). */
const UPSHIFT = [12, 22, 32, 42, 56, 68, 82, 98];
/** Rear tyre 275/40 R19: 482.6 + 2 × 110 = 702.6 mm. */
export const WHEEL_D_M = 0.7026;
export const IDLE_RPM = 700;
export const T_OPEN = 88;
export const T_FULL = 103;

export interface DriveSim {
  kmh: number;
  gear: number;
  rpm: number;
  /** wheel rpm */
  wheelRpm: number;
  /** coolant °C */
  temp: number;
  /** thermostat opening 0..1 */
  thermo: number;
  /** electric fan 0..1 */
  fan: number;
  /** oil pressure, bar */
  oilBar: number;
  /** load 0..1 (for exhaust temperature) */
  load: number;
}

export const newDrive = (): DriveSim => ({
  kmh: 0,
  gear: 1,
  rpm: IDLE_RPM,
  wheelRpm: 0,
  temp: 90,
  thermo: 0.2,
  fan: 0,
  oilBar: 1.6,
  load: 0.1,
});

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function gearFor(kmh: number) {
  let g = 1;
  while (g < 9 && kmh >= UPSHIFT[g - 1]) g++;
  return g;
}

/** Advances the car toward `target` km/h; `dt` is real seconds (temperatures run 4× fast). */
export function stepDrive(s: DriveSim, target: number, dt: number) {
  const prev = s.kmh;
  // ~ 2.8 m/s² accelerating, 3.5 m/s² braking
  const acc = target > s.kmh ? 10 : -12.6;
  s.kmh = target > s.kmh ? Math.min(target, s.kmh + acc * dt) : Math.max(target, s.kmh + acc * dt);
  const accel = (s.kmh - prev) / Math.max(dt, 1e-3);
  s.gear = gearFor(s.kmh);
  s.wheelRpm = ((s.kmh / 3.6) / (Math.PI * WHEEL_D_M)) * 60;
  const geared = s.wheelRpm * FINAL_DRIVE * GEARS[s.gear - 1];
  // torque converter slip at walking pace: the engine doesn't drop below idle (+ a little when pulling)
  s.rpm = Math.max(IDLE_RPM + (accel > 0.5 ? 900 : 0), geared);
  // road load + acceleration, very rough: share of max power
  const v = s.kmh / 3.6;
  const powKw = (0.5 * 1.2 * 0.6 * v ** 3 + 1810 * 9.81 * 0.011 * v + 1810 * Math.max(0, accel / 3.6) * v) / 1000;
  s.load = clamp(0.06 + powKw / 150, 0.06, 1);

  // coolant: heat in ∝ fuel burnt, heat out through the radiator when the thermostat is open
  const heat = 0.9 + s.load * 5;
  s.thermo = clamp((s.temp - T_OPEN) / (T_FULL - T_OPEN), 0, 1);
  s.fan = s.temp > 98 && s.kmh < 70 ? clamp((s.temp - 98) / 4, 0.3, 1) : 0;
  const air = 0.6 + s.kmh / 60 + s.fan * 2;
  const cool = 0.015 + s.thermo * 0.11 * air;
  const fast = 4;
  s.temp += dt * fast * (heat * 0.25 - cool * Math.max(0, s.temp - 25) * 0.25);
  s.temp = clamp(s.temp, 5, 110);
  // oil pressure: pump output grows with rpm, cold (thick) oil reads higher
  s.oilBar = clamp((0.9 + s.rpm / 1000) * (1 + (90 - s.temp) / 160), 0.8, 5.2);
}

/** Model exhaust gas temperature before the catalyst, °C. */
export const exhaustTemp = (s: DriveSim) => Math.round(330 + s.load * 520 + (s.rpm - IDLE_RPM) * 0.04);

export const fmt = (v: number, d = 0) =>
  v.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
