import type { HudProps } from '../../framework/types';
import { Btn, Range } from '../../framework/ui';
import { EGT_LIMIT, N1_RPM_100, N1_TO, N2_RPM_100, SLOWS, fmt, leverToN1, netThrust, smooth } from './engine';
import { tempCss } from './flow';
import type { TurbofanInstance, TurbofanParams } from './scene';
import './turbofan.css';

type Props = HudProps<TurbofanParams>;

/** 737-style round dial: white arc, red limit tick, needle, boxed digital readout. */
function Dial({
  label,
  value,
  max,
  limit,
  text,
  cmd,
  warn,
}: {
  label: string;
  value: number;
  max: number;
  limit: number;
  text: string;
  /** commanded value (N1 target bug) */
  cmd?: number;
  warn?: boolean;
}) {
  const A0 = 180,
    SWEEP = 210,
    r = 25,
    cx = 30,
    cy = 31;
  const ang = (v: number) => ((A0 + (Math.max(0, Math.min(v, max)) / max) * SWEEP) * Math.PI) / 180;
  const pt = (v: number, rr: number) => [cx + rr * Math.cos(ang(v)), cy + rr * Math.sin(ang(v))] as const;
  const arc = (v0: number, v1: number) => {
    const [x0, y0] = pt(v0, r),
      [x1, y1] = pt(v1, r);
    const large = ((v1 - v0) / max) * SWEEP > 180 ? 1 : 0;
    return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  const [nx, ny] = pt(value, r - 3);
  const [l0x, l0y] = pt(limit, r - 4),
    [l1x, l1y] = pt(limit, r + 4);
  const bug = cmd !== undefined ? pt(cmd, r + 2.5) : null;
  return (
    <div className={'dial' + (warn ? ' warn' : '')}>
      <svg viewBox="0 0 60 50" aria-hidden="true">
        <path d={arc(0, value)} className="fillarc" />
        <path d={arc(0, max)} className="arc" />
        <line x1={l0x} y1={l0y} x2={l1x} y2={l1y} className="limit" />
        {bug && <circle cx={bug[0]} cy={bug[1]} r={1.6} className="bug" />}
        <line x1={cx} y1={cy} x2={nx} y2={ny} className="needle" />
      </svg>
      <div className="read">{text}</div>
      <div className="cap">{label}</div>
    </div>
  );
}

const STATIONS = [
  ['2', 'Intrare', 't2', 'p2'],
  ['25', 'Booster', 't25', 'p25'],
  ['3', 'Compresor', 't3', 'p3'],
  ['4', 'Turbină', 't4', 'p4'],
  ['49.5', 'EGT', 'egt', 'p495'],
  ['5', 'Ieșire', 't5', 'p5'],
] as const;

export function TurbofanHud({ instance }: Props) {
  const { sim } = instance as TurbofanInstance;
  const e = sim.eng,
    st = sim.st;
  const rev = smooth(e.rev);
  return (
    <>
      <div className="tf-dials">
        <Dial
          label="N1"
          value={e.n1}
          max={110}
          limit={104}
          cmd={e.n1Cmd}
          text={fmt(e.n1, 1)}
        />
        <Dial label="EGT" value={e.egt} max={1100} limit={EGT_LIMIT} text={fmt(e.egt)} warn={e.egt > EGT_LIMIT} />
        {rev > 0.02 && <div className={'rev' + (rev > 0.98 ? ' on' : '')}>REV</div>}
      </div>
      <div className="bank tf-st">
        <div className="cap">Stații: temperatură · presiune</div>
        <div className="cells">
          {STATIONS.map(([n, name, t, p]) => (
            <div key={n} className="cell" style={{ '--c': tempCss(st[t]) } as React.CSSProperties}>
              <b>
                {n} <small>{name}</small>
              </b>
              <span>{fmt(st[t])} °C</span>
              <em>{fmt(st[p], st[p] < 10 ? 2 : 1)} bar</em>
            </div>
          ))}
        </div>
      </div>
      <dl className="stats">
        <div className="stat">
          <dt>N2</dt>
          <dd>
            {fmt(e.n2, 1)} <small>%</small>
          </dd>
        </div>
        <div className="stat">
          <dt>Tracțiune</dt>
          <dd>
            {fmt(netThrust(e), 1)} <small>kN</small>
          </dd>
        </div>
        <div className="stat opt">
          <dt>Combustibil</dt>
          <dd>
            {fmt(e.ff)} <small>kg/h</small>
          </dd>
        </div>
        <div className="stat opt">
          <dt>Raport N2/N1</dt>
          <dd>{fmt((e.n2 * N2_RPM_100) / Math.max(1, e.n1 * N1_RPM_100), 2)}</dd>
        </div>
      </dl>
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
    <div className="ctl">
      <Range
        id="lever"
        label={params.reverse ? 'Manetă revers' : 'Manetă'}
        valueText={'N1 ' + fmt(n1, 0) + ' %' + (n1 >= N1_TO - 0.5 ? ' · TO' : '')}
        min={0}
        max={100}
        step={1}
        value={params.lever}
        onChange={(lever) => setParams({ lever })}
      />
      <div className="row">
        {PRESETS.map(([t, lever]) => (
          <Btn key={t} className={lever === 84 ? 'hide-sm' : undefined} pressed={params.lever === lever && !params.reverse} onClick={() => setParams({ lever, reverse: false })}>
            {t}
          </Btn>
        ))}
        <Btn
          pressed={params.reverse}
          title="Inversor de tracțiune: manșonul culisează, ușile blochează canalul secundar"
          onClick={() => setParams({ reverse: !params.reverse, lever: params.reverse ? params.lever : Math.min(params.lever, 40) })}
        >
          Revers
        </Btn>
      </div>
      <div className="row hide-sm">
        <Btn pressed={params.flow} onClick={() => setParams({ flow: !params.flow })}>
          Flux de aer
        </Btn>
        <Btn
          title="Cât de încetinite sunt rotirea și curgerea față de realitate (acul și turațiile rămân în timp real)"
          onClick={() => setParams({ slowIdx: (params.slowIdx + 1) % SLOWS.length })}
        >
          Încetinire {SLOWS[params.slowIdx].t}
        </Btn>
      </div>
    </div>
  );
}
