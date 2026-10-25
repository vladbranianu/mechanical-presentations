import type { PresentationModule } from '../../framework/types';
import { MercedesControls, MercedesHud } from './Hud';
import { buildMercedes, type MercInstance, type MercParams } from './scene';

const mercedesE: PresentationModule<MercParams> = {
  scene: {
    background: '#121518',
    fov: 34,
    narrowFov: 52,
    near: 0.5,
    far: 900,
    exposure: 0.85,
    minDistance: 6,
    maxDistance: 220,
    // Same lighting model as the engine presentations.
    colorManagement: false,
  },
  initialParams: { drive: 'city', hvac: 'cool', coldStart: 0 },
  thumbnailView: { target: [-1, 4.5, 0], position: [40, 24, 52] },
  build: buildMercedes,
  Hud: MercedesHud,
  Controls: MercedesControls,
  sound: {
    kind: 'piston',
    // Inline four, firing order 1-3-4-2: one even pulse every 180°, one exhaust.
    layout: () => ({ cyl: [[0, 0], [180, 0], [360, 0], [540, 0]], banks: 1 }),
    rpm: (_p, i: MercInstance) => i.sim.rpm,
    voice: { body: [130, 360, 900], q: 2.2, decay: 3.2, rasp: 0.1, drive: 1.5, jitter: 0.05, bright: 0.85, gain: 0.45 },
  },
};

export default mercedesE;
