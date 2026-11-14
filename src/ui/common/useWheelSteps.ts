/**
 * Mouse-wheel stepping, shared by every control (graph dots, knobs, faders,
 * shape buttons).
 *
 * - Attached as a native, non-passive listener so the page never scrolls.
 * - A burst of wheel ticks (gaps < 500 ms) becomes ONE undo step.
 * - `getTarget` is read on every tick and returns what to step, or null to
 *   ignore the wheel (e.g. nothing under the pointer, control disabled).
 * - `undoable: false` for controls that don't change the EQ (no undo step).
 * - Wheel always uses fine steps by default; `shiftFine: true` keeps normal
 *   steps and uses Shift for fine (e.g. heat sensitivity).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useEq } from '../../state/store';
import type { Direction } from '../../state/params';

const BURST_MS = 500;

export type WheelStep = (dir: Direction, fine: boolean) => void;

export function useWheelSteps(
  ref: RefObject<Element | null>,
  getTarget: () => WheelStep | null,
  undoable = true,
  shiftFine = false,
) {
  // Always call the latest getTarget without re-attaching the listener.
  const latest = useRef(getTarget);
  useEffect(() => { latest.current = getTarget; });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = -Infinity;
    const onWheel = (e: Event) => {
      const we = e as WheelEvent;
      const apply = latest.current();
      if (!apply) return;
      we.preventDefault();
      if (undoable && we.timeStamp - last > BURST_MS) useEq.getState().checkpoint();
      last = we.timeStamp;
      apply(we.deltaY < 0 ? 1 : -1, shiftFine ? we.shiftKey : true); // wheel up = +1
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, undoable, shiftFine]);
}
