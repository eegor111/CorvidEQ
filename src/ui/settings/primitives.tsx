/**
 * Building blocks of the settings page. Every setting is a Row: what it is
 * (label + one line of description) on the left, the control on the right.
 * Rows sit in Sections: a plain heading, no box. Only things you can click
 * get an outline, so the eye finds them at once.
 *
 * Controls: Segmented (2–3 choices side by side), Select (4 or more, a
 * dropdown, optionally with a trash can per item), Action (a button), Keys
 * (key chips, read only), Value (a read-only fact, optional status dot).
 * Styles: "Settings page" in index.css.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '../common/Button';
import { ChevronIcon, TrashIcon } from '../common/icons';
import { useMenuClose } from '../common/useMenuClose';

export function Page({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="set-page">
      <header className="set-page-head">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="set-section">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

/** `stack`: the control goes under the text, full width (long values like a path). */
export function Row({ label, description, stack, children }: {
  label: ReactNode; description?: ReactNode; stack?: boolean; children?: ReactNode;
}) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-row-text">
        <span className="set-label">{label}</span>
        {description && <span className="set-desc">{description}</span>}
      </div>
      {children && <div className="set-control">{children}</div>}
    </div>
  );
}

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  /** Drawn inside the option, e.g. a font's own family. */
  style?: CSSProperties;
  /** Gets a trash can in the list (Select's onDelete). */
  deletable?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Option<T>[]; onChange(v: T): void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <Button key={o.value} role="radio" aria-checked={o.value === value}
          on={o.value === value} style={o.style} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/** `onDelete`: deletable options get a trash can (click, then "Delete?"), like the preset list. */
export function Select<T extends string>({ value, options, onChange, onDelete, label }: {
  value: T; options: Option<T>[]; onChange(v: T): void; onDelete?(v: T): void; label: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <div className="set-select">
      <Button ref={button} on={open} style={current?.style}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        <span>{current?.label}</span>
        <ChevronIcon />
      </Button>
      {open && <SelectMenu options={options} value={value} anchor={button} onDelete={onDelete}
        onPick={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SelectMenu<T extends string>({ options, value, anchor, onPick, onDelete, onClose }: {
  options: Option<T>[]; value: T; anchor: React.RefObject<HTMLButtonElement | null>;
  onPick(v: T): void; onDelete?(v: T): void; onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<T | null>(null);
  useMenuClose(menu, onClose, anchor);
  return (
    <div ref={menu} className="menu" role="listbox">
      {options.map((o) => (
        // The same row as the preset list: the item, then its trash can.
        <div key={o.value} className="preset-menu-row">
          <button type="button" role="option" aria-selected={o.value === value}
            className={`preset-load ${o.value === value ? 'on' : ''}`} style={o.style} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
          {onDelete && o.deletable && (confirm === o.value ? (
            <button type="button" className="delete confirm" onPointerLeave={() => setConfirm(null)}
              onClick={() => { onDelete(o.value); setConfirm(null); }}>
              Delete?
            </button>
          ) : (
            <button type="button" className="icon delete" aria-label={`Delete ${o.value}`} title="Delete"
              onClick={() => setConfirm(o.value)}>
              <TrashIcon />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** `on`: a switch that's on (yellow outline), e.g. a color's Auto. */
export function Action({ onClick, disabled, on, tone, title, children }: {
  onClick?(): void; disabled?: boolean; on?: boolean; tone?: 'danger'; title?: string; children: ReactNode;
}) {
  const cls = `set-action ${tone ?? ''}`;
  return <Button className={cls} on={on} aria-pressed={on} onClick={onClick} disabled={disabled} title={title}>{children}</Button>;
}

/** A read-only fact. `status`: a dot before it (on = yellow, off = dim, error = red). */
export function Value({ status, children }: { status?: 'on' | 'off' | 'error'; children: ReactNode }) {
  return (
    <span className="set-value">
      {status && <span className={`set-dot ${status}`} />}
      {children}
    </span>
  );
}

/** Key chips. Each inner list is one combination; several = alternatives ("or"). */
export function Keys({ combos }: { combos: string[][] }) {
  return (
    <span className="set-keys">
      {combos.map((combo, i) => (
        <span key={i} className="set-combo">
          {i > 0 && <span className="set-or">or</span>}
          {combo.map((k) => <kbd key={k}>{k}</kbd>)}
        </span>
      ))}
    </span>
  );
}

/** A short message after an action (folder changed, restore failed…). */
export function Note({ children }: { children: ReactNode }) {
  return <p className="set-note" role="status">{children}</p>;
}
