/**
 * Desktop only: which audio device the analyzer and level meter listen to,
 * and what Windows says about each output and input (src-tauri/src/devices.rs).
 *
 * The facts shown are read, not guessed:
 * - volume control in the device (hardware) or in Windows (software). This
 *   decides whether the capture has to undo the Windows volume (devices.rs).
 * - whether Equalizer APO is loaded on that device, and in which slot.
 * - the mix format Windows delivers.
 *
 * The output picked is remembered (null = follow Windows' default output). An
 * input isn't: listening to one opens it, so Windows shows the mic as in use
 * and a Bluetooth headset drops to call quality, and that must not happen by
 * itself at every start. The app starts on the output, and the input's EQ
 * keeps playing from the file either way.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { captureStatus, isDesktop, onCaptureChange, setCaptureDevice, type CaptureInfo } from '../audio/spectrum-source';
import { DISPLAY_SAMPLE_RATE } from '../dsp/response';

/** One output or input, as `audio_devices` reports it (`DeviceInfo` in devices.rs). */
export interface DeviceInfo {
  id: string;
  /** Windows' endpoint GUID: what Equalizer APO's `Device:` lines match on (null if unreadable). */
  guid: string | null;
  name: string;
  /** A microphone or line in (true), or an output (false). */
  input: boolean;
  /** Windows' default output (never an input). */
  isDefault: boolean;
  volume: {
    /** The device turns the volume down itself (true) or Windows scales the samples (false). */
    hardware: boolean;
    hardwareMute: boolean;
    db: number;
    percent: number;
    muted: boolean;
  } | null;
  /** Equalizer APO's slots on this device; empty = not loaded there. */
  eapo: string[];
  format: { sampleRate: number; channels: number; sampleFormat: string } | null;
}

interface AudioSource {
  /** Picked output id, or null = follow Windows' default. */
  choice: string | null;
  /** Picked input id: listened to instead of `choice`. Never saved (see above). */
  input: string | null;
  devices: DeviceInfo[];
  /**
   * Devices that got Equalizer APO while the app ran. The registry says so as
   * soon as OK is clicked in its Device Selector, but it only starts working once
   * Windows restarts, and nothing readable tells the two apart. Not saved.
   */
  restartNeeded: string[];
  /** What the capture is doing (refreshed with the list). */
  capture: CaptureInfo;
  listError?: string;
  choose(id: string | null): void;
  chooseInput(id: string): void;
  refresh(): Promise<void>;
}

export const useAudioSource = create<AudioSource>()(
  persist(
    (set, get) => ({
      choice: null,
      input: null,
      devices: [],
      restartNeeded: [],
      capture: { device: null, problem: null },
      choose(id) {
        set({ choice: id, input: null });
        setCaptureDevice(id);
      },
      chooseInput(id) {
        set({ input: id });
        setCaptureDevice(id);
      },
      async refresh() {
        if (!isDesktop) return;
        try {
          const devices = await invoke<DeviceInfo[]>('audio_devices');
          const { devices: before, restartNeeded } = get();
          const added = devices.filter((d) => d.eapo.length > 0 && before.some((b) => b.id === d.id && b.eapo.length === 0));
          set({
            devices,
            capture: captureStatus(),
            listError: undefined,
            ...(added.length > 0 && { restartNeeded: [...restartNeeded, ...added.map((d) => d.id)] }),
          });
        } catch (err) {
          set({ capture: captureStatus(), listError: String(err) });
        }
      },
    }),
    {
      name: 'corvid-eq-audio-source',
      partialize: (s) => ({ choice: s.choice }),
    },
  ),
);

/** The device you're listening to: the input picked, else the output picked, else Windows' default. */
export function targetDevice({ choice, input, devices }: Pick<AudioSource, 'choice' | 'input' | 'devices'>): DeviceInfo | undefined {
  const id = input ?? choice;
  return id === null ? devices.find((d) => d.isDefault) : devices.find((d) => d.id === id);
}

/** Sample rate of the device being captured (Windows' mix format), or null while unknown. */
export function capturedRate({ devices, capture }: Pick<AudioSource, 'devices' | 'capture'>): number | null {
  return devices.find((d) => d.id === capture.device)?.format?.sampleRate ?? null;
}

/**
 * The rate EQ curves are drawn at: the captured device's, as Equalizer APO
 * designs its filters for it (near the top, 44.1 and 48 kHz curves differ),
 * else 48 kHz (browser, nothing captured yet).
 */
export const curveRate = (s: Pick<AudioSource, 'devices' | 'capture'>) => capturedRate(s) ?? DISPLAY_SAMPLE_RATE;

// Local storage is read synchronously, before the analyzer starts.
setCaptureDevice(useAudioSource.getState().choice);
// Name the captured device as soon as the capture reports it (the list read
// at startup usually comes back before the first frame does).
onCaptureChange((capture) => useAudioSource.setState({ capture }));
