/**
 * Split EQ: a left and a right EQ instead of one. The EQ itself carries both
 * sides (`SplitEq` in eapo/types.ts); this adds the preset name the top bar
 * shows, since presets.ts sits above the store (like ab.ts).
 */
import { setAnalyzerSide } from '../audio/spectrum-source';
import { targetDevice, useAudioSource } from './audio-source';
import { usePresets, sameBands } from './presets';
import { useEq } from './store';

/**
 * Only something with exactly a left and a right can split: on surround,
 * `Channel: L` and `R` would leave the other speakers without any EQ, and a
 * mono input has no sides. Unknown format: assume stereo.
 */
export const canSplit = (source: ReturnType<typeof targetDevice>) =>
  !!source?.guid && (source.format?.channels ?? 2) === 2;

export function setSplit(on: boolean) {
  useEq.getState().setSplit(on, usePresets.getState().current);
}

/** Load a preset. Where a split one can't split, it plays one side as a single EQ. */
export function loadPreset(name: string) {
  usePresets.getState().load(name, !canSplit(targetDevice(useAudioSource.getState())));
}

export function switchSide() {
  useEq.getState().flipSide(usePresets.getState().current);
}

/**
 * The analyzer follows the side on screen: its "before" line takes the curve
 * back off the captured sound, which only holds for the channel with that curve.
 */
export function connectSplit() {
  const follow = () => {
    const { split } = useEq.getState().settings;
    setAnalyzerSide(split?.on ? split.side : null);
  };
  follow();
  useEq.subscribe(follow);
}

/** Would unsplitting change what one ear hears? Then it's worth asking first. */
export function sidesDiffer(): boolean {
  const { bands, split } = useEq.getState().settings;
  return !!split?.on && !sameBands(bands, split.other);
}
