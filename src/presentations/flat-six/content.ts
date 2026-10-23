import type { CameraView, PartInfo, Vec3 } from '../../framework/types';
import { BELT_X, CYL, DECK, LAMBDA, PHASES, PUL, fmt, omega, phaseIdx } from './engine';
import type { FlatSixSim } from './scene';

/** Part close-ups sit 1.4× further out than the authored offset. */
const pv = (t: Vec3, p: Vec3, k = 1.4): CameraView => ({
  target: t,
  position: [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k, t[2] + (p[2] - t[2]) * k],
});

export const HOME_VIEW: CameraView = { target: [1, -8, 5], position: [-58, 46, 100] };

export function makeParts(sim: FlatSixSim): PartInfo[] {
  const live = {
    rpm: () => fmt(sim.rpm) + ' rpm',
    vp: () => fmt((2 * 0.0764 * sim.rpm) / 60, 1) + ' m/s',
    acc: () => fmt((0.0382 * omega(sim.rpm) ** 2 * (1 + LAMBDA)) / 9.81) + ' g',
    accBdc: () => fmt((0.0382 * omega(sim.rpm) ** 2 * (1 - LAMBDA)) / 9.81) + ' g',
    cam: () => fmt(sim.rpm / 2) + ' rpm',
    sparks: () => fmt((sim.rpm / 60) * 3) + ' /s',
    air: () => fmt((3.32 * sim.rpm) / 120) + ' L/s',
    rodAng: () => fmt(sim.cyl[2].rodAng, 1) + '°',
    lift1: () => fmt(sim.cyl[0].liftI * 10, 1) + ' / ' + fmt(sim.cyl[0].liftE * 10, 1) + ' mm',
    phase3: () => PHASES[phaseIdx(sim.cyl[2].p)].name,
    alt: () => fmt((sim.rpm * PUL.crank.r) / PUL.alt.r) + ' rpm',
    wp: () => fmt((sim.rpm * PUL.crank.r) / PUL.wp.r) + ' rpm',
    beltV: () => fmt(omega(sim.rpm) * 0.055, 1) + ' m/s',
  };
  const ex = () => sim.explode;

  return [
    {
      id: 'crank',
      internal: true,
      group: 'Mecanism bielă-manivelă',
      name: 'Arbore cotit',
      lead: 'Transformă mișcarea dus-întors a celor șase pistoane în rotație.',
      body: 'Fiecare cilindru are fusul lui de bielă. Pistoanele opuse (1–4, 2–5, 3–6) stau pe fusuri decalate cu 180° și se mișcă în oglindă, așa că forțele lor de inerție se anulează reciproc. De aici vine echilibrul natural al motorului boxer.',
      specs: [
        ['Rază manivelă', '38,2 mm'],
        ['Decalaj între perechi', '120°'],
        ['Ordine de aprindere', '1-6-2-4-3-5'],
        ['Turație', live.rpm],
      ],
      view: pv([-2, 0, 1], [-30, 30, 30]),
      anchor: (o) => o.set(-10, 1.5, 3),
    },
    {
      id: 'piston',
      internal: true,
      group: 'Mecanism bielă-manivelă · cilindrul 2',
      name: 'Piston',
      lead: 'Preia presiunea gazelor arse și o împinge în bielă.',
      body: 'Pistonul se oprește și pornește de două ori pe rotație. La punctul mort superior (PMS) accelerația e mai mare decât la cel inferior, pentru că biela are lungime finită și mișcarea nu e o sinusoidă pură.',
      specs: [
        ['Alezaj × cursă', '96 × 76,4 mm'],
        ['Viteză medie', live.vp],
        ['Accelerație la PMS', live.acc],
        ['Accelerație la PME', live.accBdc],
      ],
      view: pv([-1.35, 0, 13], [6, 30, 40]),
      anchor: (o) => o.set(CYL[1].x, 4, sim.cyl[1].crown),
    },
    {
      id: 'rod',
      internal: true,
      group: 'Mecanism bielă-manivelă · cilindrul 3',
      name: 'Bielă',
      lead: 'Leagă bolțul pistonului de fusul arborelui cotit.',
      body: 'Biela oscilează în timp ce pistonul urcă și coboară. Unghiul ei împinge pistonul lateral în peretele cilindrului, iar raportul λ dintre raza manivelei și lungimea bielei decide cât de departe de o sinusoidă e mișcarea pistonului.',
      specs: [
        ['Lungime între centre', '127 mm'],
        ['λ = r / L', '0,30'],
        ['Unghi maxim', '17,5°'],
        ['Unghi acum', live.rodAng],
      ],
      view: pv([10.45, 0, 7], [22, 28, 36]),
      anchor: (o) => o.copy(sim.cyl[2].rod.position).setY(sim.cyl[2].rod.position.y + 1.2),
    },
    {
      id: 'valve',
      internal: true,
      group: 'Distribuție · cilindrul 1',
      name: 'Supape',
      lead: 'Două pe cilindru în model: admisie sus, evacuare jos.',
      body: 'Supapa de admisie se deschide înainte ca cea de evacuare să se închidă. În cele 30° de suprapunere, gazele care ies trag după ele aer proaspăt în cilindru. Arcurile închid supapele la loc.',
      specs: [
        ['Admisie deschisă', '345°–575°'],
        ['Evacuare deschisă', '155°–375°'],
        ['Suprapunere', '30°'],
        ['Ridicare adm. / ev.', live.lift1],
      ],
      view: pv([CYL[0].x, 1, DECK + 3], [-26, 24, 44]),
      anchor: (o) => {
        sim.cyl[0].valves[0].getWorldPosition(o);
        return o.set(o.x, o.y + 1.6, o.z + 3);
      },
    },
    {
      id: 'cam',
      internal: true,
      group: 'Distribuție · banca A',
      name: 'Axe cu came',
      lead: 'Deschid supapele la momentul potrivit din ciclu.',
      body: 'Un ciclu în patru timpi ține două rotații de arbore cotit, așa că axele cu came se învârt la jumătate din turație. Fiecare bancă are un ax pentru admisie și unul pentru evacuare, antrenate prin lanț de la arborele cotit.',
      specs: [
        ['Raport de transmisie', '1 : 2'],
        ['Turație axe cu came', live.cam],
        ['Durată deschidere', '230° arbore cotit'],
        ['Ridicare maximă', '10 mm'],
      ],
      view: pv([-3, 1, DECK + 7], [2, 30, 52]),
      anchor: (o) => o.set(CYL[1].x + 5, 2.3, DECK + 7.2 + ex() * 12),
    },
    {
      id: 'plug',
      group: 'Aprindere · cilindrul 3',
      name: 'Bujie și bobină',
      lead: 'Fiecare cilindru are bobina lui montată direct pe bujie.',
      body: 'Arderea are nevoie de timp ca să ajungă la presiunea maximă, așa că scânteia sare cu câteva grade înainte de PMS. Aici avansul e fix, 15°. Un motor real îl variază după turație și sarcină.',
      specs: [
        ['Avans', '15° înainte de PMS'],
        ['Interval între aprinderi', '120°'],
        ['Scântei pe secundă', live.sparks],
        ['Cilindrul 3 acum', live.phase3],
      ],
      view: pv([CYL[2].x, 0, DECK + 8], [26, 16, 52]),
      anchor: (o) => o.set(CYL[2].x, 2.4, DECK + 12.6 + ex() * 12),
    },
    {
      id: 'fly',
      group: 'Transmisie',
      name: 'Volantă și ambreiaj',
      lead: 'Stochează energie între aprinderi și netezește cuplul.',
      body: 'Cu o aprindere la fiecare 120°, impulsurile de cuplu ale celor șase cilindri se suprapun, deci volanta poate fi relativ ușoară. Pe ea e prinsă placa de presiune a ambreiajului, iar coroana dințată e antrenată de demaror la pornire.',
      specs: [
        ['Dinți coroană', '96'],
        ['Aprinderi pe rotație', '3'],
        ['Turație', live.rpm],
      ],
      view: pv([25, 0, 0], [56, 14, 24]),
      anchor: (o) => o.set(26, 12.6, 0),
    },
    {
      id: 'exhaust',
      group: 'Gaze arse',
      name: 'Evacuare',
      lead: 'Galeriile duc gazele la câte un catalizator pe bancă, apoi în tobă.',
      body: 'Pe fiecare bancă aprinderile vin la 240° una după alta, deci pulsurile de presiune nu se încurcă între ele. Culoarea galeriilor lângă chiulasă vine de la oxidarea oțelului inoxidabil la temperatură mare.',
      specs: [
        ['Temperatură gaze, sarcină plină', '800–950 °C'],
        ['Pulsuri pe secundă', live.sparks],
        ['Interval pe bancă', '240°'],
      ],
      view: pv([8, -14, 8], [26, -2, 62]),
      anchor: (o) => o.set(19, -14.2 - ex() * 8, 12.4),
    },
    {
      id: 'intake',
      group: 'Admisie',
      name: 'Plenum din carbon',
      lead: 'Aerul trece prin filtru și clapetă, intră în plenum și apoi în fiecare cilindru.',
      body: 'Plenumul e un rezervor comun de aer. Fiecare cilindru își trage aerul printr-un runner propriu, iar injectoarele de pe rampa de combustibil pulverizează benzina chiar înainte de supapă.',
      specs: [
        ['Cilindree', '3,3 L'],
        ['Debit teoretic de aer', live.air],
        ['Umplere considerată', '100%'],
      ],
      view: pv([4, 14, 0], [24, 40, 34]),
      anchor: (o) => o.set(-4, 18.8 + ex() * 10, 2),
    },
    {
      id: 'belt',
      group: 'Accesorii',
      name: 'Curea de accesorii',
      lead: 'O singură curea antrenează alternatorul, pompa de apă și compresorul de aer condiționat.',
      body: 'Fuliile mai mici se rotesc mai repede decât arborele cotit, în raportul diametrelor. Întinzătorul ține cureaua tensionată, iar damperul de pe fulia arborelui cotit amortizează vibrațiile torsionale.',
      specs: [
        ['Turație alternator', live.alt],
        ['Turație pompă de apă', live.wp],
        ['Viteza curelei', live.beltV],
      ],
      view: pv([-25, 2, 0], [-58, 14, 26]),
      anchor: (o) => o.set(BELT_X - 1.6 - ex() * 8, PUL.alt.y + 2.4, PUL.alt.z),
    },
  ];
}
