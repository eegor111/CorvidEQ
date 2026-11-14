/**
 * A number you can type: the ONE look for every editable number (the band
 * readout's Hz / dB / Q, the band count, the delays). A dark box with cyan
 * digits that turns cyan-ish on hover; scroll or drag it up and down to step,
 * click it to type. Enter or clicking away applies, Esc cancels. What the text
 * means is the caller's business (`onCommit` gets the raw text; anything
 * unreadable should just be ignored there).
 *
 * Dragging walks the same steps as the wheel (`onStep`), so a field needs no
 * scale of its own: a delay can move 0.01 ms at a time, which a knob's fixed
 * travel over 200 ms never could.
 *
 * Styles: `.num-field` in index.css ("Editable numbers").
 */
import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useEq } from '../../state/store';
import { useWheelSteps, type WheelStep } from './useWheelSteps';
import { TOOLTIPS } from '../tooltips';

/** A press must move this far to be a drag; less is a click, which opens typing. */
const DRAG_START_PX = 4;

export function NumberField({ text, edit, onCommit, onStep, label, title, className = '', children, undoable = true, dragPx = 4 }: {
  /** What it shows, e.g. "1.25 kHz". */
  text: string;
  /** What the field starts with when you click it: the plain number, e.g. "1250". */
  edit: string;
  onCommit(text: string): void;
  /** Mouse wheel: one fine step up / down, like every control. Not while typing. */
  onStep: WheelStep;
  /** Accessible name, e.g. "Band 3 frequency". */
  label: string;
  title?: string;
  className?: string;
  /** Extra controls in the field's box (the band count's − and +): scrolling over them steps too. */
  children?: ReactNode;
  /** Does stepping it change the EQ (and so belong in undo)? Default true. */
  undoable?: boolean;
  /** Pixels of drag per step. The default crosses a band's dB, Hz or Q range in a few hundred. */
  dragPx?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc closes the field, and Chromium may fire blur while it disappears:
  // this keeps that blur from applying the draft anyway.
  const cancelled = useRef(false);
  // The wheel listens on a wrapper that stays put while the button and the
  // text field swap places (display: contents, so it adds no box).
  const wrap = useRef<HTMLSpanElement>(null);
  useWheelSteps(wrap, () => (draft === null ? onStep : null), undoable);
  const drag = useRef<{ pointer: number; y: number; moving: boolean } | null>(null);
  // The click that follows a drag's release must not open the field.
  const dragged = useRef(false);

  const open = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    cancelled.current = false;
    setDraft(edit);
  };
  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, y: e.clientY, moving: false };
    dragged.current = false;
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (d?.pointer !== e.pointerId) return;
    if (!d.moving) {
      if (Math.abs(d.y - e.clientY) < DRAG_START_PX) return;
      d.moving = true;
      d.y = e.clientY;
      dragged.current = true;
      if (undoable) useEq.getState().checkpoint(); // the whole drag is one undo step
    }
    const steps = Math.trunc((d.y - e.clientY) / dragPx); // up = more
    d.y -= steps * dragPx; // the leftover pixels count toward the next step
    for (let i = 0; i < Math.abs(steps); i++) onStep(steps > 0 ? 1 : -1, e.shiftKey);
  };
  const endDrag = () => { drag.current = null; };
  const commit = () => {
    if (draft !== null && !cancelled.current) onCommit(draft);
    setDraft(null);
  };

  return <span ref={wrap} className="num-field-wrap">{draft === null ? (
    <button type="button" className={`num-field ${className}`} onClick={open} aria-label={label}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      title={title ?? TOOLTIPS.numberField.default}>
      {text}
    </button>
  ) : (
    <input
      className={`num-field editing ${className}`}
      aria-label={label}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      value={draft}
      size={Math.max(draft.length, 3)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setDraft(null);
        }
      }}
    />
  )}{children}</span>;
}
