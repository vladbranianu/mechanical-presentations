import type { Vector3 } from 'three';
import type { CameraView, PartInfo, Vec3 } from '../../framework/types';
import {
  EGT_LIMIT,
  FAN_D,
  N1_RPM_100,
  N2_RPM_100,
  airflow,
  bypassRatio,
  fmt,
  netThrust,
  smooth,
  vsvClosure,
} from './engine';
import type { TurbofanSim } from './scene';

/** Authored offsets are scaled out so the side panel does not cover the part. */
const pv = (t: Vec3, p: Vec3, k = 1.45): CameraView => ({
  target: t,
  position: [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k, t[2] + (p[2] - t[2]) * k],
});

export const HOME_VIEW: CameraView = { target: [36, -8, 0], position: [-66, 104, 282] };

// keep in sync with scene.ts (content must not import the scene module at runtime)
const EX = { inlet: -30, core: 24, lpt: 50 };
const D = Math.PI / 180;

/** Point at radius r in the cut quadrant (y > 0, z > 0), `deg` from the +z axis. */
const cut = (o: Vector3, x: number, r: number, deg = 45) => o.set(x, r * Math.sin(deg * D), r * Math.cos(deg * D));

export function makeParts(sim: TurbofanSim): PartInfo[] {
  const e = sim.eng;
  const ex = () => smooth(sim.explode);
  const n1rpm = () => (e.n1 / 100) * N1_RPM_100,
    n2rpm = () => (e.n2 / 100) * N2_RPM_100;
  const tip = () => Math.PI * FAN_D * (n1rpm() / 60);
  const live = {
    n1: () => fmt(e.n1, 1) + ' % · ' + fmt(n1rpm()) + ' rpm',
    n2: () => fmt(e.n2, 1) + ' % · ' + fmt(n2rpm()) + ' rpm',
    tip: () => fmt(tip()) + ' m/s · Mach ' + fmt(tip() / 340, 2),
    air: () => fmt(airflow(e.n1)) + ' kg/s',
    bpr: () => fmt(bypassRatio(e.n1), 1) + ' : 1',
    byp: () => {
      const m = airflow(e.n1),
        b = bypassRatio(e.n1);
      return fmt((m * b) / (1 + b)) + ' / ' + fmt(m / (1 + b)) + ' kg/s';
    },
    p25: () => fmt(sim.st.p25, 2) + ' bar · ' + fmt(sim.st.t25) + ' °C',
    p3: () => fmt(sim.st.p3, 1) + ' bar · ' + fmt(sim.st.t3) + ' °C',
    opr: () => fmt(sim.st.p3 / sim.st.p2, 1) + ' : 1',
    vsv: () => fmt(vsvClosure(e.n2), 0) + '° închise',
    ff: () => fmt(e.ff) + ' kg/h',
    t4: () => fmt(sim.st.t4) + ' °C',
    flame: () => fmt(sim.st.tFlame) + ' °C',
    egt: () => fmt(e.egt) + ' °C',
    margin: () => fmt(EGT_LIMIT - e.egt) + ' °C',
    ratio: () => fmt(n2rpm() / Math.max(n1rpm(), 1), 2),
    thrust: () => fmt(netThrust(e), 1) + ' kN',
    rev: () => (e.rev < 0.02 ? 'Închis' : e.rev > 0.98 ? 'Deschis' : 'În mișcare ' + fmt(e.rev * 100) + ' %'),
  };

  return [
    {
      id: 'inlet',
      group: 'Nacelă',
      name: 'Priză de aer și capote',
      lead: 'Încetinește aerul și îl aduce uniform la ventilator, indiferent de unghiul de atac.',
      body: 'Buza din aluminiu e încălzită cu aer cald luat din compresor, ca să nu se formeze gheață. Pereții interiori sunt din panouri perforate tip fagure, care absorb zgomotul ventilatorului. Capotele ventilatorului se deschid în lateral pe balamale prinse de pilon, ca la un capac de mașină.',
      specs: [
        ['Diametru ventilator', '1,55 m'],
        ['Lungime motor', '2,51 m'],
        ['Masă uscată', '≈ 2 370 kg'],
        ['Debit de aer', live.air],
      ],
      view: pv([-35, 10, 10], [-125, 72, 125]),
      anchor: (o) => cut(o, -40 + EX.inlet * ex(), 45.6, 62),
    },
    {
      id: 'fan',
      group: 'Rotor joasă presiune · N1',
      name: 'Ventilator (fan)',
      lead: '24 de palete late din titan, care produc cea mai mare parte a tracțiunii.',
      body: 'La decolare vârfurile paletelor depășesc viteza sunetului. Paleta e răsucită puternic: la bază lucrează aproape axial, la vârf aproape tangențial, pentru că viteza periferică crește cu raza. Spirala albă de pe con le arată mecanicilor de la sol dacă ventilatorul se mai învârte.',
      specs: [
        ['Palete', '24, titan, coardă lată'],
        ['Turație N1', live.n1],
        ['Viteză la vârf', live.tip],
        ['N1 100 %', '5 175 rpm'],
      ],
      view: pv([4, 8, 10], [-72, 62, 112]),
      anchor: (o) => cut(o, 4, 30),
    },
    {
      id: 'booster',
      group: 'Rotor joasă presiune · N1',
      name: 'Compresor de joasă presiune',
      lead: 'Trei trepte (booster) pe același arbore cu ventilatorul, doar pentru aerul care intră în miez.',
      body: 'Separatorul împarte aerul: o parte merge în miez, restul ocolește prin canalul secundar. Booster-ul ridică puțin presiunea miezului înainte de compresorul de înaltă presiune. La turații mici, supape de descărcare (VBV) aruncă o parte din aer în canalul secundar ca să nu intre compresorul în pompaj.',
      specs: [
        ['Trepte', '3'],
        ['Presiune la ieșire (st. 25)', live.p25],
        ['Turație', live.n1],
      ],
      view: pv([26, 8, 8], [-12, 56, 98]),
      anchor: (o) => cut(o, 27, 17.6, 55),
    },
    {
      id: 'bypass',
      group: 'Flux secundar',
      name: 'Canal de bypass',
      lead: 'Cea mai mare parte din aer ocolește miezul și dă cea mai mare parte din tracțiune.',
      body: 'Paletele fixe de după ventilator (OGV) îndreaptă aerul rotit de ventilator, iar brațele carcasei ventilatorului țin rulmenții din față și duc arborele radial spre cutia de accesorii. Ajutajul secundar accelerează apoi aerul spre spate. E mai eficient să accelerezi mult aer cu puțin decât puțin aer cu mult.',
      specs: [
        ['Raport de diluție', live.bpr],
        ['Debit secundar / miez', live.byp],
        ['Tracțiune din bypass', '≈ 80 % la decolare'],
      ],
      view: pv([40, 12, 14], [-2, 72, 126]),
      anchor: (o) => cut(o, 46, 31, 40),
    },
    {
      id: 'hpc',
      group: 'Rotor înaltă presiune · N2',
      name: 'Compresor de înaltă presiune',
      lead: 'Nouă trepte care urcă presiunea aerului de peste 30 de ori față de exterior.',
      body: 'Canalul se îngustează spre spate, pentru că aerul comprimat ocupă tot mai puțin loc. Paletele fixe de la intrare și primele trei rânduri de stator sunt variabile (VSV): un inel de sincronizare le rotește pe toate deodată. La turații mici se închid ca să nu se rupă curgerea de pe palete. Le vezi mișcându-se când schimbi maneta.',
      specs: [
        ['Trepte', '9 (IGV + 3 statoare variabile)'],
        ['Presiune la ieșire (st. 3)', live.p3],
        ['Raport total de compresie', live.opr],
        ['Statoare variabile', live.vsv],
        ['Turație N2', live.n2],
      ],
      view: pv([61, 6, 6], [28, 56, 94]),
      anchor: (o) => cut(o, 60 + EX.core * ex(), 15.4, 52),
    },
    {
      id: 'combustor',
      group: 'Ardere',
      name: 'Cameră de ardere inelară',
      lead: 'Combustibilul arde continuu într-un singur inel, alimentat de 20 de injectoare.',
      body: 'Difuzorul încetinește aerul ca flacăra să nu fie suflată. Doar o parte din aer intră în zona de ardere. Restul răcește pereții prin găuri și fante și diluează gazele până la o temperatură pe care o suportă turbina. Două bujii aprind amestecul la pornire, apoi flacăra se întreține singură.',
      specs: [
        ['Injectoare', '20'],
        ['Bujii', '2'],
        ['Consum combustibil', live.ff],
        ['Flacără (estimat)', live.flame],
        ['Intrare turbină (st. 4)', live.t4],
      ],
      view: pv([87, 6, 6], [58, 52, 88]),
      anchor: (o) => cut(o, 87 + EX.core * ex(), 16.6, 60),
    },
    {
      id: 'hpt',
      group: 'Rotor înaltă presiune · N2',
      name: 'Turbină de înaltă presiune',
      lead: 'O singură treaptă care antrenează tot compresorul de înaltă presiune.',
      body: 'Ajutajele fixe accelerează gazele și le rotesc, iar paletele rotorului le întorc invers și preiau energia. Gazele sunt mai fierbinți decât punctul de topire al metalului, așa că paletele monocristal sunt goale pe dinăuntru și răcite cu aer din compresor, care iese prin găuri mici pe suprafață. Inelele din jurul carcasei suflă aer rece ca să păstreze jocul la vârful paletelor mic.',
      specs: [
        ['Trepte', '1'],
        ['Temperatură la intrare', live.t4],
        ['Turație N2', live.n2],
        ['N2 100 %', '14 460 rpm'],
      ],
      view: pv([96, 6, 6], [72, 50, 84]),
      anchor: (o) => cut(o, 96 + EX.core * ex(), 15.2, 50),
    },
    {
      id: 'lpt',
      group: 'Rotor joasă presiune · N1',
      name: 'Turbină de joasă presiune',
      lead: 'Patru trepte care antrenează ventilatorul și booster-ul prin arborele central.',
      body: 'Gazele se destind și canalul se lărgește spre spate. Temperatura afișată în cabină (EGT) se măsoară între treptele 1 și 2 ale acestei turbine. E cel mai urmărit parametru al motorului: marja față de limită scade pe măsură ce motorul îmbătrânește, iar când se termină, motorul intră în reparație.',
      specs: [
        ['Trepte', '4'],
        ['EGT', live.egt],
        ['Marjă față de limita de 950 °C', live.margin],
        ['Turație', live.n1],
      ],
      view: pv([113, 8, 8], [88, 54, 94]),
      anchor: (o) => cut(o, 113 + EX.lpt * ex(), 19.6, 55),
    },
    {
      id: 'shafts',
      internal: true,
      group: 'Transmisie',
      name: 'Arbori coaxiali și rulmenți',
      lead: 'Arborele de joasă presiune trece prin interiorul celui de înaltă presiune.',
      body: 'Cele două rotoare nu sunt legate mecanic și se învârt la turații diferite, fiecare la viteza la care lucrează cel mai bine. Cinci rulmenți în două carcase unse cu ulei le susțin. Rulmentul 4 e prins între cei doi arbori, așa că funcționează la diferența de turație dintre ei.',
      specs: [
        ['Arbore N1 (auriu)', live.n1],
        ['Arbore N2 (albăstrui)', live.n2],
        ['Raport N2 / N1', live.ratio],
        ['Rulmenți', '5, în 2 carcase'],
      ],
      view: pv([66, 3, 3], [38, 56, 92]),
      anchor: (o) => cut(o, 66 + EX.core * ex(), 5.6, 60),
    },
    {
      id: 'exhaust',
      group: 'Evacuare',
      name: 'Ajutaj și con de evacuare',
      lead: 'Gazele fierbinți din miez ies printr-un ajutaj inelar, în jurul conului central.',
      body: 'Cadrul din spatele turbinei ține rulmentul 5 și punctul de prindere din spate al motorului. Jetul cald al miezului iese înconjurat de jetul rece și mai lent al canalului secundar. Zgomotul unui jet crește foarte repede cu viteza lui, iar aici cea mai mare parte din aer iese relativ încet. De aceea un turbofan e mult mai silențios decât un turboreactor fără bypass.',
      specs: [
        ['Temperatură gaze la ieșire', () => fmt(sim.st.t5) + ' °C'],
        ['Tracțiune netă (sol, ISA)', live.thrust],
        ['Tracțiune maximă', '117 kN (26 300 lbf)'],
      ],
      view: pv([136, 4, 6], [118, 54, 118]),
      anchor: (o) => cut(o, 140 + EX.lpt * ex(), 10.5, 50),
    },
    {
      id: 'reverser',
      group: 'Nacelă',
      name: 'Inversor de tracțiune',
      lead: 'La aterizare, un manșon culisează spre spate și trimite aerul din bypass înainte.',
      body: 'Când manșonul se retrage, se descoperă grilele cu palete curbate (cascade), iar ușile de blocare intră în canal și închid drumul aerului spre ajutaj. Aerul iese prin grile oblic, spre înainte, și frânează avionul. Jetul miezului nu e inversat, deci tracțiunea netă inversă e doar o parte din cea de decolare. Apasă „Revers” ca să-l vezi.',
      specs: [
        ['Tip', 'Cascade, manșon translant'],
        ['Stare', live.rev],
        ['N1 maxim în revers (model)', '82 %'],
      ],
      view: pv([52, -6, 22], [18, 40, 150]),
      anchor: (o) => cut(o, 58 + 14 * smooth(e.rev), 41.5, 30),
    },
    {
      id: 'gearbox',
      group: 'Accesorii',
      name: 'Cutia de accesorii',
      lead: 'Un arbore radial ia putere de la rotorul N2 și antrenează pompele și generatorul.',
      body: 'Un pinion conic de pe arborele de înaltă presiune învârte arborele radial, care coboară printr-un braț al carcasei ventilatorului până la cutia de transfer și apoi la cutia de accesorii, curbată pe carcasa ventilatorului. Pe ea stau generatorul electric (IDG), pompa de combustibil, pompa hidraulică, unitatea de ungere și demarorul pneumatic. La pornire drumul e invers: demarorul rotește N2 prin aceeași cutie. Stă sub capota ventilatorului, deci se vede în modul X-ray.',
      specs: [
        ['Antrenare', 'rotorul N2'],
        ['Turație N2', live.n2],
        ['Generator (IDG)', '90 kVA, 400 Hz'],
      ],
      view: pv([14, -38, -14], [30, -18, -118]),
      anchor: (o) => o.set(12, -42.8, -13.5),
    },
  ];
}
