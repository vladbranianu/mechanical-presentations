import type { HudProps } from '../../framework/types';
import { Btn, Range } from '../../framework/ui';
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
        return (
          <div
            key={c.n}
            className={'cell' + (sim.fire === c && c.p < 60 ? ' fire' : '')}
            style={{ '--c': ph.col } as React.CSSProperties}
          >
            <b>Cil. {c.n}</b>
            <span>{ph.name}</span>
            <i style={{ width: ((c.p % 180) / 180) * 100 + '%' }} />
          </div>
        );
      });
  return (
    <>
      <div className="banks">
        <div className="bank">
          <div className="cap">Banca A (secționată)</div>
          <div className="cells">{bank(1)}</div>
        </div>
        <div className="bank">
          <div className="cap">Banca B</div>
          <div className="cells">{bank(-1)}</div>
        </div>
      </div>
      <dl className="stats">
        <div className="stat">
          <dt>Arbore cotit</dt>
          <dd>{fmt(((th % 360) + 360) % 360)}°</dd>
        </div>
        <div className="stat">
          <dt>Ciclu</dt>
          <dd>
            {fmt(((th % 720) + 720) % 720)}° <small>/ 720°</small>
          </dd>
        </div>
        <div className="stat opt">
          <dt>Viteză piston</dt>
          <dd>
            {fmt((2 * 0.0764 * params.rpm) / 60, 1)} <small>m/s</small>
          </dd>
        </div>
        <div className="stat opt">
          <dt>Acc. la PMS</dt>
          <dd>
            {fmt((0.0382 * omega(params.rpm) ** 2 * (1 + LAMBDA)) / 9.81)} <small>g</small>
          </dd>
        </div>
      </dl>
    </>
  );
}

const PRESETS: [string, number][] = [
  ['Ralanti', 850],
  ['3000', 3000],
  ['6000', 6000],
  ['7800', 7800],
];

export function FlatSixControls({ params, setParams }: Props) {
  return (
    <div className="ctl">
      <Range
        id="rpm"
        label="Turație"
        valueText={fmt(params.rpm) + ' rpm'}
        min={800}
        max={7800}
        step={50}
        value={params.rpm}
        onChange={(rpm) => setParams({ rpm })}
      />
      <div className="row hide-sm">
        {PRESETS.map(([t, rpm]) => (
          <Btn key={rpm} pressed={params.rpm === rpm} onClick={() => setParams({ rpm })}>
            {t}
          </Btn>
        ))}
        <Btn
          className="hide-sm"
          title="Cât de încetinită e animația față de turația reală"
          onClick={() => setParams({ slowIdx: (params.slowIdx + 1) % SLOWS.length })}
        >
          Încetinire {SLOWS[params.slowIdx].t}
        </Btn>
      </div>
    </div>
  );
}
