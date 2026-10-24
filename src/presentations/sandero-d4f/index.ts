import type { PresentationModule } from '../../framework/types';
import { SanderoControls, SanderoHud } from './Hud';
import { buildSandero, type SanderoParams } from './scene';

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
};

export default sandero;
