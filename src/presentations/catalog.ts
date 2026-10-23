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
    slug: 'sandero-12',
    title: 'Sandero 1.2 16V',
    eyebrow: '4 în linie · 1,2 L 16V · 75 CP',
    summary: 'Motorul Renault D4F din Dacia Sandero 2009: un singur ax cu came, culbutori în furcă și curea de distribuție.',
    intro:
      'Motorul Renault D4F de 1,2 L din Dacia Sandero 2009, secționat. Un singur ax cu came mișcă 16 supape prin culbutori, iar cureaua dințată antrenează și pompa de apă. Trage ca să rotești, apasă pe un punct.',
    thumbnail: '/thumbnails/sandero-12.jpg',
    tags: ['Motor', 'Distribuție', '4 cilindri'],
    load: () => import('./sandero-d4f'),
  },
];

export const findPresentation = (slug: string | undefined) => PRESENTATIONS.find((p) => p.slug === slug);
