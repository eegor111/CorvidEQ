/**
 * Desktop only: every output has its own EQ, and so does every input (below,
 * "output" means both: they differ in nothing here). Headphones and speakers
 * rarely want the same sound, and this leaves one idea to hold: this device
 * has this EQ. To use the same sound elsewhere, load the same preset there.
 *
 * The editor (the `useEq` store) always holds the EQ of the device you're
 * listening to (the one picked in the source picker, else Windows' default)
 * and swaps when that changes. All of them are written into corvid-eq.txt
 * with `Device:` lines (eq-file.ts), so Equalizer APO switches by itself, also
 * while the app is closed. A new output starts flat. An output without an EQ
 * here gets no section in the file, so it plays flat too.
 *
 * Nothing needs saving: every EQ is remembered as it is, preset or not.
 *
 * Bookkeeping: the EQ in the editor is the live one; its copy in `eqs` is only
 * updated when the editor swaps to another output.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EqSettings } from '../eapo/types';
import type { OutputSection } from '../eapo/format';
import { isDesktop } from '../audio/spectrum-source';
import { targetDevice, useAudioSource } from './audio-source';
import { DEFAULT_PRESET, usePresets } from './presets';
import { autoLevelled, flatSettings, useEq } from './store';
import { isWindowIdle, onWindowResume } from './window-idle';

/** The output list (default output, Equalizer APO slots) is re-read this often. */
const REFRESH_MS = 3000;

export interface OutputEq {
  settings: EqSettings;
  autoGain: boolean;
  /** The preset name the top bar shows for it. */
  preset: string;
}

interface OutputEqs {
  /** Each output's EQ, by endpoint GUID. */
  eqs: Record<string, OutputEq>;
  /** Whose EQ is in the editor: an output's GUID, null until the first output is known. */
  editing: string | null;
  /** Every output seen so far (GUID → name), for the file's comments and balance / delay. */
  seen: Record<string, string>;
  /**
   * Each device's last known sample rate (GUID → Hz), for the file's Nyquist
   * limit. Saved, so a device that's unplugged or not read yet keeps its limit:
   * it can start playing the file before the list is next read.
   */
  rates: Record<string, number>;
}

/** The EQ in the editor, as it would be stashed. */
const liveEq = (): OutputEq => {
  const { settings, autoGain } = useEq.getState();
  return { settings, autoGain, preset: usePresets.getState().current };
};

/** What older versions saved: outputs either bound to their own EQ or on a shared one. */
interface SavedBeforeOwnEqs {
  own?: Record<string, { name: string; on: boolean; eq: OutputEq }>;
  shared?: OutputEq | null;
  editing?: string;
  seen?: Record<string, string>;
}

/** Each output keeps the EQ it plays now, so updating changes nothing you hear. */
function fromSharedEq({ own = {}, shared = null, editing = 'shared', seen = {} }: SavedBeforeOwnEqs): OutputEqs {
  const live = liveEq();
  const eqs: Record<string, OutputEq> = {};
  const known = { ...seen, ...Object.fromEntries(Object.entries(own).map(([guid, o]) => [guid, o.name])) };
  for (const guid of Object.keys(known)) {
    const bound = own[guid];
    // The editor's EQ is the live one: its saved copy can be out of date.
    const key = bound?.on ? guid : 'shared';
    const eq = key === editing ? live : bound?.on ? bound.eq : shared;
    if (eq) eqs[guid] = eq;
  }
  return { eqs, editing: editing === 'shared' ? null : editing, seen: known, rates: {} };
}

export const useOutputEqs = create<OutputEqs>()(
  persist(
    (): OutputEqs => ({ eqs: {}, editing: null, seen: {}, rates: {} }),
    {
      name: 'corvid-eq-output-eqs',
      version: 1,
      migrate: (saved) => fromSharedEq(saved as SavedBeforeOwnEqs),
      partialize: (s) => ({ eqs: s.eqs, editing: s.editing, seen: s.seen, rates: s.rates }),
    },
  ),
);

/** Put this output's EQ in the editor, stashing the one that was there. */
function swapTo(guid: string) {
  const { eqs, editing } = useOutputEqs.getState();
  const next = eqs[guid] ?? { settings: flatSettings(), autoGain: true, preset: DEFAULT_PRESET };
  useOutputEqs.setState({ eqs: editing ? { ...eqs, [editing]: liveEq() } : eqs, editing: guid });
  useEq.getState().replace(next.settings, next.autoGain);
  usePresets.setState({ current: next.preset });
}

/** Make the editor show the EQ of the output you're listening to. */
function follow() {
  const guid = targetDevice(useAudioSource.getState())?.guid;
  if (!guid) return;
  const { eqs, editing } = useOutputEqs.getState();
  if (guid === editing) return;
  // The very first output: the editor's EQ is simply its EQ.
  if (!editing && !eqs[guid]) useOutputEqs.setState({ editing: guid });
  else swapTo(guid);
}

/**
 * What corvid-eq.txt should hold: one section per output with an EQ. `live` is
 * the editor's EQ as applied (a solo included).
 */
export function outputSections(live: EqSettings): OutputSection[] {
  const { eqs, editing, seen, rates } = useOutputEqs.getState();
  const guids = new Set(Object.keys(eqs));
  if (editing) guids.add(editing);
  return [...guids].map((guid) => {
    const eq = eqs[guid];
    const settings = guid === editing || !eq ? live : autoLevelled(eq.settings, eq.autoGain);
    return { guids: [guid], names: [seen[guid] ?? guid], settings, rate: rates[guid] };
  });
}

export function connectOutputEqs() {
  if (!isDesktop) return;
  useAudioSource.subscribe((s, prev) => {
    if (s.devices === prev.devices && s.choice === prev.choice && s.input === prev.input) return;
    // Remember every output and its current name.
    const { seen } = useOutputEqs.getState();
    const fresh = s.devices.filter((o) => o.guid && seen[o.guid] !== o.name);
    if (fresh.length > 0) {
      useOutputEqs.setState({ seen: { ...seen, ...Object.fromEntries(fresh.map((o) => [o.guid!, o.name])) } });
    }
    // A device's rate can change (Windows' sound settings): the file follows.
    const { rates } = useOutputEqs.getState();
    const changed = s.devices.filter((o) => o.guid && o.format && rates[o.guid] !== o.format.sampleRate);
    if (changed.length > 0) {
      useOutputEqs.setState({ rates: { ...rates, ...Object.fromEntries(changed.map((o) => [o.guid!, o.format!.sampleRate])) } });
    }
    follow();
  });
  const { refresh } = useAudioSource.getState();
  void refresh();
  setInterval(() => {
    if (!isWindowIdle()) void refresh();
  }, REFRESH_MS);
  onWindowResume(() => void refresh());
}
