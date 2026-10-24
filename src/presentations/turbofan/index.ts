import type { PresentationModule } from '../../framework/types';
import { TurbofanControls, TurbofanHud } from './Hud';
import { buildTurbofan, type TurbofanInstance, type TurbofanParams } from './scene';
import { N1_RPM_100, N2_RPM_100 } from './engine';

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
  sound: {
    kind: 'turbofan',
    // 24 wide-chord fan blades; the whine is the first HPC stage.
    voice: { fanBlades: 24, hpcBlades: 38, n1Rpm100: N1_RPM_100, n2Rpm100: N2_RPM_100, gain: 0.7 },
    state: (_p, i: TurbofanInstance) => ({ n1: i.sim.eng.n1, n2: i.sim.eng.n2, reverse: i.sim.reverse }),
  },
};

export default turbofan;
