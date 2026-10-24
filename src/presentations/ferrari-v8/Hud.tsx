import { CellGroup, CellGroups, ControlGroup, Stats, presetButtons } from '../../framework/hud';
import type { HudProps } from '../../framework/types';
import { CRANKS, PHASES, SLOWS, bankIntervals, fmt, phaseIdx, type CrankType } from './engine';
import type { FerrariV8Instance, FerrariV8Params } from './scene';

type Props = HudProps<FerrariV8Params>;

/** Per-cylinder stroke cells for both banks + crank telemetry and per-bank firing gaps. */
export function FerrariV8Hud({ instance, params }: Props) {
  const { sim } = instance as FerrariV8Instance;
  const th = sim.theta;
  const bank = (s: 1 | -1) =>
    sim.cyl
      .filter((c) => c.s === s)
      .map((c) => {
        const ph = PHASES[phaseIdx(c.p)];
        return {
          key: c.n,
          label: `Cil. ${c.n}`,
          value: ph.name,
          color: ph.col,
          progress: (c.p % 180) / 180,
          hot: sim.fire === c && c.p < 60,
        };
      });
  const gaps = bankIntervals(params.crank, 1);
  const even = gaps.every((g) => g === gaps[0]);
  return (
    <>
      <CellGroups>
        <CellGroup caption="Banca A (secționată)" cells={bank(1)} phoneCols={2} />
        <CellGroup caption="Banca B" cells={bank(-1)} phoneCols={2} />
      </CellGroups>
      <Stats
        items={[
          { label: 'Arbore cotit', value: fmt(((th % 360) + 360) % 360) + '°' },
          { label: 'Ciclu', value: fmt(((th % 720) + 720) % 720) + '°', unit: '/ 720°' },
          { label: 'Aprinderi banca A', value: gaps.join('·') + '°', unit: even ? 'egale' : 'inegale' },
          { label: 'Viteză piston', value: fmt((2 * 0.083 * params.rpm) / 60, 1), unit: 'm/s', secondary: true },
        ]}
      />
    </>
  );
}

const PRESETS = [
  { label: 'Ralanti', value: 900 },
  { label: '3000', value: 3000 },
  { label: '6000', value: 6000 },
  { label: '8000', value: 8000 },
];

export function FerrariV8Controls({ params, setParams }: Props) {
  return (
    <>
      <ControlGroup
        wide
        caption="Arbore cotit"
        rows={[
          {
            buttons: (Object.keys(CRANKS) as CrankType[]).map((k) => ({
              label: CRANKS[k].short,
              pressed: params.crank === k,
              title: `${CRANKS[k].label} (${CRANKS[k].note})`,
              onClick: () => setParams({ crank: k }),
            })),
          },
        ]}
      />
      <ControlGroup
        range={{
          id: 'rpm',
          label: 'Turație',
          valueText: fmt(params.rpm) + ' rpm',
          min: 900,
          max: 8000,
          step: 50,
          value: params.rpm,
          onChange: (rpm) => setParams({ rpm }),
        }}
        rows={[
          {
            phone: false,
            buttons: [
              ...presetButtons(PRESETS, params.rpm, (rpm) => setParams({ rpm })),
              {
                label: 'Încetinire ' + SLOWS[params.slowIdx].t,
                title: 'Cât de încetinită e animația față de turația reală',
                onClick: () => setParams({ slowIdx: (params.slowIdx + 1) % SLOWS.length }),
              },
            ],
          },
        ]}
      />
    </>
  );
}
