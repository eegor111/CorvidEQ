/**
 * Desktop only: checks GitHub Releases for a newer signed version via
 * tauri-plugin-updater, downloads and installs it, and relaunches when needed.
 */
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import { isDesktop } from '../audio/spectrum-source';
import { logError } from './error-log';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'installed'
  | 'error';

export interface UpdaterState {
  status: UpdateStatus;
  availableVersion: string | null;
  progress: number | null;
  error: string | null;
  errorPhase: 'check' | 'install' | null;
}

const STARTUP_CHECK_DELAY_MS = 4000;

export const useUpdater = create<UpdaterState>(() => ({
  status: 'idle',
  availableVersion: null,
  progress: null,
  error: null,
  errorPhase: null,
}));

let pendingUpdate: Update | null = null;
let checking = false;

async function replacePending(next: Update | null) {
  const prev = pendingUpdate;
  pendingUpdate = next;
  if (prev && prev !== next) {
    await prev.close().catch(() => {});
  }
}

/** Check GitHub Releases for an update. Quiet checks stay silent if offline or unpublished. */
export async function checkForUpdates(quiet = false): Promise<void> {
  if (!isDesktop || checking) return;
  if (quiet && import.meta.env.DEV) return;
  const current = useUpdater.getState().status;
  if (current === 'downloading' || current === 'installed') return;

  checking = true;
  if (!quiet) {
    useUpdater.setState({ status: 'checking', error: null, errorPhase: null });
  }
  try {
    const update = await check();
    if (update) {
      await replacePending(update);
      useUpdater.setState({
        status: 'available',
        availableVersion: update.version,
        progress: null,
        error: null,
        errorPhase: null,
      });
    } else {
      await replacePending(null);
      useUpdater.setState({
        status: quiet ? 'idle' : 'up-to-date',
        availableVersion: null,
        progress: null,
        error: null,
        errorPhase: null,
      });
    }
  } catch (err) {
    if (quiet) {
      if (useUpdater.getState().status === 'checking') {
        useUpdater.setState({ status: 'idle' });
      }
    } else {
      useUpdater.setState({
        status: 'error',
        error: String(err),
        errorPhase: 'check',
      });
    }
  } finally {
    checking = false;
  }
}

/** Download, verify, and install the available update, then relaunch. */
export async function installUpdate(): Promise<void> {
  const update = pendingUpdate;
  const { status } = useUpdater.getState();
  if (!isDesktop || !update || status === 'downloading' || status === 'installed') return;

  let total = 0;
  let downloaded = 0;
  useUpdater.setState({ status: 'downloading', progress: 0, error: null, errorPhase: null });

  try {
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
        downloaded = 0;
        useUpdater.setState({ progress: total > 0 ? 0 : null });
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        if (total > 0) {
          useUpdater.setState({ progress: Math.min(100, Math.round((downloaded / total) * 100)) });
        }
      } else if (event.event === 'Finished') {
        // On Windows NSIS, downloadAndInstall exits the process right after this
        // to run the installer, so stay in 'downloading' rather than flashing 'installed'.
        useUpdater.setState({ progress: 100 });
      }
    });
    await replacePending(null);
    useUpdater.setState({ status: 'installed', progress: 100 });
    await relaunch();
  } catch (err) {
    logError(`Update failed: ${String(err)}`);
    useUpdater.setState({ status: 'error', progress: null, error: String(err), errorPhase: 'install' });
  }
}

export async function restartAfterUpdate(): Promise<void> {
  if (!isDesktop) return;
  await relaunch();
}

export function connectUpdater() {
  if (!isDesktop || import.meta.env.DEV) return;
  setTimeout(() => {
    void checkForUpdates(true);
  }, STARTUP_CHECK_DELAY_MS);
}
