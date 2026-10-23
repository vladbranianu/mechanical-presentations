import type { ComponentType } from 'react';
import type { Intersection, Object3D, Scene, Vector3, WebGLRenderer } from 'three';

export type Vec3 = [number, number, number];

/** A camera framing: orbit target + camera position, in scene units. */
export interface CameraView {
  target: Vec3;
  position: Vec3;
}

/** A spec value is either static text or a function re-evaluated while the panel is open. */
export type SpecValue = string | (() => string);

/** One selectable part: what the hotspot, the side panel and the camera need. */
export interface PartInfo {
  id: string;
  group: string;
  name: string;
  lead: string;
  body: string;
  specs: [label: string, value: SpecValue][];
  view: CameraView;
  /** World position of the hotspot. Called every frame, so it can follow animation / explode. */
  anchor: (out: Vector3) => Vector3;
  /** Hidden inside the housing: selecting it switches a "solid" mode back to the section mode. */
  internal?: boolean;
}

export interface ViewMode {
  id: string;
  label: string;
  /** Shows the section-surface legend under the title while active. */
  showsSection?: boolean;
  /** Internal parts are visible in this mode (selecting one keeps the mode). */
  revealsInternals?: boolean;
}

/** Small screen-space label that follows a 3D point (e.g. cylinder numbers). */
export interface OverlayTag {
  id: string;
  text: string;
  position: (out: Vector3) => Vector3;
  /** Highlighted look (e.g. the cylinder currently firing). */
  active?: () => boolean;
}

export interface FrameInput<P> {
  /** Real seconds since last frame, clamped. */
  dt: number;
  playing: boolean;
  /** 0..1 */
  explode: number;
  params: P;
}

export interface BuildContext {
  gl: WebGLRenderer;
  scene: Scene;
  reducedMotion: boolean;
}

/** What a presentation's build() returns: a live scene plus the hooks the viewer drives. */
export interface PresentationInstance<P> {
  root: Object3D;
  /** Meshes that can be clicked. Each must carry userData.part = PartInfo.id. */
  pickables: Object3D[];
  parts: PartInfo[];
  homeView: CameraView;
  modes: ViewMode[];
  defaultMode: string;
  setMode(id: string): void;
  highlight(partId: string | null): void;
  /** Reject hits that land on geometry currently cut away (section mode). */
  acceptHit?(hit: Intersection, mode: string): boolean;
  tags?: OverlayTag[];
  update(input: FrameInput<P>): void;
  dispose(): void;
}

export interface HudProps<P> {
  instance: PresentationInstance<P>;
  params: P;
  setParams: (patch: Partial<P>) => void;
  reducedMotion: boolean;
}

export interface SceneSettings {
  background: string;
  fov: number;
  /** fov used when the viewport is portrait (aspect < 0.85). */
  narrowFov?: number;
  near: number;
  far: number;
  exposure?: number;
  minDistance: number;
  maxDistance: number;
  /**
   * false = colors/textures treated as raw values (three.js < r152 behaviour).
   * Used by presentations ported from older three.js code so they keep their look.
   */
  colorManagement?: boolean;
}

export interface PresentationModule<P = Record<string, unknown>> {
  scene: SceneSettings;
  initialParams: P;
  /** Camera for the listing thumbnail (defaults to the overview). */
  thumbnailView?: CameraView;
  build(ctx: BuildContext): PresentationInstance<P>;
  /** Telemetry block in the bottom bar (left). Re-rendered ~10×/s. */
  Hud?: ComponentType<HudProps<P>>;
  /** Presentation-specific controls in the bottom bar (before the shared ones). */
  Controls?: ComponentType<HudProps<P>>;
}

/** Catalog entry. Kept free of three.js so the listing page stays light. */
export interface PresentationMeta {
  slug: string;
  title: string;
  eyebrow: string;
  /** One line for the listing card. */
  summary: string;
  /** Short paragraph shown over the 3D stage. */
  intro: string;
  thumbnail: string;
  tags: string[];
  load: () => Promise<{ default: PresentationModule<any> }>;
}
