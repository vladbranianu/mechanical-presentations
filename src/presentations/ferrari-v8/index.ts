import type { PresentationModule } from '../../framework/types';
import { FerrariV8Controls, FerrariV8Hud } from './Hud';
import { buildFerrariV8, type FerrariV8Params } from './scene';
import { CYL, firingOffsets } from './engine';

const ferrariV8: PresentationModule<FerrariV8Params> = {
  scene: {
    background: '#121518',
    fov: 36,
    narrowFov: 50,
    near: 0.5,
    far: 800,
    exposure: 0.82,
    minDistance: 14,
    maxDistance: 210,
    // Same lighting model as the Flat-Six so the two presentations look alike.
    colorManagement: false,
  },
  initialParams: { rpm: 3000, slowIdx: 1, crank: 'flat' },
  thumbnailView: { target: [8, 4, 4], position: [-52, 42, 92] },
  build: buildFerrariV8,
  Hud: FerrariV8Hud,
  Controls: FerrariV8Controls,
  sound: {
    kind: 'piston',
    // Each bank has its own exhaust: flat-plane = even 180° per bank (scream), cross-plane =
    // 90/270/180/180 per bank (the classic V8 burble).
    layout: (p) => {
      const T = firingOffsets(p.crank);
      return { cyl: CYL.map((c) => [T[c.n - 1], c.s > 0 ? 0 : 1] as [number, number]), banks: 2 };
    },
    rpm: (p) => p.rpm,
    voice: { body: [170, 460, 1150], q: 2.8, decay: 2.6, rasp: 0.22, drive: 2.4, jitter: 0.07, bright: 1.4, gain: 0.5 },
  },
};

export default ferrariV8;
