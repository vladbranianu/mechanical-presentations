import type { PresentationModule } from '../../framework/types';
import { FerrariV8Controls, FerrariV8Hud } from './Hud';
import { buildFerrariV8, type FerrariV8Params } from './scene';

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
};

export default ferrariV8;
