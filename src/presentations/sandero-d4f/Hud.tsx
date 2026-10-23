import type { HudProps } from '../../framework/types';
import { Btn, Range } from '../../framework/ui';
import { FIRING, LAMBDA, PHASES, RPM_MAX, RPM_MIN, SLOWS, fmt, omega, phaseIdx } from './engine';
import type { SanderoInstance, SanderoParams } from './scene';

type Props = HudProps<SanderoParams>;

/** Per-cylinder stroke cells (in firing order) + crank telemetry. */
export function SanderoHud({ instance, params }: Props) {
  const { sim } = instance as SanderoInstance;
  const th = sim.theta;
  return (
    <>
      <div className="banks">
        <div className="bank">
          <div className="cap">Ordine de aprindere 1-3-4-2</div>
          <div className="cells" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {FIRING.map((n) => {
              const c = sim.cyl.find((k) => k.n === n)!;
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
            })}
          </div>
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
            {fmt((2 * 0.0768 * params.rpm) / 60, 1)} <small>m/s</small>
          </dd>
        </div>
        <div className="stat opt">
          <dt>Acc. la PMS</dt>
          <dd>
            {fmt((0.0384 * omega(params.rpm) ** 2 * (1 + LAMBDA)) / 9.81)} <small>g</small>
          </dd>
        </div>
      </dl>
    </>
  );
}

const PRESETS: [string, number, string][] = [
  ['Ralanti', 750, 'Ralanti'],
  ['2500', 2500, 'Mers la oraș'],
  ['4250', 4250, 'Cuplu maxim, 107 N·m'],
  ['5500', 5500, 'Putere maximă, 75 CP'],
];

export function SanderoControls({ params, setParams }: Props) {
  return (
    <div className="ctl">
      <Range
        id="rpm"
        label="Turație"
        valueText={fmt(params.rpm) + ' rpm'}
        min={RPM_MIN}
        max={RPM_MAX}
        step={50}
        value={params.rpm}
        onChange={(rpm) => setParams({ rpm })}
      />
      <div className="row hide-sm">
        {PRESETS.map(([t, rpm, title]) => (
          <Btn key={rpm} title={title} pressed={params.rpm === rpm} onClick={() => setParams({ rpm })}>
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
