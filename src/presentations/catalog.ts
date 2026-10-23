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
];

export const findPresentation = (slug: string | undefined) => PRESENTATIONS.find((p) => p.slug === slug);
