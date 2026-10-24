/*
 * Full-screen presentation viewer: 3D stage, title block, hotspots, part panel and the bottom
 * bar (presentation telemetry + presentation controls + shared controls).
 */
import { type ComponentType, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneRuntime, type CameraApi, type LiveState, type OverlayRefs, type ViewInset } from './SceneRuntime';
import type { HudProps, PresentationInstance, PresentationMeta, PresentationModule } from './types';
import { Btn, Range, useReducedMotion, useTicker } from './ui';
import { detectQuality, dprRange } from './quality';
import { useEngineSound } from './audio/useEngineSound';

interface Props<P> {
  meta: PresentationMeta;
  module: PresentationModule<P>;
  /** Thumbnail capture: no UI, no motion, sets window.__captureReady when drawn. */
  capture?: boolean;
}

export function Viewer<P>({ meta, module, capture = false }: Props<P>) {
  const reducedMotion = useReducedMotion() || capture;
  const quality = useMemo(() => (capture ? 'high' : detectQuality()), [capture]);
  const [instance, setInstance] = useState<PresentationInstance<P> | null>(null);
  const [params, setParamsState] = useState<P>(module.initialParams);
  const [mode, setMode] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [labels, setLabels] = useState(!capture);
  /** Phone bottom sheet: body + specs shown. Kept while stepping through parts. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const brandRef = useRef<HTMLElement | null>(null);
  const viewInset = useRef<ViewInset>({ top: 0, bottom: 0, right: 0 });

  const live = useRef<LiveState<P>>({
    params,
    explode,
    playing,
    mode,
    selected,
    labels,
    reducedMotion,
  });
  live.current = { params, explode, playing, mode, selected, labels, reducedMotion };

  const overlays = useRef<OverlayRefs>({ hotspots: {}, tags: {} });
  const cameraApi = useRef<CameraApi | null>(null);

  const sound = useEngineSound(capture ? undefined : module.sound, instance, live);

  const setParams = useCallback((patch: Partial<P>) => setParamsState((p) => ({ ...p, ...patch })), []);

  const onReady = useCallback((i: PresentationInstance<P> | null) => {
    setInstance(i);
    if (!i) return;
    setMode((m) => m || i.defaultMode);
  }, []);

  // Mode → scene.
  useEffect(() => {
    if (instance && mode) instance.setMode(mode);
  }, [instance, mode]);

  // Selection → highlight + camera.
  const firstSel = useRef(true);
  useEffect(() => {
    if (!instance) return;
    instance.highlight(selected);
    if (firstSel.current) {
      firstSel.current = false;
      return;
    }
    const part = instance.parts.find((p) => p.id === selected);
    if (part) {
      const cur = instance.modes.find((m) => m.id === mode);
      if (part.internal && cur && !cur.revealsInternals) {
        const reveal = instance.modes.find((m) => m.revealsInternals);
        if (reveal) setMode(reveal.id);
      }
      cameraApi.current?.setView(part.view);
    } else cameraApi.current?.setView(instance.homeView, { home: true });
  }, [instance, selected]);

  // On phones the part panel is a sheet glued to the bottom (portrait) or right edge (landscape).
  // Tell the camera which part of the screen is still free so the selected part is framed there
  // instead of behind the sheet. The floating desktop card is left alone.
  useLayoutEffect(() => {
    const measure = () => {
      const r = panelEl?.getBoundingClientRect();
      const W = innerWidth,
        H = innerHeight;
      const inset = { top: 0, bottom: 0, right: 0 };
      if (r && r.width >= W - 1 && r.bottom >= H - 1) {
        inset.top = brandRef.current?.getBoundingClientRect().bottom ?? 0;
        inset.bottom = H - r.top;
      } else if (r && r.height >= H - 1 && r.right >= W - 1) inset.right = W - r.left;
      viewInset.current = inset;
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (panelEl) ro.observe(panelEl);
    if (brandRef.current) ro.observe(brandRef.current);
    addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      removeEventListener('resize', measure);
    };
  }, [panelEl]);

  const goHome = useCallback(() => setSelected(null), []);
  const onPick = useCallback((id: string) => setSelected(id), []);

  // Keyboard: Esc = overview, Space = play/pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Signal the thumbnail script once a few frames are on screen.
  useEffect(() => {
    if (!capture || !instance) return;
    cameraApi.current?.setView(module.thumbnailView ?? instance.homeView, { instant: true });
    let n = 0,
      raf = 0;
    const tick = () => {
      if (++n > 20) (window as unknown as { __captureReady: boolean }).__captureReady = true;
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [capture, instance, module]);

  const { scene: sc } = module;
  const modeDef = instance?.modes.find((m) => m.id === mode);
  const order = instance?.parts ?? [];
  const selIdx = order.findIndex((p) => p.id === selected);
  const step = (d: number) => setSelected(order[(selIdx + d + order.length) % order.length].id);

  const canvas = useMemo(
    () => (
      <Canvas
        shadows="percentage"
        dpr={dprRange(quality)}
        legacy={sc.colorManagement === false}
        gl={{ antialias: true, preserveDrawingBuffer: capture }}
        camera={{ fov: sc.fov, near: sc.near, far: sc.far, position: [0, 0, 100] }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = sc.exposure ?? 1;
          gl.setClearColor(sc.background, 1);
        }}
        fallback={
          <div className="nogl">
            <p>Browserul tău nu poate porni WebGL, deci modelul 3D nu se poate afișa aici.</p>
          </div>
        }
      >
        <SceneRuntime
          module={module}
          live={live}
          overlays={overlays}
          viewInset={viewInset}
          cameraApi={cameraApi}
          onReady={onReady}
          onPick={onPick}
          quality={quality}
        />
      </Canvas>
    ),
    [module, sc, capture, quality, onReady, onPick],
  );

  const Hud = module.Hud,
    Controls = module.Controls;
  const hudProps = instance ? { instance, params, setParams, reducedMotion } : null;

  return (
    <div
      className={'viewer' + (capture ? ' capture' : '') + (selected ? ' sel' : '')}
      style={{ background: sc.background }}
    >
      <div className="stage">{canvas}</div>
      {!capture && (
        <>
          <header className="brand" ref={brandRef}>
            <Link className="back" to="/">
              ← Toate prezentările
            </Link>
            <div className="eyebrow">{meta.eyebrow}</div>
            <h1>{meta.title}</h1>
            <p>{meta.intro}</p>
            {modeDef?.showsSection && (
              <div className="key">
                <i />
                suprafață secționată
              </div>
            )}
          </header>

          <div className="overlay" aria-hidden="true" hidden={!labels}>
            {instance?.tags?.map((t) => (
              <div key={t.id} className="tag" ref={(el) => void (overlays.current.tags[t.id] = el)}>
                {t.text}
              </div>
            ))}
          </div>
          <div className="overlay" hidden={!labels}>
            {order.map((p) => (
              <button
                key={p.id}
                type="button"
                className={'hs' + (selected ? (selected === p.id ? ' on' : ' dim') : '')}
                aria-label={p.name}
                ref={(el) => void (overlays.current.hotspots[p.id] = el)}
                onClick={() => setSelected(p.id)}
              >
                <span className="dot" />
                <span className="lbl">{p.name}</span>
              </button>
            ))}
          </div>

          {instance && selected && (
            <PartPanel
              ref={setPanelEl}
              instance={instance}
              id={selected}
              open={sheetOpen}
              onToggle={() => setSheetOpen((o) => !o)}
              onStep={step}
              onClose={goHome}
            />
          )}

          <footer className="hud">
            {Hud && hudProps && <TickingHud Hud={Hud} props={hudProps} />}
            <div className="controls">
              {Controls && hudProps && <Controls {...hudProps} />}
              <div className="ctl">
                <Range
                  id="explode"
                  label="Vedere explodată"
                  valueText={Math.round(explode * 100) + '%'}
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(explode * 100)}
                  onChange={(v) => setExplode(v / 100)}
                />
                <div className="row">
                  <Btn pressed={!playing} onClick={() => setPlaying((p) => !p)}>
                    {playing ? 'Pauză' : 'Pornește'}
                  </Btn>
                  {sound.available && (
                    <Btn pressed={sound.on} onClick={sound.toggle} title="Sunet generat din turația și ordinea de aprindere">
                      Sunet
                    </Btn>
                  )}
                </div>
              </div>
              <div className="ctl wide">
                <div className="row" role="group" aria-label="Mod de vizualizare">
                  {instance?.modes.map((m) => (
                    <Btn key={m.id} pressed={m.id === mode} onClick={() => setMode(m.id)}>
                      {m.label}
                    </Btn>
                  ))}
                </div>
                <div className="row hide-sm">
                  <Btn pressed={labels} onClick={() => setLabels((l) => !l)}>
                    Etichete
                  </Btn>
                  <Btn onClick={goHome}>Vedere generală</Btn>
                </div>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

function TickingHud<P>({
  Hud,
  props,
}: {
  Hud: ComponentType<HudProps<P>>;
  props: HudProps<P>;
}) {
  useTicker(10);
  return <Hud {...props} />;
}

/**
 * Part details. Desktop: card on the right. Phones: bottom sheet that starts collapsed (name, lead,
 * navigation) and expands to body + specs, capped so the model stays visible above it.
 */
function PartPanel<P>({
  ref,
  instance,
  id,
  open,
  onToggle,
  onStep,
  onClose,
}: {
  ref: (el: HTMLElement | null) => void;
  instance: PresentationInstance<P>;
  id: string;
  open: boolean;
  onToggle: () => void;
  onStep: (d: number) => void;
  onClose: () => void;
}) {
  useTicker(8);
  const d = instance.parts.find((p) => p.id === id);
  if (!d) return null;
  return (
    <aside ref={ref} className={'panel' + (open ? ' open' : '')} aria-live="polite">
      <button type="button" className="sheet-toggle" aria-expanded={open} onClick={onToggle}>
        <span className="grip" aria-hidden="true" />
        {open ? 'Mai puțin' : 'Detalii și date tehnice'}
      </button>
      <div className="eyebrow">{d.group}</div>
      <h2>{d.name}</h2>
      <p className="lead">{d.lead}</p>
      <p className="body">{d.body}</p>
      <dl className="specs">
        {d.specs.map(([k, v]) => (
          <div key={k} className="spec">
            <dt>{k}</dt>
            <dd className={typeof v === 'function' ? 'live' : undefined}>{typeof v === 'function' ? v() : v}</dd>
          </div>
        ))}
      </dl>
      <div className="pnav">
        <Btn onClick={() => onStep(-1)}>← Anterior</Btn>
        <Btn onClick={() => onStep(1)}>Următor →</Btn>
        <span className="grow" />
        <Btn onClick={onClose}>Vedere generală</Btn>
      </div>
    </aside>
  );
}
