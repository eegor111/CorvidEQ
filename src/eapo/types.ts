/**
 * Core data model: one EQ "band" = one Equalizer APO filter line.
 *
 * Only filter types the app can draw *and* write back faithfully are listed.
 * Each code matches Equalizer APO's own abbreviation, so serializing is trivial.
 */
/** The everyday shapes: the picker's main list, and what the wheel cycles through. */
export const FILTER_TYPES = ['PK', 'LSC', 'HSC', 'HPQ', 'LPQ', 'NO', 'BP'] as const;
/** The rest of Equalizer APO's shapes, behind "More…" in the picker. */
export const MORE_TYPES = ['LS 6dB', 'LS', 'LS 12dB', 'HS 6dB', 'HS', 'HS 12dB', 'AP'] as const;
export type FilterType = (typeof FILTER_TYPES)[number] | (typeof MORE_TYPES)[number];

export interface FilterTypeInfo {
  label: string;
  /** Does dragging up/down (gain) mean anything for this filter? */
  hasGain: boolean;
  defaultQ: number;
  /**
   * Corner-frequency shelves only: Fc is the shelf's corner, not its middle,
   * and the slope S is fixed (S = dB per octave / 12), so they have no Q.
   */
  shelf?: { low: boolean; s: number };
}

/** What Equalizer APO uses for a shelf that gives neither Q nor slope. */
export const DEFAULT_SHELF_S = 0.9;

export const FILTER_INFO: Record<FilterType, FilterTypeInfo> = {
  PK: { label: 'Bell', hasGain: true, defaultQ: 1 },
  LSC: { label: 'Low shelf', hasGain: true, defaultQ: 0.707 },
  HSC: { label: 'High shelf', hasGain: true, defaultQ: 0.707 },
  HPQ: { label: 'Low cut', hasGain: false, defaultQ: 0.707 },
  LPQ: { label: 'High cut', hasGain: false, defaultQ: 0.707 },
  NO: { label: 'Notch', hasGain: false, defaultQ: 4 },
  BP: { label: 'Band-pass', hasGain: false, defaultQ: 1 },
  'LS 6dB': { label: 'Low shelf 6 dB', hasGain: true, defaultQ: 0.707, shelf: { low: true, s: 0.5 } },
  LS: { label: 'Low shelf 10.8 dB', hasGain: true, defaultQ: 0.707, shelf: { low: true, s: DEFAULT_SHELF_S } },
  'LS 12dB': { label: 'Low shelf 12 dB', hasGain: true, defaultQ: 0.707, shelf: { low: true, s: 1 } },
  'HS 6dB': { label: 'High shelf 6 dB', hasGain: true, defaultQ: 0.707, shelf: { low: false, s: 0.5 } },
  HS: { label: 'High shelf 10.8 dB', hasGain: true, defaultQ: 0.707, shelf: { low: false, s: DEFAULT_SHELF_S } },
  'HS 12dB': { label: 'High shelf 12 dB', hasGain: true, defaultQ: 0.707, shelf: { low: false, s: 1 } },
  AP: { label: 'All-pass', hasGain: false, defaultQ: 0.707 },
};

export interface Band {
  id: string;
  enabled: boolean;
  type: FilterType;
  /** Center / corner frequency in Hz. */
  freq: number;
  /** dB. Ignored by filter types without gain. */
  gain: number;
  /** Quality factor: higher = narrower. */
  q: number;
  /** Cuts only (HPQ / LPQ): dB per octave. Missing = 12 (one filter). */
  slope?: Slope;
}

/**
 * Steeper cuts. Equalizer APO's cuts are 12 dB/oct; 24 and 48 are 2 and 4 of
 * them in a row (Butterworth: the flattest passband, no bump at the corner).
 */
export const SLOPES = [12, 24, 48] as const;
export type Slope = (typeof SLOPES)[number];

export const hasSlope = (type: FilterType) => type === 'HPQ' || type === 'LPQ';

/** Fixed-slope shelves have no Q: their slope is part of the shape. */
export const hasQ = (type: FilterType) => !FILTER_INFO[type].shelf;

/**
 * A shelf's slope S as a Q and back, at a given gain (Equalizer APO's own
 * formulas). S 0.5 cancels a pole against a zero: a true first-order shelf.
 * The floor keeps a slope over 12 dB from taking the root of a negative.
 */
export function shelfQ(gain: number, s: number): number {
  const A = 10 ** (gain / 40);
  return 1 / Math.sqrt(Math.max((A + 1 / A) * (1 / s - 1) + 2, 1 / 900));
}
export function shelfS(gain: number, q: number): number {
  const A = 10 ** (gain / 40);
  return 1 / ((1 / (q * q) - 2) / (A + 1 / A) + 1);
}

/** How far a corner shelf's middle sits from its corner, as a ratio. */
export const cornerShift = (gain: number, s: number) => 10 ** (Math.abs(gain) / 80 / s);

/** The highest frequency a filter may be built on: just under Nyquist. */
export const highestFilterHz = (sampleRate: number) => sampleRate * 0.499;

/**
 * The Fc a band really uses, keeping the filter's middle at or below `top`.
 * Equalizer APO doesn't stop a filter at Nyquist, and past it the filter is
 * unstable (noise, not a wrong EQ). A 16 kHz headset is where a plain band
 * gets there; a low corner shelf can on any device, its middle sits ABOVE Fc.
 */
export function fileFreq(band: Band, top: number = LIMITS.freq.max): number {
  const shelf = FILTER_INFO[band.type].shelf;
  if (!shelf) return Math.min(band.freq, top);
  const shift = cornerShift(band.gain, shelf.s);
  return Math.min(band.freq, shelf.low ? top / shift : top * shift);
}

/** The frequency the filter is built around: Fc, or a corner shelf's middle. */
export function filterCenter(band: Band): number {
  const shelf = FILTER_INFO[band.type].shelf;
  const fc = fileFreq(band);
  if (!shelf) return fc;
  const shift = cornerShift(band.gain, shelf.s);
  return shelf.low ? fc * shift : fc / shift;
}

/**
 * The Q of each filter in a Butterworth chain of `slope / 6` poles, lowest
 * first: Q = 1 / (2 cos θ), θ = (2k − 1)π / 2N. 12 → [0.707], 24 →
 * [0.541, 1.307], 48 → [0.510, 0.601, 0.900, 2.563].
 */
export function butterworthQs(slope: Slope): number[] {
  const poles = slope / 6;
  return Array.from({ length: poles / 2 }, (_, k) => 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * poles))));
}

const BUTTERWORTH_Q = Math.SQRT1_2;

/**
 * The filters one band really is: itself, or a steep cut's chain. The band's
 * Q scales the last (sharpest) one, so Q 0.707 = exact Butterworth and a
 * higher Q adds a bump at the corner, just like the 12 dB cut.
 */
export function bandStages(band: Band): Band[] {
  const slope = band.slope ?? 12;
  if (!hasSlope(band.type) || slope === 12) return [band];
  const qs = butterworthQs(slope);
  return qs.map((q, i) => ({ ...band, q: i === qs.length - 1 ? (q * band.q) / BUTTERWORTH_Q : q }));
}

/** The band's Q back from its chain's last filter (reading a file we wrote). */
export const cutQFromLastStage = (slope: Slope, q: number) => (q * BUTTERWORTH_Q) / butterworthQs(slope).at(-1)!;

export type Side = 'L' | 'R';

/**
 * A left / right EQ. `bands` of the EQ is always the side on screen, so
 * everything that edits or draws bands works unchanged; the other side waits
 * here. It lives inside the EQ so that undo, A/B, per-output EQs and presets
 * carry both sides without knowing about them. There's one `preamp` for both:
 * separate levels would shift the left / right balance.
 */
export interface SplitEq {
  /** False after unsplitting: the other side is kept, and splitting again brings it back. */
  on: boolean;
  /** The side on screen. */
  side: Side;
  other: Band[];
  /** The other side's preset name (each side has its own, like A/B slots). */
  otherPreset: string;
}

/** Everything that describes one EQ setting (what gets saved / undone). */
export interface EqSettings {
  preamp: number;
  bands: Band[];
  split?: SplitEq;
}

/** The bands one channel plays, whichever side is on screen. */
export const sideBands = ({ bands, split }: EqSettings, side: Side): Band[] =>
  (split?.on && split.side !== side ? split.other : bands);

/**
 * Limits for every parameter, shared by the store, the controls and the parser.
 * Gain is ±24 dB, which is also the graph's full height: nodes can do deep cuts
 * by dragging, and every node always stays on screen.
 */
export const LIMITS = {
  freq: { min: 20, max: 20000 },
  gain: { min: -24, max: 24 },
  q: { min: 0.1, max: 30 },
  preamp: { min: -24, max: 24 },
  /** dB taken off the far side; the very end means silent (`format.ts`). */
  balance: { min: -60, max: 60 },
  /** ms. 20 covers any room; the rest is for lining sound up with a slow screen. */
  delay: { min: 0, max: 200 },
} as const;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Balance and delay: they fit the speakers and the room to the listener, so
 * they belong to an output, not to an EQ or a preset (`state/stereo.ts`).
 */
export interface Stereo {
  /** dB taken off one side: above 0 = toward the right (the left gets quieter). */
  balance: number;
  /** ms added to each channel. Never negative: a channel can only wait. */
  delayL: number;
  delayR: number;
}

export const FLAT_STEREO: Stereo = { balance: 0, delayL: 0, delayR: 0 };

/**
 * Each side's preamp in dB. Balance only ever turns a side down: nothing can
 * clip, and Auto's headroom stays right.
 */
export const balanceCuts = (balance: number) => ({
  left: balance > 0 ? -balance : 0,
  right: balance < 0 ? balance : 0,
});
