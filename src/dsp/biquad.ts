/**
 * Biquad filter math (Robert Bristow-Johnson's "Audio EQ Cookbook").
 *
 * Equalizer APO builds its filters from these same formulas, so the curve we
 * draw is the curve you hear.
 */
import { FILTER_INFO, filterCenter, highestFilterHz, shelfQ, type Band } from '../eapo/types';

/** Normalized biquad coefficients (a0 already divided out). */
export interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const IDENTITY: Coeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

export function coefficients(band: Band, sampleRate: number): Coeffs {
  if (!band.enabled) return IDENTITY;

  // Keep the frequency safely below Nyquist (half the sample rate).
  const f0 = Math.min(filterCenter(band), highestFilterHz(sampleRate));
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const shelf = FILTER_INFO[band.type].shelf;
  const alpha = Math.sin(w0) / (2 * (shelf ? shelfQ(band.gain, shelf.s) : band.q));
  const A = Math.pow(10, band.gain / 40);

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

  switch (band.type) {
    case 'PK':
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case 'LSC':
    case 'LS 6dB':
    case 'LS':
    case 'LS 12dB': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case 'HSC':
    case 'HS 6dB':
    case 'HS':
    case 'HS 12dB': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
    case 'LPQ':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'HPQ':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    // Only the phase turns (around Fc, over a width set by Q): the curve stays flat.
    case 'AP':
      b0 = 1 - alpha;
      b1 = -2 * cos;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    // The cookbook's "constant 0 dB peak gain" band-pass: Fc passes untouched
    // and everything else falls away, so the node sits on the curve at 0 dB.
    case 'BP':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'NO':
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * How much a filter boosts/cuts frequency `freq`, in dB.
 * Evaluates |H(e^jw)|² of the biquad directly (no audio needed).
 */
export function magnitudeDb(c: Coeffs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cw = Math.cos(w);
  const c2w = Math.cos(2 * w);
  const num = c.b0 * c.b0 + c.b1 * c.b1 + c.b2 * c.b2 + 2 * (c.b0 * c.b1 + c.b1 * c.b2) * cw + 2 * c.b0 * c.b2 * c2w;
  const den = 1 + c.a1 * c.a1 + c.a2 * c.a2 + 2 * (c.a1 + c.a1 * c.a2) * cw + 2 * c.a2 * c2w;
  // Floor avoids -Infinity at the exact bottom of a notch.
  return 10 * Math.log10(Math.max(num / den, 1e-12));
}
