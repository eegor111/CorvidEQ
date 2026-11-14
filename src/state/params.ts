/**
 * Every editable parameter, defined exactly once.
 *
 * A control (knob, fader, graph dot, arrow key, mouse wheel) never decides by
 * itself how a value moves. It asks here:
 *   toNorm / fromNorm  where the value sits along a control's travel (0…1)
 *   step               the value after one wheel notch / key press
 *
 * Frequency and Q move on a log scale (equal travel = equal ratio, which is
 * how hearing works); gain and preamp move linearly in dB.
 */
import { LIMITS } from '../eapo/types';

export type BandParam = 'freq' | 'gain' | 'q';
export type Direction = 1 | -1;

export interface ParamDef {
  toNorm(value: number): number;
  fromNorm(norm: number): number;
  step(value: number, dir: Direction, fine: boolean): number;
  /** A typed value, rounded to what the readout can show. */
  round(value: number): number;
}

const tenth = (v: number) => Math.round(v * 10) / 10;
const hundredth = (v: number) => Math.round(v * 100) / 100;
const thousandth = (v: number) => Math.round(v * 1000) / 1000;

function logScale(min: number, max: number) {
  return {
    toNorm: (v: number) => Math.log(v / min) / Math.log(max / min),
    fromNorm: (n: number) => min * (max / min) ** n,
  };
}

function dbScale(min: number, max: number) {
  return {
    toNorm: (v: number) => (v - min) / (max - min),
    fromNorm: (n: number) => tenth(min + n * (max - min)),
    // One notch = 0.5 dB, fine = 0.1 dB.
    step: (v: number, d: Direction, fine: boolean) => tenth(v + d * (fine ? 0.1 : 0.5)),
    round: tenth,
  };
}

/** How far the balance's dB range reaches in the far side's loudness (0…1). */
const BALANCE_REACH = 1 - 10 ** (-LIMITS.balance.max / 20);

export const PARAMS: Record<BandParam | 'preamp' | 'balance' | 'delay', ParamDef> = {
  freq: {
    ...logScale(LIMITS.freq.min, LIMITS.freq.max),
    // One notch = a semitone, fine = a quarter of one.
    step: (v, d, fine) => v * 2 ** (d * (fine ? 1 / 48 : 1 / 12)),
    round: tenth,
  },
  gain: dbScale(LIMITS.gain.min, LIMITS.gain.max),
  q: {
    ...logScale(LIMITS.q.min, LIMITS.q.max),
    // One notch = 10% narrower/wider, fine = 2%. Up = higher Q = narrower.
    step: (v, d, fine) => thousandth(v * (fine ? 1.02 : 1.1) ** d),
    round: thousandth,
  },
  preamp: dbScale(LIMITS.preamp.min, LIMITS.preamp.max),
  // The knob moves the far side's loudness evenly, the classic balance law:
  // fine near the center (where small corrections live), quick toward silence
  // at the ends. Halfway round = -6 dB.
  balance: {
    toNorm: (v) => 0.5 + (Math.sign(v) * (1 - 10 ** (-Math.abs(v) / 20))) / BALANCE_REACH / 2,
    fromNorm: (n) => {
      const x = 2 * n - 1;
      return tenth(Math.sign(x) * -20 * Math.log10(1 - Math.abs(x) * BALANCE_REACH));
    },
    // One notch = 0.5 dB, fine = 0.1 dB, like every other dB control.
    step: (v, d, fine) => tenth(v + d * (fine ? 0.1 : 0.5)),
    round: tenth,
  },
  delay: {
    toNorm: (v) => v / LIMITS.delay.max,
    fromNorm: (n) => hundredth(n * LIMITS.delay.max),
    // Fine = 0.01 ms: about half a sample at 48 kHz, 3.4 mm of sound travel.
    step: (v, d, fine) => hundredth(v + d * (fine ? 0.01 : 0.1)),
    round: hundredth,
  },
};

/** Gain on the graph and on the faders is rounded to 0.1 dB. */
export const roundGain = tenth;

/** Vertical zoom of the graph (and the gain faders): ±12 or ±24 dB. */
export type ViewDb = 12 | 24;

/**
 * The definition a control should use. Gain and Level faders span the current
 * zoom so they stay aligned with the graph's dB lines; everything else is fixed.
 */
export function paramDef(key: BandParam | 'preamp', viewDb: ViewDb): ParamDef {
  return key === 'gain' || key === 'preamp' ? { ...PARAMS[key], ...dbScale(-viewDb, viewDb) } : PARAMS[key];
}
