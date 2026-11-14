/**
 * What goes into a file has to come back out the same, or presets and imports
 * quietly change people's sound. Run with `npm test`.
 */
import { describe, expect, it } from 'vitest';
import { coefficients, magnitudeDb } from '../dsp/biquad';
import { parseConfig, parsePresetFile, serializeConfig, serializeOutputs } from './format';
import {
  FILTER_INFO, FILTER_TYPES, MORE_TYPES, hasQ, shelfQ, shelfS,
  type Band, type EqSettings, type FilterType, type Slope,
} from './types';

const band = (type: FilterType, more: Partial<Band> = {}): Band =>
  ({ id: 'x', enabled: true, type, freq: 1000, gain: 6, q: 2, ...more });

/** Everything about a band that the file holds; a shape without gain or Q has none to keep. */
const heard = (b: Band) => ({
  enabled: b.enabled,
  type: b.type,
  freq: b.freq,
  gain: FILTER_INFO[b.type].hasGain ? b.gain : 0,
  q: hasQ(b.type) ? b.q : null,
  slope: b.slope ?? 12,
});

const roundTrip = (eq: EqSettings) => parseConfig(serializeConfig(eq));

/** The Fc of every filter line in a file. */
const fileFreqs = (text: string) => [...text.matchAll(/Fc ([\d.]+) Hz/g)].map((m) => Number(m[1]));

describe('writing a file and reading it back', () => {
  it.each([...FILTER_TYPES, ...MORE_TYPES])('keeps a %s band', (type) => {
    const b = band(type);
    const { bands, warnings } = roundTrip({ preamp: 0, bands: [b] });
    expect(warnings).toEqual([]);
    expect(bands.map(heard)).toEqual([heard(b)]);
  });

  it('keeps the preamp, the order and switched-off bands', () => {
    const bands = [band('PK', { freq: 60, gain: -3.5 }), band('HSC', { freq: 8000, enabled: false }), band('NO', { freq: 50, q: 12 })];
    const back = roundTrip({ preamp: -4.25, bands });
    expect(back.preamp).toBe(-4.25);
    expect(back.bands.map(heard)).toEqual(bands.map(heard));
    expect(back.split).toBeUndefined();
  });

  it.each<[FilterType, Slope]>([['HPQ', 24], ['HPQ', 48], ['LPQ', 24], ['LPQ', 48]])(
    'folds a %s %i dB chain back into one band',
    (type, slope) => {
      const b = band(type, { slope, q: 1 });
      const after = band('PK', { freq: 300 });
      const back = roundTrip({ preamp: 0, bands: [b, after] });
      expect(back.bands).toHaveLength(2);
      expect(back.bands[0]).toMatchObject({ type, slope });
      expect(back.bands[0]!.q).toBeCloseTo(1, 2);
      expect(heard(back.bands[1]!)).toEqual(heard(after));
    },
  );

  it('keeps both sides of a split EQ', () => {
    const left = [band('PK', { freq: 100 })];
    const right = [band('LSC', { freq: 80 }), band('PK', { freq: 4000, gain: -2 })];
    const back = roundTrip({ preamp: -2, bands: left, split: { on: true, side: 'L', other: right, otherPreset: '' } });
    expect(back.preamp).toBe(-2);
    expect(back.bands.map(heard)).toEqual(left.map(heard));
    expect(back.split?.on).toBe(true);
    expect(back.split?.other.map(heard)).toEqual(right.map(heard));
  });

  it('writes the same sides whichever one is on screen', () => {
    const left = [band('PK', { freq: 100 })];
    const right = [band('PK', { freq: 200 })];
    const split = (side: 'L' | 'R', other: Band[]) => ({ on: true, side, other, otherPreset: '' });
    const fromLeft = serializeConfig({ preamp: 0, bands: left, split: split('L', right) });
    const fromRight = serializeConfig({ preamp: 0, bands: right, split: split('R', left) });
    expect(fromRight).toBe(fromLeft);
  });

  it('plays one EQ on both sides after unsplitting', () => {
    const bands = [band('PK')];
    const text = serializeConfig({ preamp: 0, bands, split: { on: false, side: 'L', other: [band('NO')], otherPreset: '' } });
    expect(text).not.toContain('Channel: L');
    expect(text).not.toContain(' NO ');
  });
});

describe('importing Equalizer APO text', () => {
  it('reads its other names, comma decimals, CRLF and summed preamps', () => {
    const { preamp, bands, warnings } = parseConfig(
      'Preamp: -3 dB\r\nPreamp: -1,5 dB\r\nFilter 1: ON PEQ Fc 1000 Hz Gain 2,5 dB Q 1,41\r\nFilter 2: OFF Modal Fc 50 Hz Gain -4 dB Q 8\r\n',
    );
    expect(warnings).toEqual([]);
    expect(preamp).toBe(-4.5);
    expect(bands).toMatchObject([
      { type: 'PK', freq: 1000, gain: 2.5, q: 1.41, enabled: true },
      { type: 'PK', freq: 50, gain: -4, q: 8, enabled: false },
    ]);
  });

  it('turns a bandwidth in octaves into a Q', () => {
    const { bands } = parseConfig('Filter: ON PK Fc 1000 Hz Gain 3 dB BW Oct 1');
    expect(bands[0]!.q).toBeCloseTo(Math.SQRT2, 5);
  });

  it("uses Equalizer APO's own values for a line without Q", () => {
    const { bands } = parseConfig([
      'Filter: ON NO Fc 1000 Hz',
      'Filter: ON BP Fc 1000 Hz',
      'Filter: ON LSC Fc 100 Hz Gain 6 dB',
    ].join('\n'));
    expect(bands[0]!.q).toBe(30);
    expect(bands[1]!.q).toBeCloseTo(Math.SQRT1_2, 5);
    expect(bands[2]!.q).toBeCloseTo(shelfQ(6, 0.9), 5);
  });

  it('keeps the names of the shelves we have', () => {
    const { bands } = parseConfig([
      'Filter: ON LS 6dB Fc 100 Hz Gain 3 dB',
      'Filter: ON LS Fc 100 Hz Gain 3 dB',
      'Filter: ON HS 12dB Fc 5000 Hz Gain 3 dB',
    ].join('\n'));
    expect(bands.map((b) => b.type)).toEqual(['LS 6dB', 'LS', 'HS 12dB']);
  });

  it('makes any other shelf a Low / High shelf with the same curve', () => {
    const rate = 48000;
    const curve = (b: Band) => [30, 100, 300, 1000, 5000].map((hz) => magnitudeDb(coefficients(b, rate), hz, rate));
    // 9 dB per octave is S 0.75: Fc moves from the corner to the shelf's middle.
    const { bands } = parseConfig('Filter: ON LS 9dB Fc 200 Hz Gain 6 dB\nFilter: ON LS Fc 200 Hz Gain 6 dB Q 0.8');
    expect(bands.map((b) => b.type)).toEqual(['LSC', 'LSC']);
    expect(bands[0]!.freq).toBeCloseTo(200 * 10 ** (6 / 80 / 0.75), 3);
    expect(bands[0]!.q).toBeCloseTo(shelfQ(6, 0.75), 5);
    // 12 dB per octave is S 1, which we hold by name: same line, moved to its middle.
    const named = parseConfig('Filter: ON HS 12dB Fc 2000 Hz Gain -6 dB').bands[0]!;
    const moved = parseConfig(`Filter: ON HSC 12dB Fc ${2000 / 10 ** (6 / 80)} Hz Gain -6 dB`).bands[0]!;
    expect(moved.type).toBe('HSC');
    curve(named).forEach((db, i) => expect(curve(moved)[i]).toBeCloseTo(db, 3));
  });

  it('reads left and right sections as a split EQ, with the lower preamp', () => {
    const { preamp, bands, split, warnings } = parseConfig([
      'Channel: L', 'Preamp: -2 dB', 'Filter: ON PK Fc 100 Hz Gain 1 dB Q 1',
      'Channel: R', 'Preamp: -5 dB', 'Filter: ON PK Fc 200 Hz Gain 1 dB Q 1',
    ].join('\n'));
    expect(preamp).toBe(-5);
    expect(bands[0]!.freq).toBe(100);
    expect(split?.other[0]!.freq).toBe(200);
    expect(warnings).toHaveLength(1);
  });

  it('holds values inside the limits', () => {
    const { preamp, bands } = parseConfig('Preamp: -90 dB\nFilter: ON PK Fc 40000 Hz Gain 50 dB Q 100');
    expect(preamp).toBe(-24);
    expect(bands[0]).toMatchObject({ freq: 20000, gain: 24, q: 30 });
  });

  it.each([
    ['IIR', 'Filter: ON IIR Order 2 Coefficients 1 0 0 1 0 0'],
    ['GraphicEQ', 'GraphicEQ: 25 0; 40 3; 63 -2'],
    ['another channel', 'Channel: C\nFilter: ON PK Fc 100 Hz Gain 1 dB Q 1'],
    ['a broken line', 'nonsense'],
    ['a filter with no frequency', 'Filter: ON PK Gain 3 dB'],
  ])('says so when it skips %s', (_, text) => {
    const { bands, warnings } = parseConfig(text);
    expect(bands).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe('importing JSON presets', () => {
  const preset = {
    preAmp: -2.5,
    filters: {
      a: { frequency: 100, gain: 3, quality: 1.5, type: 'PK' },
      b: { frequency: 8000, gain: -2, quality: 0.7, type: 'HSC', enabled: false },
    },
  };

  it('reads filters kept as an object', () => {
    const { preamp, bands, warnings } = parsePresetFile(JSON.stringify(preset));
    expect(warnings).toEqual([]);
    expect(preamp).toBe(-2.5);
    expect(bands).toMatchObject([
      { type: 'PK', freq: 100, gain: 3, q: 1.5, enabled: true },
      { type: 'HSC', freq: 8000, gain: -2, q: 0.7, enabled: false },
    ]);
  });

  it('reads filters kept as a list', () => {
    const { bands } = parsePresetFile(JSON.stringify({ ...preset, filters: Object.values(preset.filters) }));
    expect(bands).toHaveLength(2);
  });

  it('says so when it skips a filter', () => {
    const { bands, warnings } = parsePresetFile(JSON.stringify({ filters: [{ frequency: 100, type: 'XX' }, { type: 'PK' }] }));
    expect(bands).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it('reports broken JSON', () => {
    const { bands, warnings } = parsePresetFile('{ "filters": ');
    expect(bands).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('reads Equalizer APO text too', () => {
    expect(parsePresetFile('Filter: ON PK Fc 100 Hz Gain 1 dB Q 1').bands).toHaveLength(1);
  });
});

describe('the file CorvidEQ writes for Equalizer APO', () => {
  const eq = (bands: Band[]): EqSettings => ({ preamp: 0, bands });

  it('gives each output its own section, by GUID', () => {
    const text = serializeOutputs([
      { guids: ['{aaa}'], names: ['Speakers'], settings: eq([band('PK', { freq: 100 })]) },
      { guids: ['{bbb}', '{ccc}'], names: ['Headphones', 'Mic'], settings: eq([band('PK', { freq: 200 })]) },
      { guids: [], names: [], settings: eq([band('PK', { freq: 300 })]) },
    ]);
    expect(text).toContain('Device: {aaa}\r\nChannel: all');
    expect(text).toContain('Device: {bbb};{ccc}\r\nChannel: all');
    expect(fileFreqs(text)).toEqual([100, 200]);
  });

  it('uses Windows line endings throughout', () => {
    const text = serializeConfig(eq([band('PK')]));
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('keeps every filter under the device\'s Nyquist', () => {
    const rate = 16000;
    const text = serializeOutputs([{
      guids: ['{aaa}'],
      names: ['Headset'],
      rate,
      settings: eq([band('PK', { freq: 12000 }), band('NO', { freq: 19000 }), band('HPQ', { freq: 15000, slope: 48 })]),
    }]);
    const freqs = fileFreqs(text);
    expect(freqs).toHaveLength(6);
    for (const hz of freqs) expect(hz).toBeLessThan(rate / 2);
  });

  it('keeps a low corner shelf\'s middle under 20 kHz on any device', () => {
    const b = band('LS 6dB', { freq: 20000, gain: 24 });
    const hz = fileFreqs(serializeConfig(eq([b])))[0]!;
    expect(hz * 10 ** (24 / 80 / 0.5)).toBeLessThanOrEqual(20001);
  });

  it('leaves a band alone when the device has room', () => {
    const text = serializeOutputs([{ guids: ['{a}'], names: ['A'], rate: 96000, settings: eq([band('PK', { freq: 19000 })]) }]);
    expect(fileFreqs(text)).toEqual([19000]);
  });

  it('writes balance and delay after the EQ, for that output only', () => {
    const text = serializeOutputs(
      [{ guids: ['{aaa}'], names: ['Speakers'], settings: eq([band('PK')]) }],
      [{ guid: '{aaa}', name: 'Speakers', stereo: { balance: 3, delayL: 0, delayR: 1.5 } }],
    );
    const tail = text.slice(text.indexOf('balance and delay'));
    expect(tail).toContain('Device: {aaa}\r\nChannel: L\r\nPreamp: -3 dB\r\nChannel: R\r\nDelay: 1.5 ms');
    expect(text.indexOf('Filter0')).toBeLessThan(text.indexOf('Delay:'));
  });

  it('makes the far end of the balance silent', () => {
    const text = serializeOutputs([], [{ guid: '{a}', name: 'A', stereo: { balance: -60, delayL: 0, delayR: 0 } }]);
    expect(text).toContain('Channel: R\r\nPreamp: -200 dB');
  });
});

describe('a shelf\'s Q and slope', () => {
  it.each([[6, 0.5], [-6, 0.5], [12, 0.9], [-24, 1]])('turn into each other at %i dB, S %f', (gain, s) => {
    expect(shelfS(gain, shelfQ(gain, s))).toBeCloseTo(s, 6);
  });
});
