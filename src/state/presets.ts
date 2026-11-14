/**
 * Presets: named EQ settings the user can switch between.
 *
 * - "Default" (every band at 0 dB) is built in: always first, never stored,
 *   can't be overwritten or deleted.
 * - Saving with an existing name overwrites that preset; a new name adds one.
 * - `current` is the preset last loaded or saved. Once the EQ no longer
 *   sounds like it (see `sameSound`), the name shows as "New…"; saving then
 *   asks for a new name or a preset to overwrite.
 * - Loading is one undo step, so switching presets never loses work for good.
 * - Split EQs: saving stores both sides, and loading such a preset brings
 *   both back (and splits). A normal preset loads into the side on screen,
 *   so each ear can have its own; that side keeps its own name and dot.
 *
 * Stored in the browser's local storage for now. (Later, in the desktop app,
 * presets may move to files next to `corvid-eq.txt`.)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { sideBands, type Band, type EqSettings } from '../eapo/types';
import { parsePresetFile } from '../eapo/format';
import { autoLevel } from '../dsp/response';
import { MAX_BANDS, flatSettings, useEq } from './store';

export const DEFAULT_PRESET = 'Default';

export interface Preset {
  name: string;
  settings: EqSettings;
  autoGain: boolean;
}

interface PresetStore {
  /** User presets, sorted by name. Default is not in here. */
  presets: Preset[];
  /** Name of the preset last loaded or saved. */
  current: string;
  /** Save the current EQ under `name` (overwrites a preset with that name). */
  save(name: string): void;
  /** `oneEq`: a split preset plays only its side on screen (see `loadPreset` in split.ts). */
  load(name: string, oneEq?: boolean): void;
  remove(name: string): void;
  /** Add presets from files (Equalizer APO .txt or JSON presets). Never overwrites. */
  importFiles(files: { name: string; text: string }[]): ImportResult;
}

export interface ImportResult {
  /** Names the new presets got. */
  added: string[];
  /** Problems, prefixed with the file name. */
  warnings: string[];
}

/** Names compare without case or surrounding spaces ("bass boost" = "Bass Boost "). */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const isDefault = (name: string) => sameName(name, DEFAULT_PRESET);

const defaultPreset = (): Preset => ({ name: DEFAULT_PRESET, settings: flatSettings(), autoGain: true });

/** Find a preset by name, including the built-in Default. */
export function findPreset(presets: Preset[], name: string): Preset | undefined {
  return isDefault(name) ? defaultPreset() : presets.find((p) => sameName(p.name, name));
}

/** Do two lists of bands sound the same? (Ids don't matter.) */
export function sameBands(a: Band[], b: Band[]): boolean {
  const key = (x: Band) => [x.enabled, x.type, x.freq, x.gain, x.q, x.slope ?? 12].join();
  return a.length === b.length && a.every((band, i) => key(band) === key(b[i]!));
}

/**
 * Does the EQ `a` still sound like the preset `b`? (Preamp only when set by
 * hand.) A split preset needs both sides to match; a normal one only the
 * side on screen, since that's the side it was loaded into.
 */
export function sameSound(a: EqSettings, aAuto: boolean, b: EqSettings, bAuto: boolean): boolean {
  if (aAuto !== bAuto) return false;
  if (!aAuto && Math.abs(a.preamp - b.preamp) > 1e-6) return false;
  if (!b.split?.on) return sameBands(a.bands, b.bands);
  return !!a.split?.on && sameBands(sideBands(a, 'L'), sideBands(b, 'L')) && sameBands(sideBands(a, 'R'), sideBands(b, 'R'));
}

export const usePresets = create<PresetStore>()(
  persist(
    (set, get) => ({
      presets: [],
      current: DEFAULT_PRESET,

      save: (name) => {
        const clean = name.trim();
        if (!clean || isDefault(clean)) return; // Default is read-only
        const { settings, autoGain } = useEq.getState();
        // A side kept from an earlier split isn't part of what you hear.
        const { split, ...oneEq } = settings;
        const named = split?.on ? { ...settings, split: { ...split, otherPreset: clean } } : oneEq;
        if (split?.on) useEq.setState({ settings: named });
        const preset: Preset = { name: clean, settings: named, autoGain };
        const others = get().presets.filter((p) => !sameName(p.name, clean));
        set({
          presets: [...others, preset].sort((x, y) => x.name.localeCompare(y.name)),
          current: clean,
        });
      },

      load: (name, oneEq = false) => {
        const preset = findPreset(get().presets, name);
        if (!preset) return;
        const eq = useEq.getState();
        const { split } = eq.settings;
        const { split: saved, ...plain } = preset.settings;
        // A normal preset leaves the other side alone, in use or kept for later.
        const settings = saved?.on && !oneEq ? preset.settings : split ? { ...plain, split } : plain;
        eq.load(settings, preset.autoGain);
        set({ current: preset.name });
      },

      importFiles: (files) => {
        const added: string[] = [];
        const warnings: string[] = [];
        let presets = get().presets;
        for (const file of files) {
          const base = file.name.replace(/\.(txt|json)$/i, '').trim() || 'Imported';
          const parsed = parsePresetFile(file.text);
          parsed.warnings.forEach((w) => warnings.push(`${base}: ${w}`));
          if (parsed.bands.length === 0) {
            warnings.push(`${base}: not a preset (no usable filters), skipped`);
            continue;
          }
          if (parsed.bands.length > MAX_BANDS) {
            warnings.push(`${base}: ${parsed.bands.length} filters, kept the first ${MAX_BANDS}`);
            parsed.bands = parsed.bands.slice(0, MAX_BANDS);
          }
          if (parsed.split && parsed.split.other.length > MAX_BANDS) {
            warnings.push(`${base}: ${parsed.split.other.length} filters on the right, kept the first ${MAX_BANDS}`);
            parsed.split.other = parsed.split.other.slice(0, MAX_BANDS);
          }
          // If the file's preamp is just the "never clip" value (with or
          // without our headroom), it was auto: keep Auto on. Otherwise keep
          // the exact preamp, so it sounds the same.
          const isAuto = (headroom: number) => Math.abs(parsed.preamp - autoLevel(parsed, headroom)) < 0.1;
          const auto = isAuto(0) || isAuto(useEq.getState().headroom);
          // A free name: "Woof", else "Woof (2)", "Woof (3)"… (Default is taken).
          let name = base;
          for (let n = 2; isDefault(name) || presets.some((p) => sameName(p.name, name)); n++) name = `${base} (${n})`;
          const split = parsed.split ? { split: { ...parsed.split, otherPreset: name } } : {};
          presets = [...presets, { name, settings: { preamp: parsed.preamp, bands: parsed.bands, ...split }, autoGain: auto }];
          added.push(name);
        }
        set({ presets: presets.sort((x, y) => x.name.localeCompare(y.name)) });
        return { added, warnings };
      },

      remove: (name) => {
        if (isDefault(name)) return;
        set((s) => ({
          presets: s.presets.filter((p) => !sameName(p.name, name)),
          // Deleting the current preset: what you hear stays, it's just unnamed now.
          current: sameName(s.current, name) ? '' : s.current,
        }));
      },
    }),
    {
      name: 'corvid-eq-presets',
      version: 2,
      // v1 called the built-in preset "Flat".
      migrate: (persisted) => {
        const p = persisted as Partial<PresetStore>;
        const current = p.current === 'Flat' ? DEFAULT_PRESET : p.current ?? DEFAULT_PRESET;
        return { presets: p.presets ?? [], current };
      },
      partialize: (s) => ({ presets: s.presets, current: s.current }),
    },
  ),
);

// The name follows the side on screen, however it got there (the L/R switch,
// or undo going back to an edit on the other side).
useEq.subscribe((s, prev) => {
  const now = s.settings.split;
  const was = prev.settings.split;
  if (now?.on && was?.on && now.side !== was.side) usePresets.setState({ current: was.otherPreset });
});

/** Shown instead of a preset name when there's no preset to name. */
export const NEW_PRESET = 'New…';

/**
 * Name to show for what you're hearing: the current preset's, else
 * NEW_PRESET. `isNew`: what you hear differs from it (the picker shows a dot).
 * Undoing back to the preset's sound clears that.
 */
export function usePresetStatus(): { name: string; isNew: boolean } {
  const current = usePresets((s) => s.current);
  const presets = usePresets((s) => s.presets);
  const settings = useEq((s) => s.settings);
  const autoGain = useEq((s) => s.autoGain);
  const preset = current ? findPreset(presets, current) : undefined;
  if (!preset) return { name: NEW_PRESET, isNew: true };
  return { name: preset.name, isNew: !sameSound(settings, autoGain, preset.settings, preset.autoGain) };
}
