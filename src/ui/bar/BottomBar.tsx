/**
 * Bar under the graph: the preset, bypass and A/B (comparing), and at the right end L/R,
 * balance and delay (left and right) (what you see is on the graph's left edge;
 * the meters stand under the dB scales; the rest is in the top bar). Big targets.
 *
 * It shares its row with the Q knobs, so it should stay on one line: folded,
 * it makes that row taller and spreads the knobs apart. New controls go in the
 * top bar when they can.
 */
import { isDesktop } from '../../audio/spectrum-source';
import type { Side } from '../../eapo/types';
import { switchAb } from '../../state/ab';
import { setBypass, useIsBypassed } from '../../state/bypass';
import { switchSide } from '../../state/split';
import { useEq } from '../../state/store';
import { BypassIcon } from '../common/icons';
import { PresetPicker } from '../presets/PresetPicker';
import { PairSwitch } from './PairSwitch';
import { StereoControls } from './StereoControls';
import { TOOLTIPS } from '../tooltips';

/** A/B: two EQs to flip between instantly (state/ab.ts). */
function AbSwitch() {
  const slot = useEq((s) => s.abSlot);
  return (
    <PairSwitch options={['A', 'B']} value={slot} onSwitch={switchAb} label="A/B comparison"
      title={TOOLTIPS.bottomBar.ab(slot)} />
  );
}

/**
 * L/R: which side of a split EQ you're editing. Only there while the EQ is
 * split (the source picker's "Split left / right EQ"). You hear both sides
 * either way; this only picks the one on screen.
 */
function LrSwitch() {
  const side = useEq((s) => (s.settings.split?.on ? s.settings.split.side : null));
  if (!side) return null;
  return (
    <PairSwitch<Side> options={['L', 'R']} value={side} onSwitch={switchSide} label="Left / right EQ"
      title={TOOLTIPS.bottomBar.lr(side)} />
  );
}

/**
 * Desktop: bypass, a quick listen without the EQ on screen to compare (also
 * the B key). Lit yellow while bypassed. (In the browser the power button does this.)
 */
function BypassButton() {
  const bypass = useIsBypassed();
  return (
    <button className={`icon-toggle ${bypass ? 'on' : ''}`} aria-pressed={bypass} aria-label="Bypass"
      onClick={() => setBypass(!bypass)}
      title={TOOLTIPS.bottomBar.bypass}>
      <BypassIcon />
    </button>
  );
}

export function BottomBar() {
  return (
    <footer className="bottombar">
      <PresetPicker />
      {isDesktop && <BypassButton />}
      <AbSwitch />
      <div className="group bar-end">
        <LrSwitch />
        <StereoControls />
      </div>
    </footer>
  );
}
