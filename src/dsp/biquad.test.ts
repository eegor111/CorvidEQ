/**
 * The curves must match what Equalizer APO plays, and a filter it can't run
 * (unstable: noise instead of sound) must never be built. Run with `npm test`.
 */
import { describe, expect, it } from 'vitest';
import { FILTER_INFO, FILTER_TYPES, MORE_TYPES, fileFreq, highestFilterHz, type Band, type FilterType } from '../eapo/types';
import { coefficients, magnitudeDb } from './biquad';

const RATE = 48000;
const ALL_TYPES: FilterType[] = [...FILTER_TYPES, ...MORE_TYPES];

const band = (type: FilterType, more: Partial<Band> = {}): Band =>
  ({ id: 'x', enabled: true, type, freq: 1000, gain: 6, q: 1, ...more });

const db = (b: Band, hz: number) => magnitudeDb(coefficients(b, RATE), hz, RATE);

describe('curves', () => {
  it('a bell reaches its gain at its frequency', () => {
    expect(db(band('PK', { gain: 7.5 }), 1000)).toBeCloseTo(7.5, 6);
    expect(db(band('PK', { gain: -7.5 }), 1000)).toBeCloseTo(-7.5, 6);
  });

  it('a bell at 0 dB does nothing', () => {
    expect(db(band('PK', { gain: 0 }), 1000)).toBeCloseTo(0, 6);
  });

  it.each(['LSC', 'LS 6dB', 'LS', 'LS 12dB'] as const)('%s lifts the lows and leaves the highs', (type) => {
    const b = band(type, { freq: 300 });
    expect(db(b, 20)).toBeCloseTo(6, 0);
    expect(db(b, 18000)).toBeCloseTo(0, 1);
  });

  it.each(['HSC', 'HS 6dB', 'HS', 'HS 12dB'] as const)('%s lifts the highs and leaves the lows', (type) => {
    const b = band(type, { freq: 2000 });
    expect(db(b, 20)).toBeCloseTo(0, 1);
    expect(db(b, 18000)).toBeCloseTo(6, 0);
  });

  it('a center shelf is at half its gain at its frequency', () => {
    expect(db(band('LSC', { freq: 300 }), 300)).toBeCloseTo(3, 6);
    expect(db(band('HSC', { freq: 300 }), 300)).toBeCloseTo(3, 6);
  });

  it('cuts are 3 dB down at the corner, at Butterworth Q', () => {
    expect(db(band('HPQ', { q: Math.SQRT1_2 }), 1000)).toBeCloseTo(-3.01, 1);
    expect(db(band('LPQ', { q: Math.SQRT1_2 }), 1000)).toBeCloseTo(-3.01, 1);
  });

  it('a band-pass peaks at 0 dB', () => {
    expect(db(band('BP'), 1000)).toBeCloseTo(0, 6);
    expect(db(band('BP'), 100)).toBeLessThan(-10);
  });

  it('a notch removes its frequency', () => {
    expect(db(band('NO', { q: 30 }), 1000)).toBeLessThan(-60);
    expect(db(band('NO', { q: 30 }), 2000)).toBeCloseTo(0, 1);
  });

  it('an all-pass is flat', () => {
    for (const hz of [20, 200, 1000, 5000, 20000]) expect(db(band('AP'), hz)).toBeCloseTo(0, 6);
  });
});

describe('stability', () => {
  /** A biquad's poles are inside the unit circle exactly when this holds. */
  const stable = ({ a1, a2 }: { a1: number; a2: number }) => Math.abs(a2) < 1 && Math.abs(a1) < 1 + a2;

  const gains = (type: FilterType) => (FILTER_INFO[type].hasGain ? [-24, -6, 6, 24] : [0]);

  it.each([16000, 44100, 48000, 96000])('every shape at the top of the range is stable at %i Hz', (rate) => {
    for (const type of ALL_TYPES) {
      for (const gain of gains(type)) {
        for (const q of [0.1, 0.707, 30]) {
          const wanted = band(type, { freq: 20000, gain, q });
          // As the file has it: Equalizer APO builds what's written there.
          const written = { ...wanted, freq: fileFreq(wanted, Math.min(20000, highestFilterHz(rate))) };
          expect(stable(coefficients(written, rate)), `${type} ${gain} dB Q ${q}`).toBe(true);
        }
      }
    }
  });
});
