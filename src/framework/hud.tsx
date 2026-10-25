/*
 * Bottom-bar building blocks. Presentations pass data only: layout, styling and the phone
 * behaviour live here and in styles.css, so a design change applies to every presentation.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Btn, Range } from './ui';

/* ---------- telemetry ---------- */

export interface CellData {
  key: string | number;
  label: string;
  /** Small text after the label (hidden on narrow screens). */
  note?: string;
  value: string;
  /** Optional second value line. */
  sub?: string;
  /** Accent color (left border + progress bar). */
  color: string;
  /** 0..1 width of the bottom bar. */
  progress?: number;
  /** Glow (e.g. the cylinder that is firing). */
  hot?: boolean;
}

/** A captioned row of state cells (cylinders, stations...). */
export function CellGroup({
  caption,
  cells,
  phoneCols = 3,
  dense,
}: {
  caption: string;
  cells: CellData[];
  /** Columns of the cell grid on phones. */
  phoneCols?: number;
  /** Narrower cells, for groups with many entries. */
  dense?: boolean;
}) {
  return (
    <div className={'bank' + (dense ? ' dense' : '')}>
      <div className="cap">{caption}</div>
      <div className="cells" style={{ '--phone-cols': phoneCols } as CSSProperties}>
        {cells.map((c) => (
          <div key={c.key} className={'cell' + (c.hot ? ' fire' : '')} style={{ '--c': c.color } as CSSProperties}>
            <b>
              {c.label}
              {c.note && <small> {c.note}</small>}
            </b>
            <span>{c.value}</span>
            {c.sub && <em>{c.sub}</em>}
            {c.progress !== undefined && <i style={{ width: c.progress * 100 + '%' }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Side-by-side cell groups (e.g. the two banks of a boxer). */
export function CellGroups({ children }: { children: ReactNode }) {
  return <div className="banks">{children}</div>;
}

export interface StatData {
  label: string;
  value: string;
  unit?: string;
  /** Dropped first when space runs out. */
  secondary?: boolean;
}

export function Stats({ items }: { items: StatData[] }) {
  return (
    <dl className="stats">
      {items.map((s) => (
        <div key={s.label} className={'stat' + (s.secondary ? ' opt' : '')}>
          <dt>{s.label}</dt>
          <dd>
            {s.value}
            {s.unit && <small> {s.unit}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Round instrument gauge: arc, red limit tick, needle, boxed digital readout. */
export function Gauge({
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
  /** Commanded value (target bug). */
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

/** A row of gauges (hidden on phones), with an optional status flag over it. */
export function Gauges({ children, flag }: { children: ReactNode; flag?: { text: string; on: boolean } | null }) {
  return (
    <div className="gauges">
      {children}
      {flag && <div className={'flag' + (flag.on ? ' on' : '')}>{flag.text}</div>}
    </div>
  );
}

/* ---------- controls ---------- */

export interface ButtonData {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  title?: string;
  /** false = hidden on phones. */
  phone?: boolean;
  /** Small colour square before the label (system legend). */
  swatch?: string;
}

export interface RangeData {
  id: string;
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

/** One control block: caption or slider, then rows of buttons. */
export function ControlGroup({
  caption,
  range,
  rows = [],
  wide,
  phone,
}: {
  caption?: string;
  range?: RangeData;
  rows?: { buttons: ButtonData[]; phone?: boolean; label?: string }[];
  /** Spans the full width on phones. */
  wide?: boolean;
  /** false = the whole block is hidden on phones. */
  phone?: boolean;
}) {
  return (
    <div className={'ctl' + (wide ? ' wide' : '') + (phone === false ? ' hide-sm' : '')}>
      {caption && <span className="cap">{caption}</span>}
      {range && <Range {...range} />}
      {rows.map((r, i) => (
        <div key={i} className={'row' + (r.phone === false ? ' hide-sm' : '')} role="group" aria-label={r.label}>
          {r.buttons.map((b) => (
            <Btn
              key={b.label}
              pressed={b.pressed}
              title={b.title}
              className={b.phone === false ? 'hide-sm' : undefined}
              onClick={b.onClick}
            >
              {b.swatch && <i className="swatch" style={{ background: b.swatch }} />}
              {b.label}
            </Btn>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Speed presets + the slow-motion cycle button, shared by the piston engines. */
export function presetButtons(
  presets: { label: string; value: number; title?: string }[],
  current: number,
  set: (v: number) => void,
): ButtonData[] {
  return presets.map((p) => ({ label: p.label, title: p.title, pressed: current === p.value, onClick: () => set(p.value) }));
}
