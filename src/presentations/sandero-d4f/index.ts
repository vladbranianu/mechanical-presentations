import type { PresentationModule } from '../../framework/types';
import { SanderoControls, SanderoHud } from './Hud';
import { buildSandero, type SanderoParams } from './scene';
import { CYL } from './engine';

const sandero: PresentationModule<SanderoParams> = {
  scene: {
    background: '#121518',
    fov: 36,
    narrowFov: 56,
    near: 0.5,
    far: 500,
    exposure: 0.82,
    minDistance: 10,
    maxDistance: 150,
    // Same look and light rig as the flat-six.
    colorManagement: false,
  },
  initialParams: { rpm: 2500, slowIdx: 1 },
  thumbnailView: { target: [1, 10, 1], position: [-50, 40, 76] },
  build: buildSandero,
  Hud: SanderoHud,
  Controls: SanderoControls,
  sound: {
    kind: 'piston',
    // Inline four, one exhaust: a firing every 180° (order 1-3-4-2).
    layout: () => ({ cyl: CYL.map((c) => [c.T, 0] as [number, number]), banks: 1 }),
    rpm: (p) => p.rpm,
    voice: { body: [95, 260], q: 2.2, decay: 5, rasp: 0.35, drive: 1.4, jitter: 0.12, bright: 0.7, gain: 0.6 },
  },
};

export default sandero;
