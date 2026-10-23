import type { PresentationModule } from '../../framework/types';
import { TurbofanControls, TurbofanHud } from './Hud';
import { buildTurbofan, type TurbofanParams } from './scene';

const turbofan: PresentationModule<TurbofanParams> = {
  scene: {
    background: '#121518',
    fov: 34,
    narrowFov: 52,
    near: 1,
    far: 1600,
    exposure: 1.1,
    minDistance: 22,
    maxDistance: 520,
  },
  initialParams: { lever: 84, reverse: false, flow: true, slowIdx: 1 },
  thumbnailView: { target: [42, -6, 0], position: [-52, 82, 214] },
  build: buildTurbofan,
  Hud: TurbofanHud,
  Controls: TurbofanControls,
};

export default turbofan;
