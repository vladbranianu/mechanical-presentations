/*
 * Lives inside the R3F <Canvas>: builds the presentation, drives its frame update, the orbit
 * camera (with tweened fly-to), click picking and the screen-space overlays.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraView, PresentationInstance, PresentationModule, Quality } from './types';

/** Viewer state the frame loop reads without causing React renders. */
export interface LiveState<P> {
  params: P;
  explode: number;
  playing: boolean;
  mode: string;
  selected: string | null;
  labels: boolean;
  reducedMotion: boolean;
}

export interface CameraApi {
  setView(view: CameraView, opts?: { instant?: boolean; home?: boolean }): void;
}

/** Screen pixels covered by UI (phone sheets); the view is centred in what is left. */
export interface ViewInset {
  top: number;
  bottom: number;
  right: number;
}

/** DOM elements positioned every frame (hotspot per part id, tag per tag id). */
export interface OverlayRefs {
  hotspots: Record<string, HTMLElement | null>;
  tags: Record<string, HTMLElement | null>;
}

interface Props<P> {
  module: PresentationModule<P>;
  live: MutableRefObject<LiveState<P>>;
  overlays: MutableRefObject<OverlayRefs>;
  viewInset: MutableRefObject<ViewInset>;
  cameraApi: MutableRefObject<CameraApi | null>;
  onReady: (inst: PresentationInstance<P> | null) => void;
  onPick: (partId: string) => void;
  quality: Quality;
}

const NARROW_ASPECT = 0.85;
const TWEEN_MS = 1600;
const IDLE_ROTATE_S = 8;
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

interface Tween {
  s0: THREE.Spherical;
  s1: THREE.Spherical;
  dth: number;
  t0: THREE.Vector3;
  t1: THREE.Vector3;
  start: number;
}

export function SceneRuntime<P>({ module, live, overlays, viewInset, cameraApi, onReady, onPick, quality }: Props<P>) {
  const { gl, scene, camera, size } = useThree();
  const setDpr = useThree((s) => s.setDpr);
  const perf = useRef({ t: 0, n: 0 });
  const cam = camera as THREE.PerspectiveCamera;
  const inst = useRef<PresentationInstance<P> | null>(null);
  const controls = useRef<OrbitControls | null>(null);
  const tween = useRef<Tween | null>(null);
  const idle = useRef(0);
  const shift = useRef({ x: 0, y: 0, ax: 0, ay: 0, w: 0, h: 0 });
  const narrow = size.width / size.height < NARROW_ASPECT;

  // Orbit controls.
  useEffect(() => {
    const c = new OrbitControls(cam, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = module.scene.minDistance;
    c.maxDistance = module.scene.maxDistance;
    c.autoRotateSpeed = 0.35;
    controls.current = c;
    return () => {
      c.dispose();
      controls.current = null;
    };
  }, [cam, gl, module]);

  // Portrait screens get a wider lens.
  useEffect(() => {
    cam.fov = narrow ? (module.scene.narrowFov ?? module.scene.fov) : module.scene.fov;
    cam.updateProjectionMatrix();
  }, [cam, narrow, module]);

  // Camera fly-to.
  useEffect(() => {
    const narrowNow = () => cam.aspect < NARROW_ASPECT;
    cameraApi.current = {
      setView(v, opts = {}) {
        const c = controls.current;
        if (!c) return;
        const t = new THREE.Vector3(...v.target);
        const p = new THREE.Vector3(...v.position)
          .sub(t)
          .multiplyScalar(narrowNow() ? 1.45 : 1)
          .add(t);
        // On portrait screens the bottom sheet / HUD cover the lower part: lift the overview.
        if (opts.home && narrowNow()) {
          t.y -= 9;
          p.y -= 9;
        }
        if (opts.instant || live.current.reducedMotion) {
          c.target.copy(t);
          cam.position.copy(p);
          c.update();
          tween.current = null;
          return;
        }
        const s0 = new THREE.Spherical().setFromVector3(cam.position.clone().sub(c.target));
        const s1 = new THREE.Spherical().setFromVector3(p.clone().sub(t));
        let dth = s1.theta - s0.theta;
        while (dth > Math.PI) dth -= 2 * Math.PI;
        while (dth < -Math.PI) dth += 2 * Math.PI;
        tween.current = { s0, s1, dth, t0: c.target.clone(), t1: t, start: performance.now() };
      },
    };
    // ?debug exposes the camera for scripted screenshots
    if (new URLSearchParams(location.search).has('debug'))
      Object.assign(window, {
        __mpSetView: (v: CameraView) => cameraApi.current?.setView(v, { instant: true }),
        __mpInfo: () => ({ ...gl.info.render, dpr: gl.getPixelRatio() }),
        __mpScene: scene,
      });
    return () => {
      cameraApi.current = null;
    };
  }, [cam, cameraApi, live, gl, scene]);

  // Click picking (ignores drags).
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      tween.current = null;
      idle.current = 0;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      const i = inst.current;
      if (!d || !i || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const mode = live.current.mode;
      const hit = ray
        .intersectObjects(i.pickables, false)
        .find((h) => h.object.userData.part && (!i.acceptHit || i.acceptHit(h, mode)));
      if (hit) onPick(hit.object.userData.part);
    };
    const onWheel = () => {
      tween.current = null;
      idle.current = 0;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, cam, live, onPick]);

  // Build / dispose the presentation (after controls + camera API exist).
  useEffect(() => {
    const i = module.build({ gl, scene, reducedMotion: live.current.reducedMotion, quality });
    scene.add(i.root);
    i.setMode(live.current.mode || i.defaultMode);
    inst.current = i;
    onReady(i);
    cameraApi.current?.setView(i.homeView, { instant: true, home: true });
    return () => {
      scene.remove(i.root);
      i.dispose();
      inst.current = null;
      onReady(null);
    };
  }, [module, gl, scene, quality]);

  const proj = useRef(new THREE.Vector3());
  const anchor = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    const i = inst.current,
      c = controls.current;
    if (!i || !c) return;
    const L = live.current;
    const dt = Math.min(0.05, delta);

    // Adaptive resolution: if the last 2 s averaged under 30 fps, drop the pixel ratio a step.
    // (A long gap means the tab was hidden or the page stalled: start the window over.)
    const pf = perf.current;
    if (delta > 0.25) pf.t = pf.n = 0;
    else {
      pf.t += delta;
      pf.n++;
    }
    if (pf.t > 2) {
      const dpr = gl.getPixelRatio();
      if (pf.n / pf.t < 30 && dpr > 1) setDpr(Math.max(1, dpr - 0.5));
      pf.t = pf.n = 0;
    }
    i.update({ dt, playing: L.playing, explode: L.explode, params: L.params });

    // Shift the projection (not the orbit) so the orbit target sits in the middle of the area
    // left free by a phone sheet. Picking and overlays use the same matrix, so they follow.
    {
      const s = shift.current,
        vi = viewInset.current,
        { width: w, height: h } = state.size;
      const k = L.reducedMotion ? 1 : Math.min(1, dt * 6);
      const ease = (cur: number, want: number) => (Math.abs(want - cur) < 0.5 ? want : cur + (want - cur) * k);
      s.x = ease(s.x, vi.right / 2);
      s.y = ease(s.y, (vi.bottom - vi.top) / 2);
      if (s.x !== s.ax || s.y !== s.ay || s.w !== w || s.h !== h) {
        if (Math.abs(s.x) < 0.5 && Math.abs(s.y) < 0.5) cam.clearViewOffset();
        else cam.setViewOffset(w, h, s.x, s.y, w, h);
        Object.assign(s, { ax: s.x, ay: s.y, w, h });
      }
    }

    const tw = tween.current;
    if (tw) {
      const k = Math.min(1, (performance.now() - tw.start) / TWEEN_MS),
        e = ease(k);
      // a small outward arc so the camera doesn't clip through the model
      const r = tw.s0.radius + (tw.s1.radius - tw.s0.radius) * e + Math.sin(Math.PI * e) * 8;
      const sp = new THREE.Spherical(r, tw.s0.phi + (tw.s1.phi - tw.s0.phi) * e, tw.s0.theta + tw.dth * e);
      c.target.lerpVectors(tw.t0, tw.t1, e);
      cam.position.setFromSpherical(sp).add(c.target);
      cam.lookAt(c.target);
      if (k >= 1) {
        tween.current = null;
        c.update();
      }
    } else {
      idle.current += dt;
      c.autoRotate = !L.reducedMotion && !L.selected && idle.current > IDLE_ROTATE_S;
      c.update();
    }

    // overlays
    if (!L.labels) return;
    const w = state.size.width,
      h = state.size.height;
    const project = (v: THREE.Vector3) => {
      const t = proj.current.copy(v).project(cam);
      return {
        x: ((t.x + 1) / 2) * w,
        y: ((1 - t.y) / 2) * h,
        ok: t.z < 1 && Math.abs(t.x) < 1.1 && Math.abs(t.y) < 1.1,
      };
    };
    for (const part of i.parts) {
      const el = overlays.current.hotspots[part.id];
      if (!el) continue;
      const q = project(part.anchor(anchor.current));
      el.classList.toggle('off', !q.ok);
      el.style.transform = `translate(${q.x - 15}px,${q.y - 15}px)`;
    }
    for (const tag of i.tags ?? []) {
      const el = overlays.current.tags[tag.id];
      if (!el) continue;
      const q = project(tag.position(anchor.current));
      el.style.transform = `translate(${q.x - 7}px,${q.y - 8}px)`;
      el.hidden = !q.ok || !!L.selected;
      el.classList.toggle('active', !!tag.active?.());
    }
  });

  return null;
}
