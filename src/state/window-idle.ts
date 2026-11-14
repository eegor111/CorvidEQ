/**
 * Desktop: pauses live audio capture and background polling while the window is
 * hidden in the system tray (or minimized to the taskbar), and refreshes right
 * when the window becomes visible again.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktop, setCapturePaused } from '../audio/spectrum-source';

let trayHidden = false;
let idle = false;
const resumeListeners = new Set<() => void>();

export const isWindowIdle = () => idle;

export function onWindowResume(fn: () => void): () => void {
  resumeListeners.add(fn);
  return () => resumeListeners.delete(fn);
}

function updateIdle() {
  const next = trayHidden || document.visibilityState === 'hidden';
  if (next === idle) return;
  idle = next;
  setCapturePaused(next, 'window');
  if (!next) {
    for (const fn of resumeListeners) fn();
  }
}

export function connectWindowIdle() {
  if (!isDesktop) return;
  // Hold off capture until we know whether the app started hidden (--minimized).
  setCapturePaused(true, 'window-init');
  document.addEventListener('visibilitychange', updateIdle);
  void invoke<boolean>('is_window_hidden')
    .then((hidden) => {
      trayHidden = hidden;
      updateIdle();
    })
    .catch(() => {})
    .finally(() => setCapturePaused(false, 'window-init'));
  void listen<boolean>('tray-hidden', (event) => {
    trayHidden = event.payload;
    updateIdle();
  });
}
