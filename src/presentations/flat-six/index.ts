import type { PresentationModule } from '../../framework/types';
import { FlatSixControls, FlatSixHud } from './Hud';
import { buildFlatSix, type FlatSixParams } from './scene';
import { CYL } from './engine';

const flatSix: PresentationModule<FlatSixParams> = {
  scene: {
    background: '#121518',
    fov: 36,
    narrowFov: 50,
    near: 0.5,
    far: 700,
    exposure: 0.82,
    minDistance: 14,
    maxDistance: 190,
    // Ported from three.js r128: keep the original (non-color-managed) look.
    colorManagement: false,
  },
  initialParams: { rpm: 2400, slowIdx: 1 },
  thumbnailView: { target: [2, -4, 3], position: [-50, 38, 84] },
  build: buildFlatSix,
  Hud: FlatSixHud,
  Controls: FlatSixControls,
  sound: {
    kind: 'piston',
    // Boxer: each bank fires every 240°, the banks alternate (order 1-6-2-4-3-5).
    layout: () => ({ cyl: CYL.map((c) => [c.T, c.s > 0 ? 0 : 1] as [number, number]), banks: 2 }),
    rpm: (p) => p.rpm,
    voice: { body: [125, 390, 950], q: 2.6, decay: 3.5, rasp: 0.3, drive: 2, jitter: 0.08, bright: 1.1, gain: 0.55 },
  },
};

export default flatSix;
