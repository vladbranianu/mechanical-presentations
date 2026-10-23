import type { CameraView, PartInfo, Vec3 } from '../../framework/types';
import { CRANKS, DECK, LAMBDA, PHASES, PITCH, PUL, bankIntervals, fmt, omega, phaseIdx } from './engine';
import { bankPoint, type FerrariV8Sim } from './scene';

const pv = (t: Vec3, p: Vec3, k = 1.9): CameraView => ({
  target: t,
  position: [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k, t[2] + (p[2] - t[2]) * k],
});

export const HOME_VIEW: CameraView = { target: [-3, 5, 1], position: [-63, 45, 89] };

const STROKE_M = 0.083,
  R_M = 0.0415;

export function makeParts(sim: FerrariV8Sim): PartInfo[] {
  const live = {
    rpm: () => fmt(sim.rpm) + ' rpm',
    crank: () => CRANKS[sim.crank].label,
    order: () => CRANKS[sim.crank].order.join('-'),
    bankA: () => bankIntervals(sim.crank, 1).join(' · ') + '°',
    vp: () => fmt((2 * STROKE_M * sim.rpm) / 60, 1) + ' m/s',
    acc: () => fmt((R_M * omega(sim.rpm) ** 2 * (1 + LAMBDA)) / 9.81) + ' g',
    cam: () => fmt(sim.rpm / 2) + ' rpm',
    sparks: () => fmt((sim.rpm / 60) * 4) + ' /s',
    pulses: () => fmt((sim.rpm / 60) * 2) + ' /s',
    air: () => fmt((3.902 * sim.rpm) / 120) + ' L/s',
    rodAng: () => fmt(sim.cyl[1].rodAng, 1) + '°',
    lift1: () => fmt(sim.cyl[0].liftI * 10, 1) + ' / ' + fmt(sim.cyl[0].liftE * 10, 1) + ' mm',
    phase3: () => PHASES[phaseIdx(sim.cyl[2].p)].name,
    alt: () => fmt((sim.rpm * PUL.crank.r) / PUL.alt.r) + ' rpm',
    wp: () => fmt((sim.rpm * PUL.crank.r) / PUL.wp.r) + ' rpm',
    beltV: () => fmt(omega(sim.rpm) * (PUL.crank.r / 100), 1) + ' m/s',
  };
  const ex = () => sim.explode;
  const c2 = sim.cyl[1],
    c3 = sim.cyl[2],
    c1 = sim.cyl[0];

  return [
    {
      id: 'crank',
      internal: true,
      group: 'Mecanism bielă-manivelă · diferența cheie',
      name: 'Arbore cotit flat-plane',
      lead: 'Toate cele patru fusuri de bielă stau în același plan, la 180° unul de altul.',
      body: 'Majoritatea V8-urilor de serie (americane, germane) au arbore cross-plane: fusurile la 90°, ca o cruce văzută din capăt. Ferrari folosește flat-plane, ca un motor de curse: practic două motoare cu 4 cilindri în linie pe același arbore. Aprinderile alternează strict între bănci, deci fiecare bancă aprinde la exact 180°. Asta dă pulsuri de evacuare egale, turații mari (arbore mai ușor, contragreutăți mici) și sunetul ascuțit. Prețul: forțele de inerție de ordinul 2 nu se anulează, deci motorul vibrează mai mult decât un cross-plane. Comută din bara de jos ca să vezi diferența.',
      specs: [
        ['Arbore afișat', live.crank],
        ['Ordine de aprindere', live.order],
        ['Intervale pe banca A', live.bankA],
        ['Bielele pe un fus', '2 (câte una din fiecare bancă)'],
        ['Turație', live.rpm],
      ],
      view: pv([0, -1, 2], [-16, 1.5, 40]),
      anchor: (o) => o.set(-PITCH, -1.4, 2.6),
    },
    {
      id: 'piston',
      internal: true,
      group: 'Mecanism bielă-manivelă · cilindrul 2',
      name: 'Piston',
      lead: 'Alezaj mai mare decât cursa: motor „supra-pătrat”, făcut pentru turație.',
      body: 'Cu 86,5 mm alezaj și doar 83 mm cursă, pistonul parcurge un drum scurt la fiecare rotație, așa că viteza lui medie rămâne rezonabilă chiar și la 8000 rpm. Turbo-urile cer în schimb un raport de compresie relativ mic, ca amestecul comprimat suplimentar să nu detoneze.',
      specs: [
        ['Alezaj × cursă', '86,5 × 83 mm'],
        ['Cilindree', '3902 cm³'],
        ['Viteză medie', live.vp],
        ['Accelerație la PMS', live.acc],
      ],
      view: { target: [c2.x, 11, 11], position: [c2.x - 18, 26, 58] },
      anchor: (o) => bankPoint(1, c2.x, -3.2, c2.crown - 0.4, o),
    },
    {
      id: 'rod',
      internal: true,
      group: 'Mecanism bielă-manivelă · cilindrul 2',
      name: 'Bielă',
      lead: 'Două biele, una din fiecare bancă, stau una lângă alta pe același fus.',
      body: 'De aceea băncile sunt decalate pe lungime: cilindrul 5 nu e exact în dreptul cilindrului 1, ci deplasat cu lățimea unei biele. Unghiul de 90° dintre bănci, combinat cu fusurile la 180°, face ca cei doi cilindri de pe același fus să aprindă la 90° unul după altul.',
      specs: [
        ['Lungime (model)', fmt(14.4 * 10) + ' mm'],
        ['λ = r / L (model)', fmt(LAMBDA, 2)],
        ['Unghi acum', live.rodAng],
      ],
      view: { target: [c2.x, 4, 5], position: [c2.x - 22, -3, 50] },
      anchor: (o) => o.copy(c2.rod.position).setZ(c2.rod.position.z + 0.8),
    },
    {
      id: 'valve',
      internal: true,
      group: 'Distribuție · cilindrul 1',
      name: 'Supape (4 pe cilindru)',
      lead: 'Două de admisie spre interiorul V-ului, două de evacuare spre exterior.',
      body: 'Cu 32 de supape, aria de curgere e mare pentru un alezaj de 86,5 mm. Supapele sunt acționate prin culbutori cu rolă, care reduc frecarea la turație mare. Unghiurile de deschidere din model sunt ilustrative: pe motorul real ambele axe cu came își schimbă calajul continuu, după sarcină și turație.',
      specs: [
        ['Total supape', '32'],
        ['Admisie deschisă (model)', '345°–575°'],
        ['Evacuare deschisă (model)', '150°–375°'],
        ['Ridicare adm. / ev.', live.lift1],
      ],
      view: pv([c1.x, 15, 18], [c1.x - 10, 10, 44]),
      anchor: (o) => bankPoint(1, c1.x, -2.2, DECK + 2.4, o, ex() * 12),
    },
    {
      id: 'cam',
      internal: true,
      group: 'Distribuție',
      name: 'Axe cu came și variator',
      lead: 'Patru axe cu came, două pe bancă, antrenate prin lanț din spate, de lângă volantă.',
      body: 'Un ciclu în patru timpi ține două rotații de arbore cotit, deci axele cu came se învârt la jumătate din turație. Pe capătul fiecărui ax e un variator hidraulic care rotește axul față de pinion, schimbând momentul deschiderii supapelor: mult avans pentru cuplu jos, altfel pentru putere sus.',
      specs: [
        ['Raport de transmisie', '1 : 2'],
        ['Turație axe cu came', live.cam],
        ['Calaj variabil', 'admisie și evacuare'],
        ['Antrenare', 'lanț, pe partea volantei'],
      ],
      view: pv([4, 20, 22], [12, 34, 46]),
      anchor: (o) => bankPoint(1, c2.x + 1.75, -2.2, DECK + 8.2, o, ex() * 12),
    },
    {
      id: 'plug',
      group: 'Aprindere · cilindrul 3',
      name: 'Bujie și bobină',
      lead: 'Câte o bobină direct pe fiecare bujie, în centrul celor patru supape.',
      body: 'La un V8 cu ciclu în patru timpi, o scânteie sare la fiecare 90° de arbore cotit. Cu arborele flat-plane, aprinderile alternează strict: A, B, A, B. Avansul din model e fix, 15°. Pe motorul real calculatorul îl ajustează permanent, mai ales sub presiune de supraalimentare.',
      specs: [
        ['Interval între aprinderi', '90°'],
        ['Avans (model)', '15° înainte de PMS'],
        ['Scântei pe secundă', live.sparks],
        ['Cilindrul 3 acum', live.phase3],
      ],
      view: pv([c3.x, 22, 24], [c3.x + 8, 32, 46]),
      anchor: (o) => bankPoint(1, c3.x, 0, DECK + 12.8, o, ex() * 12),
    },
    {
      id: 'turbo',
      group: 'Supraalimentare',
      name: 'Turbocompresoare twin-scroll',
      lead: 'Câte un turbo IHI pe fiecare bancă, răcit cu apă, cu carcasa turbinei în două canale.',
      body: 'Gazele arse învârt turbina, iar pe același ax compresorul împinge aer sub presiune spre admisie. Twin-scroll înseamnă că galeria fiecărei bănci e împărțită în două canale, fiecare cu doi cilindri care aprind la 360° unul de altul, deci pulsurile nu se încurcă. Asta funcționează curat tocmai pentru că arborele flat-plane dă fiecărei bănci aprinderi egal distanțate. Galeriile au câte două tuburi colectoare pe bancă: cilindrii de la capete într-unul, cei din mijloc în celălalt.',
      specs: [
        ['Turbocompresoare', '2 × IHI, twin-scroll'],
        ['Pulsuri pe turbină', live.pulses],
        ['Putere (488 GTB)', '670 CP la 8000 rpm'],
        ['Cuplu (488 GTB)', '760 Nm la 3000 rpm'],
      ],
      view: pv([14, 0, 26], [-2, 12, 52]),
      anchor: (o) => o.set(14, 2.4 - ex() * 3, 26 + 1.4 + ex() * 9),
    },
    {
      id: 'intercooler',
      group: 'Supraalimentare',
      name: 'Intercoolere',
      lead: 'Răcesc aerul după compresor, înainte să intre în motor.',
      body: 'Comprimat, aerul se încălzește mult, iar aerul cald e mai puțin dens: în cilindru ar intra mai puțin oxigen și riscul de detonație ar crește. Fiecare turbo are intercoolerul lui aer-aer, montat lateral, în dreptul prizelor de aer din flancurile mașinii. De acolo, aerul rece urcă spre clapeta din spatele colectorului.',
      specs: [
        ['Tip', 'aer-aer, câte unul pe bancă'],
        ['Poziție', 'prizele laterale ale caroseriei'],
      ],
      view: pv([28, 10, 32], [12, 24, 62]),
      anchor: (o) => o.set(28, 14.8, 34 + ex() * 14),
    },
    {
      id: 'exhaust',
      group: 'Gaze arse',
      name: 'Galerii de evacuare',
      lead: 'Fiecare bancă are galeria ei, care duce gazele spre turbo, pe exteriorul V-ului.',
      body: 'Pe fiecare bancă aprinderile vin la 180° una după alta, perfect regulat. La un V8 cross-plane intervalele pe o bancă sunt neregulate (90°, 180°, 270°, 180°), așa că pentru pulsuri egale ar trebui țevi încrucișate între bănci, celebrul „ghem de șerpi” de la mașinile de curse. Comută arborele în bara de jos și urmărește intervalele.',
      specs: [
        ['Intervale pe banca A', live.bankA],
        ['Pulsuri pe bancă', live.pulses],
        ['Temperatură gaze, sarcină plină', 'peste 900 °C'],
      ],
      view: pv([-2, 8, 26], [-18, 14, 56]),
      anchor: (o) => o.set(-6, 9.2 - ex() * 3, 26.6 + ex() * 9),
    },
    {
      id: 'intake',
      group: 'Admisie',
      name: 'Colector de admisie',
      lead: 'Stă în V-ul dintre bănci, cu clapeta de accelerație în spate.',
      body: 'Aerul comprimat de cele două turbo-uri intră prin clapetă în colector și apoi, prin câte un runner, în fiecare cilindru. Benzina nu se amestecă aici: injecția e directă, cu injectoarele în camera de ardere, ceea ce răcește încărcătura și permite presiune turbo mai mare fără detonație.',
      specs: [
        ['Injecție', 'directă'],
        ['Debit aspirat fără turbo', live.air],
        ['Clapetă', 'una, comandă electronică'],
      ],
      view: pv([0, 24, 0], [-14, 42, 26]),
      anchor: (o) => o.set(-6, 27.8 + ex() * 14, 0),
    },
    {
      id: 'belt',
      group: 'Accesorii',
      name: 'Curea de accesorii',
      lead: 'O singură curea antrenează alternatorul, pompa de apă și compresorul de aer condiționat.',
      body: 'Fuliile mici se rotesc mai repede decât arborele cotit, în raportul diametrelor. Întinzătorul ține cureaua tensionată, iar amortizorul de pe fulia arborelui cotit preia vibrațiile torsionale. Pe F154, lanțul de distribuție e în spate, lângă volantă, așa că fața motorului rămâne doar pentru accesorii.',
      specs: [
        ['Turație alternator', live.alt],
        ['Turație pompă de apă', live.wp],
        ['Viteza curelei', live.beltV],
      ],
      view: pv([-29, 6, 0], [-60, 20, 26]),
      anchor: (o) => o.set(-29.4 - ex() * 8, 14.6, 8),
    },
    {
      id: 'sump',
      group: 'Ungere',
      name: 'Carter uscat',
      lead: 'Uleiul nu stă sub motor: pompe de evacuare îl trimit într-un rezervor separat.',
      body: 'La un carter clasic uleiul se adună într-o baie adâncă sub arbore. În viraje lungi la accelerație laterală mare se poate muta într-o parte și pompa trage aer. Carterul uscat aspiră continuu uleiul din motor, îl trimite în rezervor și de acolo îl pompează înapoi sub presiune. Bonus: baia e foarte plată, deci motorul stă mai jos în mașină.',
      specs: [
        ['Sistem', 'carter uscat'],
        ['Rezervor', 'separat, în față (model)'],
      ],
      view: pv([-10, -8, 0], [-34, -2, 28]),
      anchor: (o) => o.set(-14, -8.2 - ex() * 6, 7.2),
    },
    {
      id: 'fly',
      group: 'Transmisie',
      name: 'Volantă',
      lead: 'Netezește impulsurile de cuplu și transmite rotația spre cutia de viteze.',
      body: 'Cu patru aprinderi pe rotație, impulsurile se suprapun mult, așa că volanta poate fi ușoară, ceea ce ajută motorul să urce rapid în turație. În spatele ei, pe 488 GTB, vine o cutie cu dublu ambreiaj cu 7 trepte.',
      specs: [
        ['Aprinderi pe rotație', '4'],
        ['Turație maximă', '8000 rpm'],
        ['Turație', live.rpm],
      ],
      view: pv([25, 0, 0], [54, 12, 26]),
      anchor: (o) => o.set(24.9 + ex() * 8, 9.6, 0),
    },
  ];
}
