import type { PresentationMeta } from '../framework/types';

/**
 * Every presentation on the platform. Each `load` is a separate chunk, so three.js and the
 * scene code only download when a presentation is opened.
 */
export const PRESENTATIONS: PresentationMeta[] = [
  {
    slug: 'flat-six',
    title: 'Flat-Six Live',
    eyebrow: 'Boxer · 6 cilindri · 3,3 L · ciclu Otto',
    summary: 'Motor boxer secționat: pistoane, biele, supape și curea de accesorii pe cinematica reală.',
    intro:
      'Un motor boxer secționat ca la expoziție. Pistoanele, bielele, supapele și cureaua de accesorii se mișcă după cinematica reală. Trage ca să rotești, apasă pe un punct.',
    thumbnail: '/thumbnails/flat-six.jpg',
    tags: ['Motor', 'Cinematică', 'Distribuție'],
    load: () => import('./flat-six'),
  },
  {
    slug: 'ferrari-v8',
    title: 'Ferrari V8 F154',
    eyebrow: 'V8 la 90° · 3,9 L · twin-turbo · arbore flat-plane',
    summary: 'V8-ul twin-turbo din 488 GTB, secționat: arborele flat-plane, ordinea de aprindere și cele două turbo-uri.',
    intro:
      'Motorul F154 de 3,9 litri din Ferrari 488 GTB, secționat. Diferența față de un V8 obișnuit e arborele cotit flat-plane: comută-l pe cross-plane din bara de jos și compară aprinderile pe fiecare bancă.',
    thumbnail: '/thumbnails/ferrari-v8.jpg',
    tags: ['Motor', 'Turbo', 'Arbore cotit'],
    load: () => import('./ferrari-v8'),
  },
];

export const findPresentation = (slug: string | undefined) => PRESENTATIONS.find((p) => p.slug === slug);
