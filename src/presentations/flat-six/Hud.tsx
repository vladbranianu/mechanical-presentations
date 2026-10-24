import { CellGroup, CellGroups, ControlGroup, Stats, presetButtons } from '../../framework/hud';
import type { HudProps } from '../../framework/types';
import { LAMBDA, PHASES, SLOWS, fmt, omega, phaseIdx } from './engine';
import type { FlatSixInstance, FlatSixParams } from './scene';

type Props = HudProps<FlatSixParams>;

/** Per-cylinder stroke cells for both banks + crank telemetry. */
export function FlatSixHud({ instance, params }: Props) {
  const { sim } = instance as FlatSixInstance;
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
  return (
    <>
      <CellGroups>
        <CellGroup caption="Banca A (secționată)" cells={bank(1)} />
        <CellGroup caption="Banca B" cells={bank(-1)} />
      </CellGroups>
      <Stats
        items={[
          { label: 'Arbore cotit', value: fmt(((th % 360) + 360) % 360) + '°' },
          { label: 'Ciclu', value: fmt(((th % 720) + 720) % 720) + '°', unit: '/ 720°' },
          { label: 'Viteză piston', value: fmt((2 * 0.0764 * params.rpm) / 60, 1), unit: 'm/s', secondary: true },
          {
            label: 'Acc. la PMS',
            value: fmt((0.0382 * omega(params.rpm) ** 2 * (1 + LAMBDA)) / 9.81),
            unit: 'g',
            secondary: true,
          },
        ]}
      />
    </>
  );
}

const PRESETS = [
  { label: 'Ralanti', value: 850 },
  { label: '3000', value: 3000 },
  { label: '6000', value: 6000 },
  { label: '7800', value: 7800 },
];

export function FlatSixControls({ params, setParams }: Props) {
  return (
    <ControlGroup
      range={{
        id: 'rpm',
        label: 'Turație',
        valueText: fmt(params.rpm) + ' rpm',
        min: 800,
        max: 7800,
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
  );
}
