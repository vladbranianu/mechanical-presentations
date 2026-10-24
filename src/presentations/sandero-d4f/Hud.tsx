import { CellGroup, CellGroups, ControlGroup, Stats, presetButtons } from '../../framework/hud';
import type { HudProps } from '../../framework/types';
import { FIRING, LAMBDA, PHASES, RPM_MAX, RPM_MIN, SLOWS, fmt, omega, phaseIdx } from './engine';
import type { SanderoInstance, SanderoParams } from './scene';

type Props = HudProps<SanderoParams>;

/** Per-cylinder stroke cells (in firing order) + crank telemetry. */
export function SanderoHud({ instance, params }: Props) {
  const { sim } = instance as SanderoInstance;
  const th = sim.theta;
  const cells = FIRING.map((n) => {
    const c = sim.cyl.find((k) => k.n === n)!;
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
        <CellGroup caption="Ordine de aprindere 1-3-4-2" cells={cells} phoneCols={4} />
      </CellGroups>
      <Stats
        items={[
          { label: 'Arbore cotit', value: fmt(((th % 360) + 360) % 360) + '°' },
          { label: 'Ciclu', value: fmt(((th % 720) + 720) % 720) + '°', unit: '/ 720°' },
          { label: 'Viteză piston', value: fmt((2 * 0.0768 * params.rpm) / 60, 1), unit: 'm/s', secondary: true },
          {
            label: 'Acc. la PMS',
            value: fmt((0.0384 * omega(params.rpm) ** 2 * (1 + LAMBDA)) / 9.81),
            unit: 'g',
            secondary: true,
          },
        ]}
      />
    </>
  );
}

const PRESETS = [
  { label: 'Ralanti', value: 750, title: 'Ralanti' },
  { label: '2500', value: 2500, title: 'Mers la oraș' },
  { label: '4250', value: 4250, title: 'Cuplu maxim, 107 N·m' },
  { label: '5500', value: 5500, title: 'Putere maximă, 75 CP' },
];

export function SanderoControls({ params, setParams }: Props) {
  return (
    <ControlGroup
      range={{
        id: 'rpm',
        label: 'Turație',
        valueText: fmt(params.rpm) + ' rpm',
        min: RPM_MIN,
        max: RPM_MAX,
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
