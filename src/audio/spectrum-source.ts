/**
 * Where the analyzer's data comes from.
 *
 * It delivers levels in dBFS at SPECTRUM_POINTS log-spaced frequencies from
 * 20 Hz to 20 kHz, and the stereo level (peak and RMS per channel) for the
 * level meter. The drawing code doesn't care where they come from.
 *
 *   desktop  everything the computer plays, captured by the Rust backend
 *            (src-tauri/src/spectrum.rs uses the same grid)
 *   browser  nothing: a web page can't hear the computer's sound, so the
 *            analyzer and meter stay empty there (the browser version is
 *            for working on the UI)
 */
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { Side } from '../eapo/types';

/** Must match GRID_POINTS in src-tauri/src/spectrum.rs. */
export const SPECTRUM_POINTS = 512;
/**
 * The grid's range, which is also the graph's: 20 Hz up to the 20 kHz
 * third-octave band's top edge (22.4 kHz), so every bar fits. Must match
 * GRID_MIN_HZ / GRID_MAX_HZ in spectrum.rs.
 */
export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 22387.2;

/**
 * Bars view: ISO third-octave bands, centres 1000·10^(n/10) Hz for n = -16…13
 * (25 Hz … 20 kHz), edges a twentieth of a decade each side. Must match
 * BAR_BANDS in spectrum.rs, which sends one level per band.
 */
export const BAR_BANDS = Array.from({ length: 30 }, (_, i) => {
  const centre = 1000 * 10 ** ((i - 16) / 10);
  return { centre, lo: centre * 10 ** -0.05, hi: centre * 10 ** 0.05 };
});

/** Stereo level in dBFS (0 = full scale): [left, right]. */
export interface StereoLevel {
  peak: [number, number];
  rms: [number, number];
}

export interface SpectrumSource {
  /** Fill `out` with the newest levels. Returns false if there's nothing live to show. */
  read(out: Float32Array): boolean;
  /** Fill `out` with the newest bar levels (dBFS per BAR_BANDS entry). Same result as `read`. */
  readBars(out: Float32Array): boolean;
  /** Newest stereo level (after the EQ), or null if nothing is playing. */
  level(): StereoLevel | null;
  /**
   * Stereo level before the EQ, or null. Always null for now: Windows only
   * lets us capture the sound after Equalizer APO.
   */
  inputLevel(): StereoLevel | null;
}

/** True when running inside the CorvidEQ desktop app (Tauri), false in a browser. */
export const isDesktop = isTauri();

/** Browser: no sound to show. */
const silentSource = (): SpectrumSource => ({ read: () => false, readBars: () => false, level: () => null, inputLevel: () => null });

// --- Desktop: system audio from Rust -------------------------------------------

/** If no frame arrives for this long (e.g. capture failed), show nothing. */
const STALE_MS = 500;

/** One message from Rust (`Frame` in spectrum.rs). */
interface Frame extends StereoLevel {
  spectrum: number[];
  /** dBFS per BAR_BANDS entry, this frame's power, unsmoothed (see `smoothBars`). */
  bars: number[];
  /** Which side was analyzed (`'L'`, `'R'`, or `null` for both). */
  side: Side | null;
  /** Which device was captured (id from `audio_devices`), null while none is open. */
  device: string | null;
  /** Why nothing is captured, when `device` is null. */
  problem: string | null;
}

/** What the desktop capture is doing right now (for the source picker). */
export interface CaptureInfo {
  device: string | null;
  problem: string | null;
}

/**
 * Settings → Analyzer. `fftMode`: dual = a long FFT for the bass and a 4x
 * shorter one (reacts sooner) for the mids and highs; single = the long one
 * everywhere (4x finer detail up there, slower).
 */
export type FftMode = 'dual' | 'single';
let fftMode: FftMode = 'dual';
export function setFftMode(mode: FftMode) {
  if (mode === fftMode) return;
  fftMode = mode;
  restart?.(); // Rust sets up its FFTs when capture starts
}

/**
 * The bars average power over 125 ms, rising and falling at the same pace
 * (the "Fast" time weighting of sound level meters, as studio analyzers
 * do), so tones and noise read their real level. No "rise at once, fall
 * slowly" as on the line: that made noise rest ~1 dB high (user's choice:
 * the bars show the sound as it is). Per 60 fps frame, keep this much.
 */
const FAST_KEEP = Math.exp(-1 / 60 / 0.125);

/**
 * Rust sends each bar's power in that frame, raw. `power` holds the shown
 * power per bar and is moved toward `rawDb` by one frame.
 */
function smoothBars(power: Float64Array, rawDb: number[]) {
  for (let b = 0; b < power.length; b++) {
    const now = 10 ** ((rawDb[b] ?? -160) / 10);
    power[b] = FAST_KEEP * power[b]! + (1 - FAST_KEEP) * now;
  }
}

/** Desktop: which device to capture (an id from `audio_devices`), null = follow Windows' default output. */
let wantedDevice: string | null = null;
let captureInfo: CaptureInfo = { device: null, problem: null };
let restart: (() => void) | null = null;
let pause: ((paused: boolean) => void) | null = null;
let resetSide: (() => void) | null = null;
const pauseReasons = new Set<string>();

/**
 * Stop capturing (and Rust's FFT) while nothing shows it (e.g. settings page
 * open, or hidden in the tray). Only resumes once every reason clears.
 */
export function setCapturePaused(paused: boolean, reason = 'settings') {
  if (paused) pauseReasons.add(reason);
  else pauseReasons.delete(reason);
  pause?.(pauseReasons.size > 0);
}

/** undefined until first sent: Rust may remember another side from before a reload. */
let analyzerSide: Side | null | undefined;
let balanceGains: [number, number] | undefined;

/**
 * Analyze one channel only (a split EQ's side on screen), or both, averaged
 * (null). The level meter always shows both.
 */
export function setAnalyzerSide(side: Side | null) {
  if (!isDesktop || side === analyzerSide) return;
  analyzerSide = side;
  resetSide?.();
  invoke('set_analyzer_side', { side }).catch((err: unknown) => console.error('Analyzer side:', err));
}

/**
 * Undo Equalizer APO's per-channel speaker balance on analyzer samples so the
 * analyzer reads pre-balance while LevelMeter stays post-balance.
 */
export function setAnalyzerBalance(left: number, right: number) {
  if (!isDesktop || (balanceGains && balanceGains[0] === left && balanceGains[1] === right)) return;
  balanceGains = [left, right];
  invoke('set_analyzer_balance', { left, right }).catch((err: unknown) => console.error('Analyzer balance:', err));
}

/** Capture this device from now on (null = Windows' default output, followed when it changes). */
export function setCaptureDevice(id: string | null) {
  if (id === wantedDevice) return;
  wantedDevice = id;
  restart?.();
}

export const captureStatus = (): CaptureInfo => captureInfo;

/**
 * Told whenever the captured device (or its problem) changes, so the UI can
 * name it as soon as the first frame arrives instead of on the next list
 * refresh. (Audio can't import the state layer; state subscribes here.)
 */
let captureListener: ((info: CaptureInfo) => void) | null = null;
export const onCaptureChange = (fn: (info: CaptureInfo) => void) => { captureListener = fn; };
function setCaptureInfo(info: CaptureInfo) {
  if (info.device === captureInfo.device && info.problem === captureInfo.problem) return;
  captureInfo = info;
  captureListener?.(info);
}

function desktopSource(): SpectrumSource {
  const latest = new Float32Array(SPECTRUM_POINTS).fill(-160);
  const latestBars = new Float32Array(BAR_BANDS.length).fill(-160);
  const barPower = new Float64Array(BAR_BANDS.length);
  let latestLevel: StereoLevel | null = null;
  let lastFrame = 0;
  let spectrumReady = false;
  let started = false;
  let paused = false;
  // Frames still in flight from a stopped capture must not overwrite the new one.
  let generation = 0;

  const start = () => {
    started = true;
    if (paused) return;
    const mine = ++generation;
    const channel = new Channel<Frame>();
    channel.onmessage = (frame) => {
      if (mine !== generation) return;
      latestLevel = { peak: frame.peak, rms: frame.rms };
      setCaptureInfo({ device: frame.device, problem: frame.problem });
      lastFrame = performance.now();
      // Ignore already-queued frames from the previous L/R side after switching.
      if (analyzerSide !== undefined && frame.side !== analyzerSide) return;
      latest.set(frame.spectrum);
      // Smoothed per frame as it arrives (not per screen frame), so the
      // averaging time is the same at any display rate.
      smoothBars(barPower, frame.bars);
      for (let b = 0; b < barPower.length; b++) latestBars[b] = Math.max(-160, 10 * Math.log10(barPower[b]! || 1e-16));
      spectrumReady = true;
    };
    // Starting again stops the previous capture loop (Rust side).
    invoke('start_spectrum', { onFrame: channel, device: wantedDevice, single: fftMode === 'single' }).catch((err: unknown) => {
      console.error('System audio capture failed:', err);
      setCaptureInfo({ device: null, problem: String(err) });
    });
  };
  restart = () => { if (started) start(); };
  resetSide = () => {
    spectrumReady = false;
    latest.fill(-160);
    latestBars.fill(-160);
    barPower.fill(0);
  };
  pause = (p) => {
    if (p === paused) return;
    paused = p;
    if (p) {
      generation++;
      lastFrame = 0;
      spectrumReady = false;
      invoke('stop_spectrum').catch(() => {});
    } else if (started) {
      start();
    }
  };

  return {
    read(out) {
      if (!started) start();
      if (!spectrumReady || performance.now() - lastFrame > STALE_MS) return false;
      out.set(latest);
      return true;
    },

    readBars(out) {
      if (!started) start();
      if (!spectrumReady || performance.now() - lastFrame > STALE_MS) return false;
      out.set(latestBars);
      return true;
    },

    level() {
      if (!started) start();
      return performance.now() - lastFrame > STALE_MS ? null : latestLevel;
    },
    inputLevel: () => null,
  };
}

export const spectrumSource: SpectrumSource = isDesktop ? desktopSource() : silentSource();
