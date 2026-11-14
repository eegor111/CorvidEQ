/**
 * Desktop only: the UI's errors go to the log file Rust keeps (errlog.rs), so
 * a bug report can show what went wrong. Nothing here is shown to the user.
 */
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '../audio/spectrum-source';

const MAX_LENGTH = 2000;

/** The last line sent: an error repeating 60 times a second is one line. */
let last = '';

export function logError(text: string) {
  if (!isDesktop || text === last) return;
  last = text;
  // Nowhere left to report a failure to log.
  invoke('log_error', { text: text.slice(0, MAX_LENGTH) }).catch(() => {});
}

/** An error's stack if it has one, else whatever was thrown. */
export const errorText = (error: unknown) => (error instanceof Error ? error.stack ?? error.message : String(error));

export const openLogFolder = () => invoke('open_log_folder');

let lastCrashPromise: Promise<string | null> | null = null;

/** Read and clear the previous crash marker once per app session. */
export function takeLastCrash(): Promise<string | null> {
  if (!isDesktop) return Promise.resolve(null);
  lastCrashPromise ??= invoke<string | null>('take_last_crash').catch(() => null);
  return lastCrashPromise;
}

/** Catch what nothing else caught. */
export function connectErrorLog() {
  window.addEventListener('error', (e) => logError(`UI error: ${errorText(e.error ?? e.message)}`));
  window.addEventListener('unhandledrejection', (e) => logError(`UI error: ${errorText(e.reason)}`));
}
