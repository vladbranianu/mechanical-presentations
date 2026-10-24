import type { CameraView, PartInfo, Vec3 } from '../../framework/types';
import { AB, AB_X, BLOCK_X, CAM_Y, CYL, DECK, HEAD_TOP, LAMBDA, PHASES, ROCKER_SHAFT, TB, TB_X, fmt, omega, phaseIdx } from './engine';
import type { SanderoSim } from './scene';

/** Part close-ups sit 1.4× further out than the authored offset. */
const pv = (t: Vec3, p: Vec3, k = 1.4): CameraView => ({
  target: t,
  position: [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k, t[2] + (p[2] - t[2]) * k],
});

export const HOME_VIEW: CameraView = { target: [3, 9, 2], position: [-60, 44, 92] };

// Explode offsets, mirrored from scene.ts so the hotspots follow their parts.
const HEAD_EX = 9;

export function makeParts(sim: SanderoSim): PartInfo[] {
  const live = {
    rpm: () => fmt(sim.rpm) + ' rpm',
    vp: () => fmt((2 * 0.0768 * sim.rpm) / 60, 1) + ' m/s',
    acc: () => fmt((0.0384 * omega(sim.rpm) ** 2 * (1 + LAMBDA)) / 9.81) + ' g',
    accBdc: () => fmt((0.0384 * omega(sim.rpm) ** 2 * (1 - LAMBDA)) / 9.81) + ' g',
    cam: () => fmt(sim.rpm / 2) + ' rpm',
    sparks: () => fmt((sim.rpm / 60) * 2) + ' /s',
    air: () => fmt((1.149 * sim.rpm) / 120, 1) + ' L/s',
    rodAng: () => fmt(sim.cyl[2].rodAng, 1) + '°',
    lift1: () => fmt(sim.cyl[0].liftI * 7.8, 1) + ' / ' + fmt(sim.cyl[0].liftE * 7.8, 1) + ' mm',
    phase1: () => PHASES[phaseIdx(sim.cyl[0].p)].name,
    wp: () => fmt((sim.rpm * TB.crank.r) / TB.wp.r) + ' rpm',
    alt: () => fmt((sim.rpm * AB.crank.r) / AB.alt.r) + ' rpm',
    ps: () => fmt((sim.rpm * AB.crank.r) / AB.ps.r) + ' rpm',
    beltV: () => fmt(omega(sim.rpm) * 0.029, 1) + ' m/s',
  };
  const ex = () => sim.explode;

  return [
    {
      id: 'crank',
      internal: true,
      group: 'Mecanism bielă-manivelă',
      name: 'Arbore cotit',
      lead: 'Transformă mișcarea dus-întors a celor patru pistoane în rotație.',
      body: 'Fusurile de bielă 1 și 4 sunt în aceeași poziție, iar 2 și 3 sunt decalate cu 180°. Când două pistoane urcă, celelalte două coboară, așa că forțele principale se anulează. Rămân forțele de ordinul doi, la dublul turației, care nu se anulează. De aici vine vibrația specifică unui 4 cilindri mic fără arbori de echilibrare.',
      specs: [
        ['Paliere', '5'],
        ['Rază manivelă', '38,4 mm'],
        ['Ordine de aprindere', '1-3-4-2'],
        ['Turație', live.rpm],
      ],
      view: pv([2, 3, 2], [-24, 26, 52]),
      anchor: (o) => o.set(CYL[1].x + 3.8, -1.6, 3),
    },
    {
      id: 'piston',
      internal: true,
      group: 'Mecanism bielă-manivelă · cilindrul 2',
      name: 'Piston',
      lead: 'Preia presiunea gazelor arse și o împinge în bielă.',
      body: 'Cursa e mai lungă decât alezajul (motor „subpătrat”), ceea ce ajută cuplul la turații mici și medii. Pistonul se oprește de două ori pe rotație. La punctul mort superior (PMS) accelerația e mai mare decât la cel inferior, pentru că biela are lungime finită. Adânciturile din capul pistonului lasă loc supapelor.',
      specs: [
        ['Alezaj × cursă', '69 × 76,8 mm'],
        ['Cilindree', '1149 cm³'],
        ['Raport de compresie', '9,8 : 1'],
        ['Viteză medie', live.vp],
        ['Accelerație la PMS', live.acc],
        ['Accelerație la PMI', live.accBdc],
      ],
      view: pv([CYL[1].x, 14, 0], [CYL[1].x + 10, 34, 40]),
      anchor: (o) => o.set(CYL[1].x, sim.cyl[1].crown - 1, 3.2),
    },
    {
      id: 'rod',
      internal: true,
      group: 'Mecanism bielă-manivelă · cilindrul 3',
      name: 'Bielă',
      lead: 'Leagă bolțul pistonului de fusul arborelui cotit.',
      body: 'Biela oscilează în timp ce pistonul urcă și coboară. Unghiul ei împinge pistonul lateral în peretele cilindrului. Raportul λ dintre raza manivelei și lungimea bielei arată cât de departe e mișcarea pistonului de o sinusoidă pură.',
      specs: [
        ['Lungime între centre', '≈128 mm (în model)'],
        ['λ = r / L', '0,30'],
        ['Unghi maxim', '17,5°'],
        ['Unghi acum', live.rodAng],
      ],
      view: pv([CYL[2].x, 6, 0], [CYL[2].x - 14, 22, 40]),
      anchor: (o) => o.copy(sim.cyl[2].rod.position).setZ(2.2),
    },
    {
      id: 'valve',
      internal: true,
      group: 'Distribuție · cilindrul 1',
      name: 'Supape',
      lead: 'Patru pe cilindru: două de admisie în spate, două de evacuare în față.',
      body: 'Două supape mici deschid mai multă secțiune decât una mare, așa că motorul respiră mai bine la turație. Admisia se deschide puțin înainte ca evacuarea să se închidă: în suprapunerea asta, gazele care ies trag după ele aer proaspăt. Arcurile închid supapele la loc. Varianta D7F, cu aceeași cilindree dar 8 supape, scotea doar 60 CP.',
      specs: [
        ['Supape', '16'],
        ['Admisie deschisă', '350°–590° (model)'],
        ['Evacuare deschisă', '130°–370° (model)'],
        ['Ridicare adm. / ev.', live.lift1],
      ],
      view: pv([CYL[0].x - 1, DECK + 5, 0], [CYL[0].x - 8, DECK + 26, 26]),
      anchor: (o) => {
        sim.cyl[0].valves[2].getWorldPosition(o);
        return o.set(o.x - 1.4, o.y + 2.6, o.z + 1.6);
      },
    },
    {
      id: 'cam',
      internal: true,
      group: 'Distribuție',
      name: 'Ax cu came și culbutori',
      lead: 'Un singur ax cu came acționează toate cele 16 supape prin culbutori în furcă.',
      body: 'Fiecare camă împinge rola unui culbutor, care basculează pe axul lui și apasă două supape deodată. Axul se învârte la jumătate din turația motorului, pentru că un ciclu în patru timpi ține două rotații. Motorul nu are tacheți hidraulici: jocul se reglează din șuruburile de pe culbutori, iar un joc nereglat se aude ca un țăcănit.',
      specs: [
        ['Arbori cu came', '1 (SOHC)'],
        ['Came', '8: 4 admisie, 4 evacuare'],
        ['Raport de transmisie', '1 : 2'],
        ['Turație ax cu came', live.cam],
      ],
      view: pv([CYL[1].x - 2, CAM_Y, 0], [CYL[1].x - 10, CAM_Y + 22, 26]),
      anchor: (o) => o.set(CYL[1].x, ROCKER_SHAFT.y + 1.6 + ex() * HEAD_EX, 1.4),
    },
    {
      id: 'timing',
      group: 'Distribuție',
      name: 'Curea de distribuție',
      lead: 'Cureaua dințată ține axul cu came sincronizat cu arborele cotit și antrenează pompa de apă.',
      body: 'Pinionul axului cu came are de două ori mai mulți dinți decât cel al arborelui cotit, deci se învârte la jumătate. Întinzătorul ține cureaua tensionată. Motorul e „cu interferență”: dacă cureaua se rupe, pistoanele lovesc supapele rămase deschise și le îndoaie. De aceea se schimbă la interval fix, odată cu rolele.',
      specs: [
        ['Dinți pinioane (model)', '20 / 40'],
        ['Turație pompă de apă', live.wp],
        ['La înlocuire', 'curea + întinzător + role'],
      ],
      view: pv([TB_X, 13, 0], [TB_X - 42, 26, 30]),
      anchor: (o) => o.set(TB_X - 1.3 - ex() * 7, 18, 3.6),
    },
    {
      id: 'plug',
      group: 'Aprindere',
      name: 'Bujii și rampa de bobine',
      lead: 'Un bloc cu patru bobine stă direct peste bujii, fără fire de înaltă tensiune separate.',
      body: 'Arderea are nevoie de timp ca să ajungă la presiunea maximă, așa că scânteia sare cu câteva grade înainte de PMS. În model avansul e fix, 12°; calculatorul motorului îl variază după turație și sarcină. Rampa de bobine e un punct slab cunoscut la motorul ăsta: când cedează o bobină, motorul merge pe trei cilindri.',
      specs: [
        ['Avans', '12° înainte de PMS (model)'],
        ['Interval între aprinderi', '180°'],
        ['Scântei pe secundă', live.sparks],
        ['Cilindrul 1 acum', live.phase1],
      ],
      view: pv([-2, HEAD_TOP, 3], [-16, HEAD_TOP + 22, 38]),
      anchor: (o) => o.set(CYL[3].x, 31 + ex() * HEAD_EX, 6.4),
    },
    {
      id: 'intake',
      group: 'Admisie',
      name: 'Galerie de admisie',
      lead: 'Aerul trece prin clapeta de accelerație, intră în plenum și apoi în fiecare cilindru.',
      body: 'Galeria e din plastic: e ușoară, iar pereții netezi și reci ajută umplerea. Fiecare cilindru are tubul lui. Injecția e multipunct: câte un injector pe cilindru pulverizează benzina în galerie, chiar înainte de supapele de admisie, iar benzina vine pe rampa de combustibil.',
      specs: [
        ['Cilindree', '1149 cm³'],
        ['Debit teoretic de aer', live.air],
        ['Injectoare', '4, în galerie'],
        ['Umplere considerată', '100%'],
      ],
      view: pv([0, 16, -12], [-26, 40, -50]),
      anchor: (o) => o.set(-4, 18 + ex() * HEAD_EX, -15.4 - ex() * 9),
    },
    {
      id: 'exhaust',
      group: 'Gaze arse',
      name: 'Evacuare și catalizator',
      lead: 'Galeria din fontă adună cei patru cilindri într-o singură țeavă, direct în catalizator.',
      body: 'Catalizatorul e montat aproape de motor ca să se încălzească repede după pornire, pentru că sub vreo 300 °C nu curăță aproape nimic. Sonda lambda din colector măsoară oxigenul rămas, iar calculatorul corectează amestecul după ea. Ecranul termic protejează piesele din jur de căldura galeriei.',
      specs: [
        ['Configurație', '4 în 1'],
        ['Pulsuri pe secundă', live.sparks],
        ['Interval între pulsuri', '180°'],
      ],
      view: pv([6, 12, 10], [28, 28, 50]),
      anchor: (o) => o.set(14.6, 10.2 + ex() * HEAD_EX, 14.8 + ex() * 9),
    },
    {
      id: 'fly',
      group: 'Transmisie',
      name: 'Volantă și ambreiaj',
      lead: 'Stochează energie între aprinderi și netezește cuplul.',
      body: 'Cu doar două aprinderi pe rotație, între ele arborele cotit încetinește, apoi accelerează din nou. Volanta grea netezește impulsurile astea, mai ales la ralanti. Pe ea e prinsă placa de presiune a ambreiajului, iar coroana dințată e antrenată de demaror la pornire.',
      specs: [
        ['Aprinderi pe rotație', '2'],
        ['Turație', live.rpm],
      ],
      view: pv([BLOCK_X + 2, 2, 0], [BLOCK_X + 38, 16, 30]),
      anchor: (o) => o.set(BLOCK_X + 1.5 + ex() * 7, 10.6, 0),
    },
    {
      id: 'belt',
      group: 'Accesorii',
      name: 'Curea de accesorii',
      lead: 'Cureaua poly-V antrenează alternatorul și pompa servodirecției.',
      body: 'Fuliile mici se rotesc mai repede decât arborele cotit, în raportul diametrelor. Întinzătorul ține cureaua tensionată. Pe mașinile cu aer condiționat se adaugă compresorul, care nu apare în model.',
      specs: [
        ['Turație alternator', live.alt],
        ['Turație pompă servodirecție', live.ps],
        ['Viteza curelei', live.beltV],
      ],
      view: pv([AB_X, 6, -4], [AB_X - 38, 22, 22]),
      anchor: (o) => o.set(AB_X - 1.2 - ex() * 14, AB.alt.y + 1.9, AB.alt.z),
    },
    {
      id: 'oil',
      group: 'Ungere',
      name: 'Baie de ulei și filtru',
      lead: 'Uleiul stă în baie, pompa îl trimite prin filtru la paliere, biele și axul cu came.',
      body: 'Baia e din tablă de oțel și ține uleiul la răcit. Pompa de ulei e antrenată de arborele cotit și trimite uleiul prin filtru spre paliere, biele, culbutori și axul cu came. Joja din față arată nivelul.',
      specs: [
        ['Vâscozitate uzuală', '5W-30 / 5W-40'],
        ['Filtru', 'cartuș înșurubat'],
      ],
      view: pv([0, -5, 2], [-22, 10, 44]),
      anchor: (o) => o.set(6, -9.6 - ex() * 5, 7.6),
    },
  ];
}
