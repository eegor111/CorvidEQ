/**
 * A/B: flip between two EQs to hear which you like better. The store swaps
 * the EQs (with their undo histories, see `swapAb`); this also swaps the
 * preset name the top bar shows, since presets.ts sits above the store.
 *
 * Not level-matched (user's choice): each slot has its own Level, so you can
 * match them by hand and see what you did. Louder tends to sound "better".
 */
import { usePresets } from './presets';
import { useEq, type AbSlotName } from './store';

export function switchAb(to: AbSlotName) {
  const eq = useEq.getState();
  if (to === eq.abSlot) return;
  const preset = eq.swapAb(usePresets.getState().current);
  usePresets.setState({ current: preset });
}
