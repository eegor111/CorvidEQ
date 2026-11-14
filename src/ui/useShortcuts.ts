/**
 * Global keyboard shortcuts.
 *
 *   Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)  undo / redo
 *   B                               bypass on / off (hear without the EQ)
 *   Esc                             deselect the band
 *   Delete                          remove the selected band
 */
import { useEffect } from 'react';
import { isBypassed, setBypass } from '../state/bypass';
import { useEq } from '../state/store';

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // The settings page covers the EQ: no edits you can't see.
      if (document.querySelector('.settings-page')) return;
      const eq = useEq.getState();
      const key = e.key.toLowerCase();

      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) eq.redo(); else eq.undo(); }
        if (key === 'y') { e.preventDefault(); eq.redo(); }
        return;
      }
      // B: hear the device on screen without its EQ (desktop: its part of corvid-eq.txt goes flat, see eq-file.ts).
      // Not on key repeat: holding B would flip bypass on and off.
      if (key === 'b' && !e.repeat) { setBypass(!isBypassed()); return; }
      if (key === 'escape') { eq.select(null); return; }
      if (key === 'delete' && eq.selectedId) { eq.removeBand(eq.selectedId); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
