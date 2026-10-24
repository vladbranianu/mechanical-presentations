/* Device-quality heuristics shared by every presentation. */
import type { Quality } from './types';

/** 'low' for touch-first small screens, few cores or little memory; `?quality=` overrides. */
export function detectQuality(): Quality {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  if (coarse && small) return 'low';
  if ((nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4) return 'low';
  return 'high';
}

/** Starting pixel-ratio range for the canvas. */
export const dprRange = (q: Quality): [number, number] => (q === 'low' ? [1, 1.5] : [1, 2]);
