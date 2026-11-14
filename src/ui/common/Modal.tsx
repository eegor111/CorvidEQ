/**
 * Shared modal dialog: dims the background, closes when clicking outside it or
 * pressing Escape, and stops keystrokes from reaching the EQ behind it. Pass
 * `onSubmit` when the modal is a form.
 *
 * Rendered into <body> (a portal), not where it's used: the top and bottom
 * bars each form their own layer (z-index in index.css), so a modal opened
 * from one would sit under the other.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  label: string;
  className?: string;
  onClose(): void;
  onSubmit?(): void;
  children: ReactNode;
}

export function Modal({ label, className, onClose, onSubmit, children }: Props) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  // Escape closes. Captured first and stopped, so the app's own shortcuts
  // (B, Delete, Ctrl+Z…) don't run while this window is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const boxClass = className ? `modal ${className}` : 'modal';

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {onSubmit ? (
        <form className={boxClass} role="dialog" aria-label={label}
          onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
          {children}
        </form>
      ) : (
        <div className={boxClass} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>,
    document.body,
  );
}
