/** Small inline icons, drawn with the current text color. */
import type { FilterType } from '../../eapo/types';

/** Pictogram of each filter's curve shape (16×12). */
const FILTER_PATHS: Record<FilterType, string> = {
  PK: 'M1 9 C5 9 6 3 8 3 C10 3 11 9 15 9',
  LSC: 'M1 4 L4 4 C7 4 8 9 11 9 L15 9',
  HSC: 'M1 9 L5 9 C8 9 9 4 12 4 L15 4',
  HPQ: 'M1 11 C3 11 4 4 7 4 L15 4',
  LPQ: 'M1 4 L9 4 C12 4 13 11 15 11',
  NO: 'M1 4 L6 4 C7.4 4 7.4 11 8 11 C8.6 11 8.6 4 10 4 L15 4',
  BP: 'M1 11 C5 11 6.4 3 8 3 C9.6 3 11 11 15 11',
  'LS 6dB': 'M1 4 C6 4 10 9 15 9',
  LS: 'M1 4 L4 4 C7 4 8 9 11 9 L15 9',
  'LS 12dB': 'M1 4 L5 4 C7 4 8 9 10 9 L15 9',
  'HS 6dB': 'M1 9 C6 9 10 4 15 4',
  HS: 'M1 9 L5 9 C8 9 9 4 12 4 L15 4',
  'HS 12dB': 'M1 9 L6 9 C8 9 9 4 11 4 L15 4',
  AP: 'M1 6 L5 6 C6.5 6 6.5 3 8 6 C9.5 9 9.5 6 11 6 L15 6',
};

export function FilterIcon({ type, size = 16 }: { type: FilterType; size?: number }) {
  return (
    <svg width={size} height={(size * 12) / 16} viewBox="0 0 16 12" aria-hidden>
      <path d={FILTER_PATHS[type]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const UndoIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" {...stroke} /></svg>
);
export const RedoIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" {...stroke} /></svg>
);
/**
 * A gear, outline only: eight straight-sided teeth (wider at the root, like a
 * real cog) around a hole. Drawn like the power icon it sits beside, but
 * with a thinner line: its many short edges pack more ink into the same
 * area, so at the shared width it looked brighter than the icons beside it.
 */
export const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path
      d="M19.37 10.16 L22.5 10.52 L22.5 13.48 L19.37 13.84 L18.51 15.91 L20.47 18.38 L18.38 20.47 L15.91 18.51 L13.84 19.37 L13.48 22.5 L10.52 22.5 L10.16 19.37 L8.09 18.51 L5.62 20.47 L3.53 18.38 L5.49 15.91 L4.63 13.84 L1.5 13.48 L1.5 10.52 L4.63 10.16 L5.49 8.09 L3.53 5.62 L5.62 3.53 L8.09 5.49 L10.16 4.63 L10.52 1.5 L13.48 1.5 L13.84 4.63 L15.91 5.49 L18.38 3.53 L20.47 5.62 L18.51 8.09 Z"
      {...stroke} strokeWidth={1.5}
    />
    <circle cx="12" cy="12" r="3.5" {...stroke} strokeWidth={1.5} />
  </svg>
);
export const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="m6 9 6 6 6-6" {...stroke} /></svg>
);
export const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" {...stroke} />
  </svg>
);
/** Classic power symbol: a broken ring with a line through the gap. */
export const PowerIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path d="M7.05 6.5a7.5 7.5 0 1 0 9.9 0M12 3v8" {...stroke} strokeWidth={2.4} />
  </svg>
);

/* Bypass: the signal line jumps over the EQ block (the dimmed box) instead
   of going through it. */
export const BypassIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
    <rect x="7" y="12" width="10" height="8" {...stroke} strokeOpacity={0.45} />
    <path d="M2 16h3V7h14v9h3" {...stroke} />
  </svg>
);

/* Analyzer views (20 px). Line: a spectrum trace. Heat: full-height stripes
   whose brightness is the level (opacity stands in for the heat ramp). */
export const LineViewIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path d="M2 18l4-6 3 3 4-9 3 6 3-3 3 7" {...stroke} />
  </svg>
);
/** Third-octave bars of different heights, standing on a baseline. */
export const BarsViewIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
    <rect x="3" y="12" width="3" height="8" />
    <rect x="7.5" y="6" width="3" height="14" />
    <rect x="12" y="9" width="3" height="11" />
    <rect x="16.5" y="14" width="3" height="6" />
  </svg>
);
export const HeatViewIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
    <rect x="3" y="4" width="3" height="16" opacity="0.3" />
    <rect x="7.5" y="4" width="3" height="16" opacity="0.65" />
    <rect x="12" y="4" width="3" height="16" />
    <rect x="16.5" y="4" width="3" height="16" opacity="0.5" />
  </svg>
);

/** Four corners pointing out (fill the screen) or in (back to the window). */
export const FullscreenIcon = ({ exit = false }: { exit?: boolean }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path d={exit
      ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
      : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} {...stroke} />
  </svg>
);

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path d="M19 12H5M11 6l-6 6 6 6" {...stroke} />
  </svg>
);

export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" {...stroke} />
  </svg>
);
