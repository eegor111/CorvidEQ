/**
 * Desktop only: CorvidEQ and Equalizer APO.
 *
 * - Keeps CorvidEQ's own file (`corvid-eq.txt` in Equalizer APO's config
 *   folder) in sync with the EQ. On its own that changes nothing you hear.
 * - `switchOn()` / `switchOff()` make Equalizer APO use that file or go back
 *   to the previous setup (Rust saves and restores `config.txt` exactly; see
 *   src-tauri/src/eapo.rs). CorvidEQ's EQ keeps working after the app closes.
 * - The status is re-read every few seconds, so a change made by another app
 *   shows up here too.
 * - The file holds one EQ per output or input (output-eqs.ts); a device that's
 *   bypassed (B) has none. After that, each output's balance and delay
 *   (stereo.ts), bypassed or not.
 *
 * Writes are throttled (at most one every WRITE_EVERY_MS): dragging a node
 * changes the EQ ~60 times a second, but Equalizer APO reloads the whole file
 * on every change, so ~15 writes a second is plenty and much lighter.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { isDesktop, setAnalyzerBalance } from '../audio/spectrum-source';
import { loudnessGain } from '../dsp/response';
import { serializeOutputs } from '../eapo/format';
import { FLAT_STEREO, LIMITS, balanceCuts, type EqSettings } from '../eapo/types';
import { targetDevice, useAudioSource } from './audio-source';
import { logError } from './error-log';
import { outputSections, useOutputEqs } from './output-eqs';
import { useBypass } from './bypass';
import { stereoSections, useStereo } from './stereo';
import { appliedSettings, useEq } from './store';
import { isWindowIdle, onWindowResume } from './window-idle';

const WRITE_EVERY_MS = 66;

export interface EqFileStatus {
  state: 'idle' | 'saved' | 'error';
  /** Full path of the file, once known. */
  path?: string;
  /** Readable reason, when state is 'error'. */
  error?: string;
  /** Does config.txt include our file (Equalizer APO actually uses it)? */
  included?: boolean;
  /** The folder in use. */
  configDir?: string;
  /** Does that folder exist (is Equalizer APO installed)? */
  installed?: boolean;
  /** Whether a saved copy of config.txt exists. */
  hasBackup?: boolean;
  /** Was Equalizer APO's Device Selector found? */
  deviceSelector?: boolean;
  /** Where it is, or where we looked. */
  deviceSelectorPath?: string;
  /** A switch on/off is running. */
  switching?: boolean;
  /** Why the last switch failed. */
  switchError?: string;
}

export interface Status {
  configDir: string;
  installed: boolean;
  filePath: string;
  included: boolean;
  hasBackup: boolean;
  deviceSelector: boolean;
  deviceSelectorPath: string;
}

const STATUS_EVERY_MS = 3000;

export const applyStatus = (s: Status) =>
  useEqFile.setState({
    included: s.included,
    configDir: s.configDir,
    installed: s.installed,
    path: s.filePath,
    hasBackup: s.hasBackup,
    deviceSelector: s.deviceSelector,
    deviceSelectorPath: s.deviceSelectorPath,
  });

export async function refreshStatus() {
  try {
    applyStatus(await invoke<Status>('eapo_status'));
  } catch {
    // Status is informative only; the next tick tries again.
  }
}

async function runSwitch(command: 'eapo_switch_on' | 'eapo_switch_off') {
  useEqFile.setState({ switching: true, switchError: undefined });
  try {
    applyStatus(await invoke<Status>(command));
  } catch (err) {
    useEqFile.setState({ switchError: String(err) });
    await refreshStatus();
  } finally {
    useEqFile.setState({ switching: false });
  }
}

/** Make Equalizer APO use CorvidEQ (your config.txt is saved first). */
export const switchOn = () => runSwitch('eapo_switch_on');
/** Give Equalizer APO back your previous config.txt, exactly as it was. */
export const switchOff = () => runSwitch('eapo_switch_off');

/** Open the current Equalizer APO config folder in Windows Explorer. */
export async function openConfigFolder(): Promise<void> {
  if (!isDesktop) return;
  await invoke('open_config_folder');
}

/** Show CorvidEQ's source code in the browser. */
export async function openSourceWebsite(): Promise<void> {
  if (!isDesktop) return;
  await invoke('open_source_website');
}

/** Show CorvidEQ's issue tracker in the browser, to report a problem. */
export async function openIssuesWebsite(): Promise<void> {
  if (!isDesktop) return;
  await invoke('open_issues_website');
}

/** Open the FFT explainer video from Settings → Analyzer in the browser. */
export async function openFftVideo(): Promise<void> {
  if (!isDesktop) return;
  await invoke('open_fft_video');
}

export const useEqFile = create<EqFileStatus>(() => ({ state: 'idle' }));

/**
 * While bypassed (B): no filters, only a preamp at the EQ's overall loudness,
 * so the flip changes the tone and not the volume. Never above 0 dB: raising
 * unfiltered music could clip, so an EQ louder than bypass stays a bit louder.
 */
const bypassed = (eq: EqSettings): EqSettings => {
  // Split: the two sides' average, as one preamp, so the balance stays put.
  const loudness = eq.split?.on ? (loudnessGain(eq) + loudnessGain({ ...eq, bands: eq.split.other })) / 2 : loudnessGain(eq);
  return { preamp: Math.min(0, loudness), bands: [] };
};

/**
 * What corvid-eq.txt holds: what you hear (a solo reaches Equalizer APO too),
 * one section per output. It stays like this after the app closes, bypass and solo included; both
 * are saved, so the app reopens showing what Equalizer APO plays meanwhile.
 */
function fileText(): string {
  const off = useBypass.getState().bypassed;
  const sections = outputSections(appliedSettings(useEq.getState()))
    .map((s) => (s.guids.some((guid) => off[guid]) ? { ...s, settings: bypassed(s.settings) } : s));
  return serializeOutputs(sections, stereoSections(useOutputEqs.getState().seen));
}

const undoGain = (cutDb: number) =>
  cutDb === 0 ? 1 : cutDb <= LIMITS.balance.min ? 0 : 10 ** (-cutDb / 20);

function connectAnalyzerBalance() {
  const sync = () => {
    const included = useEqFile.getState().included === true;
    const src = useAudioSource.getState();
    const device = (src.capture.device ? src.devices.find((d) => d.id === src.capture.device) : undefined) ?? targetDevice(src);
    const channels = device?.format?.channels ?? 2;
    if (!included || !device?.guid || device.eapo.length === 0 || channels !== 2) {
      setAnalyzerBalance(1, 1);
      return;
    }
    const { balance } = useStereo.getState().outputs[device.guid] ?? FLAT_STEREO;
    const { left, right } = balanceCuts(balance);
    setAnalyzerBalance(undoGain(left), undoGain(right));
  };
  sync();
  useStereo.subscribe(sync);
  useAudioSource.subscribe(sync);
  useEqFile.subscribe(sync);
}

export function connectEqFile() {
  if (!isDesktop) return;

  let pending: string | null = null; // newest text not written yet
  let lastWritten = '';
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;

  const flush = async () => {
    timer = undefined;
    if (pending === null || writing) return;
    const text = pending;
    pending = null;
    writing = true;
    lastAt = Date.now();
    try {
      const path = await invoke<string>('write_eq_file', { text });
      lastWritten = text;
      useEqFile.setState({ state: 'saved', path, error: undefined });
    } catch (err) {
      useEqFile.setState({ state: 'error', error: String(err) });
      logError(`Couldn't write corvid-eq.txt: ${String(err)}`);
    } finally {
      writing = false;
      if (pending !== null) schedule(); // changes arrived while writing
    }
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, WRITE_EVERY_MS - (Date.now() - lastAt)));
  };

  const queue = () => {
    const text = fileText();
    if (text === lastWritten) return;
    pending = text;
    schedule();
  };

  queue(); // write once at startup
  useEq.subscribe((s, prev) => { if (s.settings !== prev.settings || s.soloId !== prev.soloId) queue(); });
  useOutputEqs.subscribe(queue);
  useStereo.subscribe(queue);
  useBypass.subscribe(queue);
  connectAnalyzerBalance();

  void refreshStatus();
  setInterval(() => {
    if (!isWindowIdle()) void refreshStatus();
  }, STATUS_EVERY_MS);
  onWindowResume(() => void refreshStatus());
}
