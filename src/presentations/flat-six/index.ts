import type { PresentationModule } from '../../framework/types';
import { FlatSixControls, FlatSixHud } from './Hud';
import { buildFlatSix, type FlatSixParams } from './scene';

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
};

export default flatSix;
