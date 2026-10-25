import { ControlGroup, Stats } from '../../framework/hud';
import type { HudProps } from '../../framework/types';
import { DRIVES, T_OPEN, fmt, type DriveMode } from './drive';
import type { MercInstance, MercParams } from './scene';

type Props = HudProps<MercParams>;

/** Driving state: speed, gear, rpm, coolant, thermostat, oil pressure. */
export function MercedesHud({ instance }: Props) {
  const { sim } = instance as MercInstance;
  return (
    <Stats
      items={[
        { label: 'Viteză', value: fmt(sim.kmh), unit: 'km/h' },
        { label: 'Treaptă', value: sim.kmh < 0.5 ? 'D' : 'D' + sim.gear, unit: fmt(sim.rpm) + ' rpm' },
        { label: 'Lichid răcire', value: fmt(sim.temp), unit: sim.temp < T_OPEN - 3 ? '°C · rece' : '°C' },
        { label: 'Termostat', value: sim.thermo <= 0 ? 'închis' : fmt(sim.thermo * 100) + ' %' },
        { label: 'Presiune ulei', value: fmt(sim.oilBar, 1), unit: 'bar', secondary: true },
      ]}
    />
  );
}

export function MercedesControls({ params, setParams }: Props) {
  return (
    <>
      <ControlGroup
        caption="Regim de mers"
        rows={[
          {
            buttons: [
              ...(Object.keys(DRIVES) as DriveMode[]).map((k) => ({
                label: DRIVES[k].label,
                title: DRIVES[k].title,
                pressed: params.drive === k,
                onClick: () => setParams({ drive: k }),
              })),
              {
                label: 'Pornire la rece',
                phone: false,
                title: 'Lichidul pornește de la 20 °C: vezi termostatul închis și cum se deschide (încălzirea e accelerată de 4×)',
                onClick: () => setParams({ coldStart: params.coldStart + 1, drive: 'idle' }),
              },
            ],
          },
        ]}
      />
      <ControlGroup
        phone={false}
        caption="Climatizare"
        rows={[
          {
            buttons: [
              { label: 'Răcire', pressed: params.hvac === 'cool', onClick: () => setParams({ hvac: 'cool' }) },
              { label: 'Încălzire', pressed: params.hvac === 'heat', onClick: () => setParams({ hvac: 'heat' }) },
            ],
          },
        ]}
      />
    </>
  );
}
