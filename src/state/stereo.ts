/**
 * Balance and delay, one set per output: they fit one pair of speakers to one
 * room, so headphones must not inherit them. Not part of an EQ: presets, A/B,
 * and undo never touch them, and Bypass leaves them on
 * (it takes away the EQ, not your speaker setup).
 *
 * eq-file.ts appends them to corvid-eq.txt with `Device:` lines, so Equalizer
 * APO switches by itself, also while the app is closed.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StereoSection } from '../eapo/format';
import { FLAT_STEREO, LIMITS, clamp, type Stereo } from '../eapo/types';
import { PARAMS } from './params';
import { targetDevice, useAudioSource } from './audio-source';

/** No output known (the browser, or before the list is read): kept, but never written. */
const NO_OUTPUT = 'none';

interface StereoStore {
  /** By endpoint GUID. */
  outputs: Record<string, Stereo>;
}

export const useStereo = create<StereoStore>()(
  persist(() => ({ outputs: {} }), { name: 'corvid-eq-stereo' }),
);

const outputKey = (s: Parameters<typeof targetDevice>[0]) => targetDevice(s)?.guid ?? NO_OUTPUT;

/** The balance and delay of the output you're listening to, right now. */
export const currentStereo = (): Stereo =>
  useStereo.getState().outputs[outputKey(useAudioSource.getState())] ?? FLAT_STEREO;

/** The same, for a component. */
export function useCurrentStereo(): Stereo {
  const key = useAudioSource(outputKey);
  return useStereo((s) => s.outputs[key] ?? FLAT_STEREO);
}

/** Change the output you're listening to. Every change passes through here, so values stay in range. */
export function setStereo(change: Partial<Stereo>) {
  const next = { ...currentStereo(), ...change };
  const delay = (v: number) => PARAMS.delay.round(clamp(v, LIMITS.delay.min, LIMITS.delay.max));
  const key = outputKey(useAudioSource.getState());
  useStereo.setState((s) => ({
    outputs: {
      ...s.outputs,
      [key]: {
        balance: PARAMS.balance.round(clamp(next.balance, LIMITS.balance.min, LIMITS.balance.max)),
        delayL: delay(next.delayL),
        delayR: delay(next.delayR),
      },
    },
  }));
}

const isFlat = (s: Stereo) => s.balance === 0 && s.delayL === 0 && s.delayR === 0;

/** What corvid-eq.txt should add. `names`: GUID → name, only for the file's comments. */
export function stereoSections(names: Record<string, string>): StereoSection[] {
  return Object.entries(useStereo.getState().outputs)
    .filter(([guid, stereo]) => guid !== NO_OUTPUT && !isFlat(stereo))
    .map(([guid, stereo]) => ({ guid, name: names[guid] ?? guid, stereo }));
}
