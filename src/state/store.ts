/**
 * App state (Zustand): the single source of truth.
 *
 * - `settings` (preamp + bands) is the document. Everything else is UI state.
 * - Between MIN_BANDS and MAX_BANDS bands. Adding one slots it into the
 *   widest empty stretch of the spectrum; removing takes the selected band
 *   (or the last one). Band numbers are their position in the list.
 * - Undo/redo stores whole snapshots of `settings`. They're tiny, so this is
 *   simpler and safer than recording individual operations.
 * - A gesture is ONE undo step: call `checkpoint()` when it starts, then apply
 *   many live updates.
 * - Non-React code (the file writer, eq-file.ts) follows the store
 *   with `useEq.subscribe`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  FILTER_INFO, FILTER_TYPES, LIMITS, clamp, hasQ, hasSlope, type Band, type EqSettings, type FilterType, type Slope,
} from '../eapo/types';
import { newId } from '../eapo/format';
import { autoLevel } from '../dsp/response';
import { PARAMS, paramDef, type BandParam, type Direction, type ViewDb } from './params';

const HISTORY_LIMIT = 200;
/**
 * How many bands an EQ can have. The Default preset has 7. Downloaded
 * headphone corrections mostly use 10, some up to 20. Past 10 the band panel
 * splits into two rows (BandPanel.tsx).
 */
export const MIN_BANDS = 1;
export const MAX_BANDS = 20;

/** Pseudo band id used when the Level (preamp) control is focused. */
export const PREAMP_ID = 'preamp';

/** How the analyzer is drawn behind the curve. */
/**
 * split = heat in one half of the graph, the line or the bars (whichever was
 * used last, `levelView`) in the other (see `splitSwapped`).
 */
export type SpectrumDisplay = 'off' | 'line' | 'bars' | 'heat' | 'split';
/** The two views that show level as height; split view shows one of them. */
export type LevelView = 'line' | 'bars';
/**
 * Which analyzer lines while our EQ is applied: before it (pre), after it
 * (post), or both on top of each other (overlay, with the boost/cut bands).
 */
export type SpectrumLines = 'pre' | 'post' | 'overlay';
/** The same for the heat view. No overlay: a stripe has one color per frequency. */
export type HeatLines = Exclude<SpectrumLines, 'overlay'>;
/** The heat view's colors: red to yellow, or blue to white. A look, nothing to do with Pre / Post. */
export type HeatPalette = 'fire' | 'ice';

/** Flat starting point: shelves at the edges, bells spread across the range. */
const DEFAULT_BANDS: Omit<Band, 'id'>[] = [
  { enabled: true, type: 'LSC', freq: 60, gain: 0, q: 0.707 },
  { enabled: true, type: 'PK', freq: 150, gain: 0, q: 1 },
  { enabled: true, type: 'PK', freq: 400, gain: 0, q: 1 },
  { enabled: true, type: 'PK', freq: 1000, gain: 0, q: 1 },
  { enabled: true, type: 'PK', freq: 2500, gain: 0, q: 1 },
  { enabled: true, type: 'PK', freq: 6000, gain: 0, q: 1 },
  { enabled: true, type: 'HSC', freq: 12000, gain: 0, q: 0.707 },
];

/**
 * "Home" frequency of band `index` out of `count` (what double-click resets
 * Freq to). 7 bands: the classic layout above. Other counts: spread evenly
 * (on the log scale our ears use) from 60 Hz to 12 kHz.
 */
export function homeFreq(index: number, count: number): number {
  if (count === DEFAULT_BANDS.length) return DEFAULT_BANDS[index]!.freq;
  if (count === 1) return 1000;
  return Math.round(60 * (12000 / 60) ** (index / (count - 1)));
}

export const flatSettings = (): EqSettings => ({
  preamp: 0,
  bands: DEFAULT_BANDS.map((b) => ({ ...b, id: newId() })),
});

/**
 * Heat view sensitivity curve: level (0…1) → brightness (0…1).
 * A power curve, level^g. At the middle setting g = 1 (linear). Turning down
 * raises g (up to 4): quiet levels sink toward 0, so only strong parts stay
 * bright. Turning up lowers g (down to 1/4): quiet levels are lifted.
 */
export const heatCurve = (level: number, sensitivity: number) => level ** (4 ** ((0.5 - sensitivity) * 2));

export type BandPatch = Partial<Omit<Band, 'id'>>;

export type AbSlotName = 'A' | 'B';
/** The A/B slot not in the editor, with everything needed to bring it back. */
export interface AbSlot {
  settings: EqSettings;
  autoGain: boolean;
  past: EqSettings[];
  future: EqSettings[];
  /** Its preset name (presets.ts keeps the name; the store only carries it). */
  preset: string;
}

interface EqStore {
  settings: EqSettings;
  /** Band whose control is hovered/dragged anywhere in the UI (drives the highlight). */
  focusId: string | null;
  /** Band picked by clicking its node or one of its controls: its values show on the graph. */
  selectedId: string | null;
  /** Band whose node is hovered or dragged on the graph: its fader lights up as if hovered. */
  graphHotId: string | null;
  /**
   * Band you're listening to alone (right-click its fader), or null. A listening
   * aid, not an edit: no undo step, and presets never see it. Saved, though:
   * corvid-eq.txt keeps playing the solo after the app closes, so the app
   * reopens still soloed. See appliedSettings().
   */
  soloId: string | null;
  past: EqSettings[];
  future: EqSettings[];
  /** Keep preamp at the "never clip" value automatically. */
  autoGain: boolean;
  /**
   * How far below 0 dB Auto puts the curve's peak (dB). A listening setting
   * for every EQ, not an edit: no undo step. See autoPreamp().
   */
  headroom: number;
  display: SpectrumDisplay;
  /** Line or Bars, whichever was picked last: the one split view shows. */
  levelView: LevelView;
  /** Split view: false = line in the upper half, heat below; true = the other way round. */
  splitSwapped: boolean;
  /** Output level meter on/off (click the meter). */
  meterOn: boolean;
  /** Analyzer peak-hold line on/off. */
  peakHold: boolean;
  lines: SpectrumLines;
  /** Its own setting: split view can show an overlaid line above post heat. */
  heatLines: HeatLines;
  heatPalette: HeatPalette;
  /** The dashed "what you hear" curve (shape + preamp) on/off. */
  showHeard: boolean;
  /**
   * Heat view sensitivity, 0…1 (0.5 = linear). Lower hides quiet sound so only
   * the strong parts glow; higher brings quiet sound up. See heatCurve().
   */
  heatSensitivity: number;
  /** Graph zoom: ±12 or ±24 dB (click the dB scale to switch). */
  viewDb: ViewDb;
  /**
   * A/B: two EQs to flip between instantly. The one in the editor is
   * `abSlot`; the other waits in `abOther` (null until B is first opened, as
   * a copy of A). Each keeps its own undo history. A listening aid: not
   * saved, and cleared when another output's EQ comes in (replace()).
   */
  abSlot: AbSlotName;
  abOther: AbSlot | null;

  // History
  checkpoint(): void;
  undo(): void;
  redo(): void;
  /** Replace the whole EQ (loading a preset): one undo step. */
  load(settings: EqSettings, autoGain: boolean): void;
  /**
   * Put a different EQ in the editor (another output's, see output-eqs.ts).
   * Not an edit: no undo step, and the history starts over, since undoing
   * into another output's EQ would make no sense.
   */
  replace(settings: EqSettings, autoGain: boolean): void;
  /**
   * Flip to the other A/B slot. `preset` is the name of the one leaving the
   * editor; returns the name of the one coming in. See ab.ts.
   */
  swapAb(preset: string): string;
  /**
   * Split into a left and a right EQ, or back to one (one undo step).
   * Splitting the first time: R starts as a copy, so nothing you hear changes.
   * Unsplitting: the side on screen plays on both, the other is kept for
   * later. `preset` is the name of the EQ in the editor.
   */
  setSplit(on: boolean, preset: string): void;
  /**
   * Show the other side of a split EQ. `preset` is the name of the side
   * leaving the screen. Not an edit: no undo step (undoing an edit made on
   * the other side goes back to that side, so you see what changed).
   */
  flipSide(preset: string): void;

  // UI
  focus(id: string | null): void;
  select(id: string | null): void;
  setGraphHot(id: string | null): void;
  /** Solo this band, or unsolo it if it's the one soloed. */
  toggleSolo(id: string): void;
  setDisplay(display: SpectrumDisplay): void;
  /** Split view: swap the line and heat halves. */
  swapSplit(): void;
  setMeterOn(on: boolean): void;
  setPeakHold(on: boolean): void;
  setLines(lines: SpectrumLines): void;
  setHeatLines(heatLines: HeatLines): void;
  setHeatPalette(heatPalette: HeatPalette): void;
  setShowHeard(on: boolean): void;
  setHeatSensitivity(norm: number): void;
  toggleViewDb(): void;

  // Bands
  /** Add a band in the widest gap of the spectrum (up to MAX_BANDS) and select it. */
  addBand(): void;
  /**
   * Move a band one place left (-1) or right (+1) (fader menu): one undo
   * step. Its number and color follow the position, its sound doesn't change.
   */
  moveBand(id: string, dir: Direction): void;
  /** Gain 0, home frequency, the shape's default Q (fader menu): one undo step. */
  resetBand(id: string): void;
  /** Gain 0 and home frequency, Q kept (double-click a node): one undo step. */
  resetGainFreq(id: string): void;
  /** Set how many bands there are (typed into the band counter): one undo step. */
  /** `undoStep: false` when the caller already made one (a wheel burst). */
  setBandCount(count: number, undoStep?: boolean): void;
  /** Remove a band (default: the selected one, else the last); never below MIN_BANDS. */
  removeBand(id?: string): void;
  updateBand(id: string, patch: BandPatch): void;
  /** One wheel notch / key press on a parameter (see params.ts). */
  stepParam(id: string, key: BandParam, dir: Direction, fine: boolean): void;
  /** Set a parameter from a control position (0…1). */
  setParamNorm(id: string, key: BandParam, norm: number): void;
  /** Back to the band's default for that parameter. */
  resetParam(id: string, key: BandParam): void;
  /** Set an exact value (typed into the readout): one undo step of its own. */
  setParam(id: string, key: BandParam, value: number): void;
  /** Change filter shape; Q goes back to the shape's natural default. */
  setType(id: string, type: FilterType): void;
  /** Cuts only: 12 / 24 / 48 dB per octave. One undo step. */
  setSlope(id: string, slope: Slope): void;
  cycleType(id: string, dir: Direction): void;

  // Level
  setPreamp(db: number): void;
  setAutoGain(on: boolean): void;
  setHeadroom(db: number): void;
}

/** Auto's headroom choices (Level menu); the default leaves loud songs clear of Windows' limiter. */
export const HEADROOM_CHOICES = [0, 1, 3] as const;
const DEFAULT_HEADROOM = 1;

/**
 * A new bell in the widest gap of the spectrum, slotted in by frequency so
 * band numbers still read left to right.
 */
function withNewBand(bands: Band[]): { bands: Band[]; band: Band } {
  const freqs = bands.map((b) => b.freq).sort((a, b) => a - b);
  // Widest gap on the log scale between neighbouring bands. The 20 Hz /
  // 20 kHz edges only count with a single band: otherwise new bands
  // would keep landing in the far bass, outside the outer shelves.
  const edges = freqs.length > 1 ? freqs : [LIMITS.freq.min, ...freqs, LIMITS.freq.max];
  let best = 0;
  for (let i = 1; i < edges.length - 1; i++) {
    if (edges[i + 1]! / edges[i]! > edges[best + 1]! / edges[best]!) best = i;
  }
  const freq = Math.round(Math.sqrt(edges[best]! * edges[best + 1]!));
  const band: Band = { id: newId(), enabled: true, type: 'PK', freq, gain: 0, q: FILTER_INFO.PK.defaultQ };
  const at = bands.filter((b) => b.freq < freq).length;
  return { bands: [...bands.slice(0, at), band, ...bands.slice(at)], band };
}

/** Clamp a patch to legal values so no caller can create an invalid band. */
function sanitize(patch: BandPatch): BandPatch {
  const out = { ...patch };
  if (out.freq !== undefined) out.freq = clamp(out.freq, LIMITS.freq.min, LIMITS.freq.max);
  if (out.gain !== undefined) out.gain = clamp(out.gain, LIMITS.gain.min, LIMITS.gain.max);
  if (out.q !== undefined) out.q = clamp(out.q, LIMITS.q.min, LIMITS.q.max);
  // A shape without gain (cuts, notch): reset gain so the file stays tidy.
  if (out.type && !FILTER_INFO[out.type].hasGain) out.gain = 0;
  // Only cuts have a slope; any other shape drops it.
  if (out.type && !hasSlope(out.type)) out.slope = undefined;
  return out;
}

/** Re-derive the preamp after any band change, when auto gain is on. */
const withAutoGain = (s: EqSettings, on: boolean, headroom: number): EqSettings =>
  (on ? { ...s, preamp: autoLevel(s, headroom) } : s);

/**
 * The EQ as it's actually applied (corvid-eq.txt, the graph's
 * curve). With a band soloed, every other band is off and the soloed one on,
 * so you hear just that band; Auto re-levels for it, so a soloed boost doesn't
 * clip. `settings` itself never changes, so undo, presets and saving never see a solo.
 */
export function appliedSettings({ settings, soloId, autoGain, headroom }: Pick<EqStore, 'settings' | 'soloId' | 'autoGain' | 'headroom'>): EqSettings {
  if (!soloId || !settings.bands.some((b) => b.id === soloId)) return settings;
  const bands = settings.bands.map((b) => ({ ...b, enabled: b.id === soloId }));
  const { split } = settings;
  // Split: the other side plays flat, so the soloed band is all you hear.
  const other = split?.on ? { split: { ...split, other: split.other.map((b) => ({ ...b, enabled: false })) } } : {};
  return withAutoGain({ ...settings, bands, ...other }, autoGain, headroom);
}

/**
 * An EQ kept outside the editor (another output's, the other A/B slot) as it
 * plays now: its preamp was derived when it was last edited, so Auto is
 * re-applied in case the headroom changed since.
 */
export function autoLevelled(settings: EqSettings, autoGain: boolean): EqSettings {
  return withAutoGain(settings, autoGain, useEq.getState().headroom);
}

export const useEq = create<EqStore>()(
  persist(
    (set, get) => {
      const band = (id: string) => get().settings.bands.find((b) => b.id === id);

      return {
        settings: flatSettings(),
        focusId: null,
        selectedId: null,
        graphHotId: null,
        soloId: null,
        past: [],
        future: [],
        autoGain: true,
        headroom: DEFAULT_HEADROOM,
        display: 'line',
        levelView: 'line',
        peakHold: true,
        lines: 'overlay',
        heatLines: 'post',
        heatPalette: 'ice',
        showHeard: true,
        heatSensitivity: 0.5,
        viewDb: 24,
        splitSwapped: false,
        meterOn: true,
        abSlot: 'A',
        abOther: null,

        checkpoint: () =>
          set((s) => ({ past: [...s.past, s.settings].slice(-HISTORY_LIMIT), future: [] })),

        undo: () =>
          set((s) => {
            const prev = s.past.at(-1);
            if (!prev) return s;
            return { settings: prev, past: s.past.slice(0, -1), future: [s.settings, ...s.future] };
          }),

        redo: () =>
          set((s) => {
            const next = s.future[0];
            if (!next) return s;
            return { settings: next, past: [...s.past, s.settings], future: s.future.slice(1) };
          }),

        load: (settings, autoGain) => {
          get().checkpoint();
          // Fresh band ids, so nothing keeps pointing at the old bands. Presets
          // saved when the app allowed more bands keep their first MAX_BANDS.
          const renew = (bands: Band[]) => bands.slice(0, MAX_BANDS).map((b) => ({ ...b, id: newId() }));
          const { split } = settings;
          const fresh = { ...settings, bands: renew(settings.bands), ...(split ? { split: { ...split, other: renew(split.other) } } : {}) };
          set({ settings: withAutoGain(fresh, autoGain, get().headroom), autoGain, selectedId: null, soloId: null });
        },

        replace: (settings, autoGain) =>
          set({
            settings: withAutoGain(settings, autoGain, get().headroom), autoGain,
            past: [], future: [], selectedId: null, focusId: null, soloId: null,
            abSlot: 'A', abOther: null,
          }),

        swapAb: (preset) => {
          const s = get();
          const leaving: AbSlot = { settings: s.settings, autoGain: s.autoGain, past: s.past, future: s.future, preset };
          // B opened for the first time: a copy of A, to change from there.
          const next = s.abOther ?? { ...leaving, past: [], future: [] };
          const keep = (id: string | null) => (id && next.settings.bands.some((b) => b.id === id) ? id : null);
          set({
            settings: withAutoGain(next.settings, next.autoGain, s.headroom), autoGain: next.autoGain, past: next.past, future: next.future,
            abOther: leaving, abSlot: s.abSlot === 'A' ? 'B' : 'A',
            selectedId: keep(s.selectedId), focusId: null, soloId: null,
          });
          return next.preset;
        },

        setSplit: (on, preset) => {
          const { settings } = get();
          if (!!settings.split?.on === on) return;
          get().checkpoint();
          const split = settings.split
            ? { ...settings.split, on }
            : { on, side: 'L' as const, other: settings.bands, otherPreset: preset };
          set((s) => ({ settings: withAutoGain({ ...settings, split }, s.autoGain, s.headroom), soloId: null }));
        },

        flipSide: (preset) => {
          const { settings, selectedId } = get();
          const { split } = settings;
          if (!split?.on) return;
          const side = split.side === 'L' ? 'R' : 'L';
          // A band that exists on both sides stays selected: band 3 on L, band 3 on R.
          const keep = split.other.some((b) => b.id === selectedId) ? selectedId : null;
          set({
            settings: { ...settings, bands: split.other, split: { ...split, side, other: settings.bands, otherPreset: preset } },
            selectedId: keep, focusId: null, soloId: null,
          });
        },

        focus: (id) => set({ focusId: id }),
        select: (id) => set({ selectedId: id }),
        setGraphHot: (id) => { if (get().graphHotId !== id) set({ graphHotId: id }); },
        toggleSolo: (id) => set((s) => ({ soloId: s.soloId === id ? null : id })),

        addBand: () => {
          const { bands } = get().settings;
          if (bands.length >= MAX_BANDS) return;
          const { bands: next, band } = withNewBand(bands);
          get().checkpoint();
          set((s) => ({ settings: withAutoGain({ ...s.settings, bands: next }, s.autoGain, s.headroom), selectedId: band.id }));
        },

        moveBand: (id, dir) => {
          const bands = [...get().settings.bands];
          const from = bands.findIndex((b) => b.id === id);
          const to = from + dir;
          if (from < 0 || to < 0 || to >= bands.length) return;
          [bands[from], bands[to]] = [bands[to]!, bands[from]!];
          get().checkpoint();
          // Selection, focus and solo follow the band by id, so they move with it.
          set((s) => ({ settings: { ...s.settings, bands } }));
        },

        resetBand: (id) => {
          const b = band(id);
          if (!b) return;
          const { bands } = get().settings;
          get().checkpoint();
          get().updateBand(id, { gain: 0, freq: homeFreq(bands.indexOf(b), bands.length), q: FILTER_INFO[b.type].defaultQ });
        },

        resetGainFreq: (id) => {
          const b = band(id);
          if (!b) return;
          const { bands } = get().settings;
          get().checkpoint();
          get().updateBand(id, { gain: 0, freq: homeFreq(bands.indexOf(b), bands.length) });
        },

        setBandCount: (count, undoStep = true) => {
          const target = clamp(Math.round(count), MIN_BANDS, MAX_BANDS);
          let { bands } = get().settings;
          if (!Number.isFinite(count) || target === bands.length) return;
          // Like adding / removing that many times, but one undo step. Removing
          // takes bands off the end (a typed number has no "selected" meaning).
          while (bands.length < target) bands = withNewBand(bands).bands;
          bands = bands.slice(0, target);
          if (undoStep) get().checkpoint();
          set((s) => {
            const has = (id: string | null) => (id && bands.some((b) => b.id === id) ? id : null);
            return {
              settings: withAutoGain({ ...s.settings, bands }, s.autoGain, s.headroom),
              selectedId: has(s.selectedId), focusId: has(s.focusId), soloId: has(s.soloId),
            };
          });
        },

        removeBand: (id) => {
          const { bands } = get().settings;
          if (bands.length <= MIN_BANDS) return;
          const selected = bands.find((b) => b.id === get().selectedId)?.id;
          const target = id ?? selected ?? bands.at(-1)?.id;
          if (!bands.some((b) => b.id === target)) return;
          get().checkpoint();
          set((s) => ({
            settings: withAutoGain({ ...s.settings, bands: bands.filter((b) => b.id !== target) }, s.autoGain, s.headroom),
            selectedId: s.selectedId === target ? null : s.selectedId,
            focusId: s.focusId === target ? null : s.focusId,
            soloId: s.soloId === target ? null : s.soloId,
          }));
        },
        setDisplay: (display) => set(display === 'line' || display === 'bars' ? { display, levelView: display } : { display }),
        swapSplit: () => set((s) => ({ splitSwapped: !s.splitSwapped })),
        setMeterOn: (meterOn) => set({ meterOn }),
        setPeakHold: (peakHold) => set({ peakHold }),
        setLines: (lines) => set({ lines }),
        setHeatLines: (heatLines) => set({ heatLines }),
        setHeatPalette: (heatPalette) => set({ heatPalette }),
        setShowHeard: (showHeard) => set({ showHeard }),
        setHeatSensitivity: (norm) => set({ heatSensitivity: clamp(norm, 0, 1) }),
        toggleViewDb: () => set((s) => ({ viewDb: s.viewDb === 24 ? 12 : 24 })),

        updateBand: (id, patch) =>
          set((s) => {
            const clean = sanitize(patch);
            const bands = s.settings.bands.map((b) => (b.id === id ? { ...b, ...clean } : b));
            return { settings: withAutoGain({ ...s.settings, bands }, s.autoGain, s.headroom) };
          }),

        stepParam: (id, key, dir, fine) => {
          const b = band(id);
          if (!b || (key === 'q' && !hasQ(b.type))) return;
          get().updateBand(id, { [key]: PARAMS[key].step(b[key], dir, fine) });
        },

        setParamNorm: (id, key, norm) =>
          get().updateBand(id, { [key]: paramDef(key, get().viewDb).fromNorm(norm) }),

        resetParam: (id, key) => {
          const b = band(id);
          if (!b) return;
          const { bands } = get().settings;
          const defaults = { freq: homeFreq(bands.indexOf(b), bands.length), gain: 0, q: FILTER_INFO[b.type].defaultQ };
          get().updateBand(id, { [key]: defaults[key] });
        },

        setParam: (id, key, value) => {
          if (!band(id) || !Number.isFinite(value)) return;
          get().checkpoint();
          get().updateBand(id, { [key]: PARAMS[key].round(value) });
        },

        setType: (id, type) => get().updateBand(id, { type, q: FILTER_INFO[type].defaultQ }),

        setSlope: (id, slope) => {
          const b = band(id);
          if (!b || !hasSlope(b.type) || (b.slope ?? 12) === slope) return;
          get().checkpoint();
          get().updateBand(id, { slope });
        },

        cycleType: (id, dir) => {
          const b = band(id);
          if (!b) return;
          const n = FILTER_TYPES.length;
          // A shape from "More…" isn't on the wheel: it steps onto the list's near end.
          const at = (FILTER_TYPES as readonly FilterType[]).indexOf(b.type);
          const next = at < 0 ? FILTER_TYPES[dir > 0 ? 0 : n - 1]! : FILTER_TYPES[(at + dir + n) % n]!;
          get().setType(id, next);
        },

        setPreamp: (db) =>
          set((s) => ({ settings: { ...s.settings, preamp: clamp(db, LIMITS.preamp.min, LIMITS.preamp.max) }, autoGain: false })),

        setAutoGain: (on) => set((s) => ({ autoGain: on, settings: withAutoGain(s.settings, on, s.headroom) })),

        setHeadroom: (db) => {
          const headroom = clamp(db, 0, LIMITS.preamp.max);
          set((s) => ({ headroom, settings: withAutoGain(s.settings, s.autoGain, headroom) }));
        },
      };
    },
    {
      name: 'corvid-eq-state',
      version: 6,
      // v1 had any number of bands -> start fresh. v2 -> v3 only dropped `range`.
      migrate: (persisted, version) => {
        const { leftCount: _gone, ...p } = persisted as Partial<EqStore> & { leftCount?: number };
        if (version < 2 || !p.settings) return { settings: flatSettings(), autoGain: true, display: 'line' };
        // v4 -> v5: the left band panel (and `leftCount`) is gone, so at most MAX_BANDS bands.
        // v5 -> v6: Auto leaves `headroom`, so its preamp is derived again.
        const autoGain = p.autoGain ?? true;
        const headroom = p.headroom ?? DEFAULT_HEADROOM;
        const settings = withAutoGain({ ...p.settings, bands: p.settings.bands.slice(0, MAX_BANDS) }, autoGain, headroom);
        return { ...p, settings, autoGain, headroom, display: p.display ?? 'line' };
      },
      // History and hover focus are session-only; the EQ (and a solo, see
      // `soloId`) survives reloads.
      partialize: (s) => ({
        settings: s.settings, soloId: s.soloId, autoGain: s.autoGain, headroom: s.headroom, display: s.display, levelView: s.levelView, peakHold: s.peakHold, lines: s.lines, heatLines: s.heatLines, heatPalette: s.heatPalette, showHeard: s.showHeard, heatSensitivity: s.heatSensitivity, viewDb: s.viewDb, splitSwapped: s.splitSwapped, meterOn: s.meterOn,
      }),
    },
  ),
);
