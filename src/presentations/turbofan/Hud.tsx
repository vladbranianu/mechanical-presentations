import { CellGroup, ControlGroup, Gauge, Gauges, Stats } from '../../framework/hud';
import type { HudProps } from '../../framework/types';
import { EGT_LIMIT, N1_RPM_100, N1_TO, N2_RPM_100, SLOWS, fmt, leverToN1, netThrust, smooth } from './engine';
import { tempCss } from './flow';
import type { TurbofanInstance, TurbofanParams } from './scene';

type Props = HudProps<TurbofanParams>;

const STATIONS = [
  ['2', 'Intrare', 't2', 'p2'],
  ['25', 'Booster', 't25', 'p25'],
  ['3', 'Compresor', 't3', 'p3'],
  ['4', 'Turbină', 't4', 'p4'],
  ['49.5', 'EGT', 'egt', 'p495'],
  ['5', 'Ieșire', 't5', 'p5'],
] as const;

/** 737-style N1 / EGT gauges, gas-path station cells and engine telemetry. */
export function TurbofanHud({ instance }: Props) {
  const { sim } = instance as TurbofanInstance;
  const e = sim.eng,
    st = sim.st;
  const rev = smooth(e.rev);
  return (
    <>
      <Gauges flag={rev > 0.02 ? { text: 'REV', on: rev > 0.98 } : null}>
        <Gauge label="N1" value={e.n1} max={110} limit={104} cmd={e.n1Cmd} text={fmt(e.n1, 1)} />
        <Gauge label="EGT" value={e.egt} max={1100} limit={EGT_LIMIT} text={fmt(e.egt)} warn={e.egt > EGT_LIMIT} />
      </Gauges>
      <CellGroup
        caption="Stații: temperatură · presiune"
        dense
        phoneCols={6}
        cells={STATIONS.map(([n, name, t, p]) => ({
          key: n,
          label: n,
          note: name,
          value: fmt(st[t]) + ' °C',
          sub: fmt(st[p], st[p] < 10 ? 2 : 1) + ' bar',
          color: tempCss(st[t]),
          progress: 1,
        }))}
      />
      <Stats
        items={[
          { label: 'N2', value: fmt(e.n2, 1), unit: '%' },
          { label: 'Tracțiune', value: fmt(netThrust(e), 1), unit: 'kN' },
          { label: 'Combustibil', value: fmt(e.ff), unit: 'kg/h', secondary: true },
          {
            label: 'Raport N2/N1',
            value: fmt((e.n2 * N2_RPM_100) / Math.max(1, e.n1 * N1_RPM_100), 2),
            secondary: true,
          },
        ]}
      />
    </>
  );
}

const PRESETS: [string, number][] = [
  ['Ralanti', 0],
  ['Croazieră', 84],
  ['Decolare', 100],
];

export function TurbofanControls({ params, setParams }: Props) {
  const n1 = leverToN1(params.lever, params.reverse);
  return (
    <ControlGroup
      range={{
        id: 'lever',
        label: params.reverse ? 'Manetă revers' : 'Manetă',
        valueText: 'N1 ' + fmt(n1, 0) + ' %' + (n1 >= N1_TO - 0.5 ? ' · TO' : ''),
        min: 0,
        max: 100,
        step: 1,
        value: params.lever,
        onChange: (lever) => setParams({ lever }),
      }}
      rows={[
        {
          buttons: [
            ...PRESETS.map(([label, lever]) => ({
              label,
              phone: lever !== 84,
              pressed: params.lever === lever && !params.reverse,
              onClick: () => setParams({ lever, reverse: false }),
            })),
            {
              label: 'Revers',
              pressed: params.reverse,
              title: 'Inversor de tracțiune: manșonul culisează, ușile blochează canalul secundar',
              onClick: () =>
                setParams({ reverse: !params.reverse, lever: params.reverse ? params.lever : Math.min(params.lever, 40) }),
            },
          ],
        },
        {
          phone: false,
          buttons: [
            { label: 'Flux de aer', pressed: params.flow, onClick: () => setParams({ flow: !params.flow }) },
            {
              label: 'Încetinire ' + SLOWS[params.slowIdx].t,
              title:
                'Cât de încetinite sunt rotirea și curgerea față de realitate (acul și turațiile rămân în timp real)',
              onClick: () => setParams({ slowIdx: (params.slowIdx + 1) % SLOWS.length }),
            },
          ],
        },
      ]}
    />
  );
}
