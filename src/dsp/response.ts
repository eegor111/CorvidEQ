/**
 * Frequency response of a whole EQ: the sum (in dB) of every band plus preamp.
 * Filters in series multiply, and multiplying gains = adding decibels.
 */
import { bandStages, type Band, type EqSettings } from '../eapo/types';
import { coefficients, magnitudeDb } from './biquad';

/**
 * Curves are drawn at the captured output's own rate when it's known
 * (`curveRate()` in state/audio-source.ts); otherwise (the browser, Auto's
 * preamp) at 48 kHz, the most common Windows output rate.
 */
export const DISPLAY_SAMPLE_RATE = 48000;

/** `count` frequencies spaced evenly on a log scale (how our ears hear pitch). */
export function logFrequencies(count: number, min = 20, max = 20000): Float64Array {
  const out = new Float64Array(count);
  const lmin = Math.log(min);
  const step = (Math.log(max) - lmin) / (count - 1);
  for (let i = 0; i < count; i++) out[i] = Math.exp(lmin + i * step);
  return out;
}

/**
 * A steep cut is several filters in a row (`bandStages`): their dB add up.
 * `fs`: the output's sample rate (Equalizer APO designs each filter for it,
 * which bends the curve near the top). Frequencies above half of it can't
 * exist in that stream, so the curve stays flat from there.
 */
export function bandResponse(band: Band, freqs: Float64Array, fs = DISPLAY_SAMPLE_RATE): Float64Array {
  const out = new Float64Array(freqs.length);
  const nyquist = 0.4999 * fs;
  for (const stage of bandStages(band)) {
    const c = coefficients(stage, fs);
    for (let i = 0; i < freqs.length; i++) out[i]! += magnitudeDb(c, Math.min(freqs[i]!, nyquist), fs);
  }
  return out;
}

export function sumResponses(responses: Float64Array[], length: number, offsetDb = 0): Float64Array {
  const out = new Float64Array(length).fill(offsetDb);
  for (const r of responses) for (let i = 0; i < length; i++) out[i]! += r[i]!;
  return out;
}

/**
 * Preamp that brings the loudest point of the curve to `headroom` dB below
 * 0 dB, so a full-scale signal can never clip. Headroom keeps loud songs
 * clear of the limiter Windows puts after every effect (CAudioLimiter, about
 * -0.13 dBFS, measured). Uses a dense grid to catch narrow peaks.
 */
export function autoPreamp(bands: Band[], headroom = 0): number {
  const freqs = logFrequencies(2048);
  const total = sumResponses(bands.map((b) => bandResponse(b, freqs)), freqs.length);
  const peak = Math.max(...total);
  return Math.round((-peak - headroom) * 100) / 100;
}

/** Auto's preamp for a whole EQ. Split: the side that peaks higher sets it, so neither clips. */
export function autoLevel({ bands, split }: EqSettings, headroom = 0): number {
  const level = autoPreamp(bands, headroom);
  return split?.on ? Math.min(level, autoPreamp(split.other, headroom)) : level;
}

/**
 * How our ears weigh frequencies when judging loudness: the K-weighting of
 * ITU-R BS.1770 (the "LUFS" standard), which is just two filters: a rumble
 * cut and a shelf for the head's effect on highs.
 */
const K_WEIGHTING: Band[] = [
  { id: 'k-shelf', enabled: true, type: 'HSC', freq: 1681, gain: 4, q: 0.707 },
  { id: 'k-rumble', enabled: true, type: 'HPQ', freq: 38, gain: 0, q: 0.5 },
];
const LOUDNESS_FREQS = logFrequencies(512);
const LOUDNESS_WEIGHTS = sumResponses(K_WEIGHTING.map((b) => bandResponse(b, LOUDNESS_FREQS)), LOUDNESS_FREQS.length)
  .map((db) => 10 ** (db / 10));
const LOUDNESS_WEIGHT_SUM = LOUDNESS_WEIGHTS.reduce((a, b) => a + b, 0);

/**
 * How much louder or quieter this EQ makes music overall, in dB (bands and
 * preamp together). Used to compare at equal loudness, since louder always
 * sounds "better". An estimate: it assumes pink noise (equal power per
 * octave, close to the average of music, and exactly what a log grid gives),
 * so one song can land about a dB away. Powers are averaged, not dBs: a
 * narrow +12 dB peak adds far less loudness than a broad one.
 */
export function loudnessGain({ preamp, bands }: EqSettings): number {
  const curve = sumResponses(bands.map((b) => bandResponse(b, LOUDNESS_FREQS)), LOUDNESS_FREQS.length, preamp);
  let power = 0;
  for (let i = 0; i < curve.length; i++) power += LOUDNESS_WEIGHTS[i]! * 10 ** (curve[i]! / 10);
  return Math.round(10 * Math.log10(power / LOUDNESS_WEIGHT_SUM) * 100) / 100;
}
