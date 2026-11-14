/**
 * Knob and fader: large, number-free controls for one parameter.
 *
 * Each control's hit area fills its whole cell in the band panel (and half the
 * gap to the next cell), so wherever the pointer is, it controls something.
 * The visible part (arc, bar) is drawn inside that area.
 *
 * Both share one gesture model:
 *   wheel          step the value (fine)
 *   drag up/down   sweep the value (Shift = fine)
 *   double-click   reset to default
 * Every gesture is a single undo step, and while you touch a control its band
 * is "focused" (highlighted on the graph).
 *
 * Controls are deliberately dumb: they only know a position (0…1) and three
 * callbacks. What a step or a reset means lives in state/params.ts and the store.
 */
import { useRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useEq } from '../../state/store';
import type { Direction } from '../../state/params';
import { useWheelSteps } from '../common/useWheelSteps';
import { GAIN_MARGIN } from '../graph/geometry';

/** Knobs: pixels of vertical mouse travel for the full range. */
const DRAG_PX = 220;
const FINE = 0.15;

export interface ControlProps {
  /** Band this control belongs to (or PREAMP_ID): drives focus/highlight. */
  focusId: string;
  /** Current position along the travel, 0…1. */
  norm: number;
  setNorm(norm: number): void;
  step(dir: Direction, fine: boolean): void;
  reset(): void;
  disabled?: boolean;
  label: string;
  /** CSS color for this control (band color or accent). */
  color: string;
  /** Does moving it change the EQ (and so belong in undo)? Default true. */
  undoable?: boolean;
  /** Tooltip. */
  title?: string;
}

/**
 * `travel(el)`: how many pixels of mouse movement cover the full range. Faders
 * measure their own track, so the thumb stays exactly under the cursor; knobs
 * use a fixed distance.
 */
export function Control({ props, className, children, travel, shiftFine = false }: {
  props: ControlProps;
  className: string;
  children: ReactNode;
  travel?: (el: HTMLElement) => number;
  shiftFine?: boolean;
}) {
  const { focusId, norm, setNorm, step, reset, disabled, label, color, undoable = true, title } = props;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; norm: number; pointer: number; px: number } | null>(null);
  const store = useEq.getState();

  useWheelSteps(ref, () => (disabled ? null : step), undoable, shiftFine);

  const onPointerDown = (e: RPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (undoable) store.checkpoint();
    const px = Math.max(40, travel?.(e.currentTarget as HTMLElement) ?? DRAG_PX);
    drag.current = { y: e.clientY, norm, pointer: e.pointerId, px };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const delta = ((d.y - e.clientY) / d.px) * (e.shiftKey ? FINE : 1);
    setNorm(Math.min(1, Math.max(0, d.norm + delta)));
  };
  const onPointerUp = (e: RPointerEvent) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    // Released outside the control: nothing is hovered any more.
    const r = e.currentTarget.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) store.focus(null);
  };

  return (
    <div
      ref={ref}
      className={`${className} ${disabled ? 'disabled' : ''}`}
      style={{ '--band': color } as React.CSSProperties}
      role="slider"
      title={title}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(norm * 100)}
      aria-disabled={disabled}
      onPointerEnter={() => store.focus(focusId)}
      onPointerLeave={() => { if (!drag.current) store.focus(null); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => { if (!disabled) { if (undoable) store.checkpoint(); reset(); } }}
    >
      {children}
    </div>
  );
}

/** SVG arc on a circle centered in a 40×40 box; angles in degrees, 0 = top. */
function arcPath(from: number, to: number, r = 14) {
  const pt = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return `${(20 + r * Math.sin(rad)).toFixed(2)} ${(20 - r * Math.cos(rad)).toFixed(2)}`;
  };
  return `M${pt(from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`;
}

/**
 * Knob drawn as a 270° arc only: a faint track and the value arc. `centered`:
 * the value arc grows from the top instead of the start, for a value whose
 * rest position is the middle (balance); centered, it's a small mark.
 */
export function Knob({ centered, ...props }: ControlProps & { centered?: boolean }) {
  const START = -135;
  const SWEEP = 270;
  const at = START + Math.max(0.015, Math.min(1, props.norm)) * SWEEP;
  const value = centered ? arcPath(Math.min(at, -1), Math.max(at, 1)) : arcPath(START, at);
  return (
    <Control props={props} className="knob">
      <svg width="40" height="40" viewBox="0 0 40 40" className="knob-face">
        <path d={arcPath(START, START + SWEEP)} className="knob-track" />
        <path d={value} className="knob-value" />
      </svg>
    </Control>
  );
}

/**
 * Fader: a translucent bar with a circle inside. The fill grows from the
 * middle (0 dB). The hit area is the whole cell around the bar (CSS), so
 * there's no dead space between controls.
 */
/** The thumb's travel: the track minus GAIN_MARGIN at each end (see `at` below). */
const faderTravel = (el: HTMLElement) => (el.querySelector('.fader-bar')?.clientHeight ?? DRAG_PX) - 2 * GAIN_MARGIN;

export function Fader(props: ControlProps) {
  const p = Math.min(1, Math.max(0, props.norm));
  // The bar is as tall as the graph, so the circle's center travels between
  // the graph's top and bottom dB lines: --gain-margin in from each end.
  const at = (v: number) => `calc(var(--gain-margin) + (100% - 2 * var(--gain-margin)) * ${v})`;
  return (
    <Control props={props} className="fader" travel={faderTravel}>
      <div className="fader-bar">
        <div className="fader-fill" style={{ bottom: at(Math.min(p, 0.5)), top: `calc(100% - ${at(Math.max(p, 0.5))})` }} />
        <div className="fader-zero" />
        <div className="fader-thumb" style={{ bottom: at(p) }} />
      </div>
    </Control>
  );
}
