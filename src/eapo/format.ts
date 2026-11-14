/**
 * Reading and writing Equalizer APO's text config format.
 *
 * Design choice: the app owns its own file and writes a simple, predictable
 * subset (one preamp + filter lines for all channels, or one set each for
 * left and right, then each output's balance and delay). Importing is forgiving: anything we can't represent is skipped and
 * reported back as a warning, never silently lost.
 */
import {
  DEFAULT_SHELF_S, FILTER_INFO, LIMITS, balanceCuts, bandStages, clamp, cornerShift, cutQFromLastStage, fileFreq,
  hasQ, hasSlope, highestFilterHz, shelfQ, shelfS, sideBands,
  type Band, type EqSettings, type FilterType, type Slope, type Stereo,
} from './types';

/** Comment line before a steep cut's chain of filters. */
const SLOPE_MARK = '# CorvidEQ slope';
const SLOPE_MARK_RE = /^#\s*CorvidEQ slope (24|48)\b/i;

export interface ParseResult extends EqSettings {
  /** Human-readable notes about lines that were skipped or adjusted. */
  warnings: string[];
}

/** Equalizer APO allows synonyms; map each to the type we store. */
const TYPE_ALIASES: Record<string, FilterType> = {
  PK: 'PK',
  PEQ: 'PK',
  MODAL: 'PK',
  LSC: 'LSC',
  HSC: 'HSC',
  LP: 'LPQ',
  LPQ: 'LPQ',
  HP: 'HPQ',
  HPQ: 'HPQ',
  NO: 'NO',
  BP: 'BP',
  AP: 'AP',
};

/** Equalizer APO's own Q for a line without one, where it isn't our usual Q. */
const Q_IF_MISSING: Partial<Record<FilterType, number>> = { NO: 30, BP: Math.SQRT1_2 };

let idCounter = 0;
export const newId = () => `b${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** Bandwidth in octaves -> Q (standard conversion). */
export const bwToQ = (bw: number) => Math.sqrt(2 ** bw) / (2 ** bw - 1);

const num = (s: string | undefined) => (s === undefined ? NaN : Number(s.replace(',', '.')));

export function parseConfig(text: string): ParseResult {
  const left: Band[] = [];
  const right: Band[] = [];
  const warnings: string[] = [];
  let preampL = 0;
  let preampR = 0;
  // Which channels the next lines apply to; null = ones we can't hold (`Channel: C`).
  let target: 'all' | 'L' | 'R' | null = 'all';

  // A steep cut we wrote (SLOPE_MARK): its slope, then its band while the
  // rest of its chain is folded back into it.
  let markedSlope: Slope | null = null;
  let chain: { band: Band; slope: Slope; left: number } | null = null;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const where = `Line ${index + 1}`;
    const mark = line.match(SLOPE_MARK_RE);
    if (mark) markedSlope = Number(mark[1]) as Slope;
    if (!line || line.startsWith('#')) return;

    const sep = line.indexOf(':');
    if (sep < 0) {
      warnings.push(`${where}: not understood, skipped ("${line}")`);
      return;
    }
    const command = line.slice(0, sep).trim().toLowerCase();
    const body = line.slice(sep + 1).trim();

    if (command === 'channel') {
      const names = body.toUpperCase().split(/\s+/).sort().join(' ');
      target = names === 'ALL' || names === 'L R' ? 'all' : names === 'L' || names === 'R' ? names : null;
      if (!target) warnings.push(`${where}: "${line.slice(0, 60)}" isn't supported yet, its filters were skipped`);
      return;
    }

    if (command === 'preamp') {
      if (!target) return;
      const v = num(body.match(/(-?[\d.,]+)\s*dB/i)?.[1]);
      if (Number.isNaN(v)) {
        warnings.push(`${where}: unreadable preamp, skipped`);
        return;
      }
      // Equalizer APO sums multiple preamps
      if (target !== 'R') preampL += v;
      if (target !== 'L') preampR += v;
      return;
    }

    if (command.startsWith('filter')) {
      if (!target) return;
      const band = parseFilter(body, where, warnings);
      if (!band) return;
      if (chain) {
        // The chain's last filter carries the band's own Q (bandStages).
        if (--chain.left === 0) {
          chain.band.q = clamp(cutQFromLastStage(chain.slope, band.q), LIMITS.q.min, LIMITS.q.max);
          chain = null;
        }
        return;
      }
      if (markedSlope && hasSlope(band.type)) {
        band.slope = markedSlope;
        chain = { band, slope: markedSlope, left: markedSlope / 12 - 1 };
      }
      markedSlope = null;
      if (target !== 'R') left.push(band);
      if (target !== 'L') right.push(band);
      return;
    }

    if (command === 'device' && body.toLowerCase() === 'all') return;

    warnings.push(`${where}: "${line.slice(0, 60)}" isn't supported yet and was skipped`);
  });

  // One Level for both sides: the lower preamp, so neither side gets louder.
  if (preampL !== preampR) warnings.push(`Left and right have different preamps (${preampL} / ${preampR} dB), used the lower one`);
  const preamp = clamp(Math.min(preampL, preampR), LIMITS.preamp.min, LIMITS.preamp.max);
  // Filters for all channels sit in both lists as the same object.
  const same = left.length === right.length && left.every((b, i) => b === right[i]);
  if (same) return { preamp, bands: left, warnings };
  // A side with no filters plays flat, but every EQ has at least one band.
  const flat = (): Band => ({ id: newId(), enabled: true, type: 'PK', freq: 1000, gain: 0, q: FILTER_INFO.PK.defaultQ });
  return {
    preamp,
    bands: left.length > 0 ? left : [flat()],
    split: { on: true, side: 'L', other: right.length > 0 ? right : [flat()], otherPreset: '' },
    warnings,
  };
}

/**
 * Read a preset file of either kind:
 *   - Equalizer APO config text ("Preamp: …", "Filter: ON PK Fc …")
 *   - a JSON preset as other Equalizer APO front-ends save them:
 *     { "preAmp": -2.5, "filters": { "<id>": { "frequency", "gain", "quality", "type" }, … } }
 *     (`filters` may also be an array; `enabled` defaults to on)
 * Anything that can't be represented is skipped and listed in `warnings`.
 */
export function parsePresetFile(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return parseConfig(text);
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { preamp: 0, bands: [], warnings: ['Not a readable preset file (broken JSON)'] };
  }
  const obj = data as { preAmp?: unknown; preamp?: unknown; filters?: unknown };
  const warnings: string[] = [];
  const list = Array.isArray(obj.filters) ? obj.filters
    : obj.filters && typeof obj.filters === 'object' ? Object.values(obj.filters) : [];
  const bands: Band[] = [];
  list.forEach((raw, i) => {
    const f = raw as Record<string, unknown>;
    const type = TYPE_ALIASES[String(f.type ?? 'PK').toUpperCase()];
    const freq = Number(f.frequency ?? f.freq ?? f.fc);
    const gain = Number(f.gain ?? 0);
    const q = Number(f.quality ?? f.q ?? NaN);
    if (!type) return warnings.push(`Filter ${i + 1}: type "${String(f.type)}" isn't supported yet, skipped`);
    if (!Number.isFinite(freq)) return warnings.push(`Filter ${i + 1}: no frequency, skipped`);
    const info = FILTER_INFO[type];
    bands.push({
      id: newId(),
      enabled: f.enabled !== false,
      type,
      freq: clamp(freq, LIMITS.freq.min, LIMITS.freq.max),
      gain: info.hasGain && Number.isFinite(gain) ? clamp(gain, LIMITS.gain.min, LIMITS.gain.max) : 0,
      q: clamp(Number.isFinite(q) ? q : info.defaultQ, LIMITS.q.min, LIMITS.q.max),
    });
  });
  const preamp = Number(obj.preAmp ?? obj.preamp ?? 0);
  return { preamp: clamp(Number.isFinite(preamp) ? preamp : 0, LIMITS.preamp.min, LIMITS.preamp.max), bands, warnings };
}

function parseFilter(body: string, where: string, warnings: string[]): Band | null {
  // e.g. "ON PK Fc 69 Hz Gain -5 dB Q 0.5"
  const m = body.match(/^(ON|OFF)\s+([A-Za-z]+)(.*)$/i);
  if (!m) {
    warnings.push(`${where}: unreadable filter, skipped`);
    return null;
  }
  const [, state, rawType, rest = ''] = m;
  const name = rawType!.toUpperCase();
  const isShelf = /^[LH]SC?$/.test(name);
  const type = TYPE_ALIASES[name];
  if (!type && !isShelf) {
    warnings.push(`${where}: filter type "${rawType}" isn't supported yet, skipped`);
    return null;
  }

  const freq = num(rest.match(/Fc\s+(-?[\d.,]+)\s*Hz/i)?.[1]);
  if (Number.isNaN(freq)) {
    warnings.push(`${where}: filter has no frequency, skipped`);
    return null;
  }
  const gain = num(rest.match(/Gain\s+(-?[\d.,]+)\s*dB/i)?.[1]);
  const q = num(rest.match(/\bQ\s+([\d.,]+)/i)?.[1]);
  const bw = num(rest.match(/BW\s+Oct\s+([\d.,]+)/i)?.[1]);
  const enabled = state!.toUpperCase() === 'ON';

  if (isShelf) {
    const level = Number.isNaN(gain) ? 0 : clamp(gain, LIMITS.gain.min, LIMITS.gain.max);
    const slope = num(rest.match(/^\s*([\d.,]+)\s*dB/i)?.[1]);
    const shape = readShelf(name, freq, level, slope, q);
    return {
      id: newId(),
      enabled,
      gain: level,
      ...shape,
      freq: clamp(shape.freq, LIMITS.freq.min, LIMITS.freq.max),
      q: clamp(shape.q, LIMITS.q.min, LIMITS.q.max),
    };
  }

  const known = type!;
  const info = FILTER_INFO[known];
  const resolvedQ = !Number.isNaN(q) ? q : !Number.isNaN(bw) ? bwToQ(bw) : Q_IF_MISSING[known] ?? info.defaultQ;

  return {
    id: newId(),
    enabled,
    type: known,
    freq: clamp(freq, LIMITS.freq.min, LIMITS.freq.max),
    gain: info.hasGain && !Number.isNaN(gain) ? clamp(gain, LIMITS.gain.min, LIMITS.gain.max) : 0,
    q: clamp(resolvedQ, LIMITS.q.min, LIMITS.q.max),
  };
}

/**
 * Every Equalizer APO shelf is one filter with a Q or a slope, built on its
 * middle or (LS, HS) on its corner. Ours keep the shelf's own name where they
 * can; any other mix becomes a Low / High shelf with the same curve at this
 * gain (its Fc moved to the middle, its slope written as a Q).
 */
function readShelf(name: string, freq: number, gain: number, slope: number, q: number) {
  const stem = name[0] === 'L' ? 'LS' : 'HS';
  const corner = name.length === 2;
  const noQ = FILTER_INFO.LSC.defaultQ;
  if (corner && (slope === 6 || slope === 12)) return { type: `${stem} ${slope}dB` as FilterType, freq, q: noQ };
  if (corner && Number.isNaN(slope) && Number.isNaN(q)) return { type: stem as FilterType, freq, q: noQ };

  const s = !Number.isNaN(slope) ? slope / 12 : Number.isNaN(q) ? DEFAULT_SHELF_S : shelfS(gain, q);
  const shift = corner ? cornerShift(gain, s) : 1;
  return {
    type: (stem === 'LS' ? 'LSC' : 'HSC') as FilterType,
    freq: stem === 'LS' ? freq * shift : freq / shift,
    q: Number.isNaN(slope) && !Number.isNaN(q) ? q : shelfQ(gain, s),
  };
}

/** Trim float noise: 1000.0000001 -> "1000", 0.70710678 -> "0.707". */
const fmt = (v: number, decimals: number) => String(Number(v.toFixed(decimals)));

const HEADER = '# Written by CorvidEQ. Edits made here will be overwritten.';

/** Filter lines of one EQ, or of one side of it. */
function filterLines(bands: Band[], top: number): string[] {
  const lines: string[] = [];
  let n = 0;
  for (const band of bands) {
    const stages = bandStages(band);
    // Marks a steep cut's chain, so importing the file gives back ONE band.
    if (stages.length > 1) lines.push(`${SLOPE_MARK} ${band.slope} dB/oct: the next ${stages.length} filters are one cut`);
    for (const b of stages) {
      const parts = [`Filter${n++}: ${b.enabled ? 'ON' : 'OFF'} ${b.type} Fc ${fmt(fileFreq(b, top), 1)} Hz`];
      if (FILTER_INFO[b.type].hasGain) parts.push(`Gain ${fmt(b.gain, 2)} dB`);
      if (hasQ(b.type)) parts.push(`Q ${fmt(b.q, 3)}`);
      lines.push(parts.join(' '));
    }
  }
  return lines;
}

/**
 * Preamp and filter lines of one EQ. A `Channel:` line picks which channels
 * the lines after it apply to, so a split EQ is simply two sets. It ends on
 * `Channel: all` to leave the selection as it found it. `rate`: the device's
 * sample rate, when known, so no filter lands above its Nyquist.
 */
function eqLines(eq: EqSettings, rate?: number): string[] {
  const top = rate ? Math.min(LIMITS.freq.max, highestFilterHz(rate)) : LIMITS.freq.max;
  const preamp = `Preamp: ${fmt(eq.preamp, 2)} dB`;
  if (!eq.split?.on) return ['Channel: all', preamp, ...filterLines(eq.bands, top)];
  return [
    'Channel: L', preamp, ...filterLines(sideBands(eq, 'L'), top),
    'Channel: R', preamp, ...filterLines(sideBands(eq, 'R'), top),
    'Channel: all',
  ];
}

// Windows line endings, like the files Equalizer APO ships.
const joinLines = (lines: string[]) => lines.join('\r\n') + '\r\n';

/** One output's balance and delay, by its endpoint GUID (name only for the comment). */
export interface StereoSection {
  guid: string;
  name: string;
  stereo: Stereo;
}

/** The balance knob's far end: that side is silent, not just quiet. */
const SILENT_DB = -200;

/**
 * Comes after the EQ and adds to it (Equalizer APO sums every preamp a channel
 * gets), so the EQ's own sections stay the same whatever is set here. Written
 * in ms, as the configuration reference recommends: the same delay at any
 * sample rate.
 */
function stereoLines({ guid, name, stereo }: StereoSection): string[] {
  const { left, right } = balanceCuts(stereo.balance);
  const lines = ['', `# ${name}: balance and delay`, `Device: ${guid}`];
  for (const [channel, cut, delay] of [['L', left, stereo.delayL], ['R', right, stereo.delayR]] as const) {
    if (cut === 0 && delay === 0) continue;
    lines.push(`Channel: ${channel}`);
    if (cut !== 0) lines.push(`Preamp: ${fmt(cut <= LIMITS.balance.min ? SILENT_DB : cut, 2)} dB`);
    if (delay !== 0) lines.push(`Delay: ${fmt(delay, 2)} ms`);
  }
  return lines;
}

/** One EQ as a file of its own, for any output (Save file…). */
export function serializeConfig(settings: EqSettings): string {
  return joinLines([HEADER, 'Device: all', ...eqLines(settings)]);
}

/** One EQ for a group of outputs, by their endpoint GUIDs (names only for the comment). */
export interface OutputSection {
  guids: string[];
  names: string[];
  settings: EqSettings;
  /** Its sample rate, when known. */
  rate?: number;
}

/**
 * One EQ per output. Equalizer APO's `Device:` matches words against each
 * output's "name, connection name, GUID", and ignores everything after it
 * on outputs that don't match, until the next `Device:` line. A GUID never
 * changes when the output is renamed, so it's the safest word to match;
 * several outputs are separated by ";".
 */
export function serializeOutputs(sections: OutputSection[], stereo: StereoSection[] = []): string {
  const lines = [HEADER, '# One EQ per output (Device: lines match each output\'s GUID).'];
  for (const s of sections) {
    if (s.guids.length === 0) continue;
    lines.push('', `# ${s.names.join(', ')}`, `Device: ${s.guids.join(';')}`, ...eqLines(s.settings, s.rate));
  }
  return joinLines([...lines, ...stereo.flatMap(stereoLines)]);
}
