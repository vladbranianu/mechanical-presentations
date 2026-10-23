/* Small UI building blocks shared by the viewer and presentation HUDs. */
import { useEffect, useReducer, useState, type ReactNode } from 'react';

export function Btn({
  pressed,
  onClick,
  children,
  title,
  className,
}: {
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={'btn' + (className ? ' ' + className : '')}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Range({
  id,
  label,
  valueText,
  min,
  max,
  step,
  value,
  onChange,
}: {
  id: string;
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <label className="cap" htmlFor={id}>
        {label} <span className="val">{valueText}</span>
      </label>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </>
  );
}

/** Re-renders the calling component `hz` times per second while enabled. */
export function useTicker(hz: number, enabled = true) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(tick, 1000 / hz);
    return () => clearInterval(id);
  }, [hz, enabled]);
}

export function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}
