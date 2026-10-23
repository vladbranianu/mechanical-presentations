import type { HudProps } from '../../framework/types';
import { Btn, Range } from '../../framework/ui';
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
  const gaps = bankIntervals(params.crank, 1);
  const even = gaps.every((g) => g === gaps[0]);
  return (
    <>
      <div className="banks">
        <div className="bank">
          <div className="cap">Banca A (secționată)</div>
          <div className="cells" data-n="4">
            {bank(1)}
          </div>
        </div>
        <div className="bank">
          <div className="cap">Banca B</div>
          <div className="cells" data-n="4">
            {bank(-1)}
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
        <div className="stat">
          <dt>Aprinderi banca A</dt>
          <dd>
            {gaps.join('·')}° <small>{even ? 'egale' : 'inegale'}</small>
          </dd>
        </div>
        <div className="stat opt">
          <dt>Viteză piston</dt>
          <dd>
            {fmt((2 * 0.083 * params.rpm) / 60, 1)} <small>m/s</small>
          </dd>
        </div>
      </dl>
    </>
  );
}

const PRESETS: [string, number][] = [
  ['Ralanti', 900],
  ['3000', 3000],
  ['6000', 6000],
  ['8000', 8000],
];

export function FerrariV8Controls({ params, setParams }: Props) {
  return (
    <>
      <div className="ctl wide">
        <span className="cap">Arbore cotit</span>
        <div className="row">
          {(Object.keys(CRANKS) as CrankType[]).map((k) => (
            <Btn
              key={k}
              pressed={params.crank === k}
              title={`${CRANKS[k].label} (${CRANKS[k].note})`}
              onClick={() => setParams({ crank: k })}
            >
              {CRANKS[k].short}
            </Btn>
          ))}
        </div>
      </div>
      <div className="ctl">
        <Range
          id="rpm"
          label="Turație"
          valueText={fmt(params.rpm) + ' rpm'}
          min={900}
          max={8000}
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
            title="Cât de încetinită e animația față de turația reală"
            onClick={() => setParams({ slowIdx: (params.slowIdx + 1) % SLOWS.length })}
          >
            Încetinire {SLOWS[params.slowIdx].t}
          </Btn>
        </div>
      </div>
    </>
  );
}
