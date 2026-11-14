/**
 * Graph geometry: audio values <-> pixels, plus the graph's fixed labels.
 * Frequency is logarithmic (every octave gets equal width), gain is linear.
 */
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ } from '../../audio/spectrum-source';

export interface Size {
  width: number;
  height: number;
}

/** Graph size plus its vertical zoom: ±`db` from the top line to the bottom line. */
export interface View extends Size {
  db: number;
}

/**
 * The graph spans 20 Hz … 22.4 kHz, the analyzer's range: a little past
 * hearing's 20 kHz so the top third-octave bar (17.8–22.4 kHz) fits. Nodes
 * stay within 20 Hz … 20 kHz (`LIMITS.freq`).
 */
const LOG_MIN = Math.log10(SPECTRUM_MIN_HZ);
const LOG_SPAN = Math.log10(SPECTRUM_MAX_HZ) - LOG_MIN;

export const freqToX = (f: number, s: Size) => ((Math.log10(f) - LOG_MIN) / LOG_SPAN) * s.width;
export const xToFreq = (x: number, s: Size) => 10 ** (LOG_MIN + (x / s.width) * LOG_SPAN);
/**
 * The graph is exactly the gain range, plus a margin at the top and bottom so
 * a node at the very top or bottom (±24 dB) is still fully visible.
 *
 * The band panel uses the same margin (CSS variable `--gain-margin`, set in
 * App), so each fader's travel lines up exactly with the graph: a fader
 * circle sits at the same height as its node.
 */
export const GAIN_MARGIN = 30;
const gainArea = (s: Size) => {
  const half = Math.max(1, (s.height - 2 * GAIN_MARGIN) / 2);
  return { mid: GAIN_MARGIN + half, half };
};
export const gainToY = (g: number, v: View) => {
  const { mid, half } = gainArea(v);
  return mid - (g / v.db) * half;
};
export const yToGain = (y: number, v: View) => {
  const { mid, half } = gainArea(v);
  return ((mid - y) / half) * v.db;
};

/** Vertical grid lines (1-2-3…9 per decade) and the ones that get a label. */
export const FREQ_GRID = [
  20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900,
  1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000,
];
export const FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
/** Where hearing ends (young ears; less with age). Above it the graph is shaded. */
export const HEARING_MAX_HZ = 20000;
/** Horizontal grid lines (and dB scale labels) for a zoom level. */
export const dbGrid = (db: number) => {
  const step = db > 12 ? 6 : 3;
  const lines: number[] = [];
  for (let g = -db + step; g < db; g += step) lines.push(g);
  return lines;
};

export const formatFreqShort = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

/**
 * Named regions of the audible range, shown faintly above the graph so a
 * beginner learns what each area of sound is called. Boundaries are the
 * common rule-of-thumb values, not hard science.
 */
export const REGIONS = [
  { name: 'Sub bass', from: 20, to: 60 },
  { name: 'Bass', from: 60, to: 250 },
  { name: 'Low mids', from: 250, to: 500 },
  { name: 'Mids', from: 500, to: 2000 },
  { name: 'Upper mids', from: 2000, to: 4000 },
  { name: 'Presence', from: 4000, to: 6000 },
  { name: 'Air', from: 6000, to: 20000 },
  // Too narrow for its name; its divider marks where hearing ends.
  { name: 'Beyond hearing', from: 20000, to: SPECTRUM_MAX_HZ },
] as const;


/** Precise frequency for readouts: "56.3 Hz", "250 Hz", "1.25 kHz", "12.5 kHz". */
export function formatHz(f: number): string {
  if (f < 100) return `${f.toFixed(1)} Hz`;
  if (f < 1000) return `${Math.round(f)} Hz`;
  return `${(f / 1000).toFixed(f < 10000 ? 2 : 1)} kHz`;
}

/** Gain for readouts: "+3.5 dB", "−3.5 dB" (a real minus sign), "0 dB". */
export function formatDb(g: number): string {
  const r = Math.round(g * 10) / 10;
  if (r === 0) return '0 dB';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} dB`;
}
