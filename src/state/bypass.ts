/**
 * Bypass (the B key): hear your sound without CorvidEQ's EQ, to compare. On
 * desktop, eq-file.ts writes a corvid-eq.txt with no filters for that device
 * while it's on, only a preamp that keeps the loudness level (config.txt stays
 * as it is).
 *
 * One per device, like the EQ: it acts on the EQ on screen and nothing else,
 * so comparing headphones never changes your mic on a call. Switching devices
 * shows that device's own state.
 *
 * Saved: Equalizer APO keeps playing that file after the app closes, so the
 * app reopens still bypassed and shows it.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useOutputEqs } from './output-eqs';

/** No device known (the browser, or before the first list is read). */
const NO_DEVICE = 'none';

interface Bypass {
  /** By endpoint GUID; true = EQ switched off for comparison. */
  bypassed: Record<string, boolean>;
}

/** One switch for everything, as older versions saved it: every EQ stays bypassed, so updating changes nothing you hear. */
function fromSharedBypass({ bypass }: { bypass?: boolean }): Bypass {
  const { eqs, editing } = useOutputEqs.getState();
  const guids = bypass ? [...Object.keys(eqs), editing ?? NO_DEVICE] : [];
  return { bypassed: Object.fromEntries(guids.map((guid) => [guid, true])) };
}

export const useBypass = create<Bypass>()(
  persist(
    (): Bypass => ({ bypassed: {} }),
    {
      name: 'corvid-eq-bypass',
      version: 1,
      migrate: (saved) => fromSharedBypass(saved as { bypass?: boolean }),
    },
  ),
);

/** `editing`, not the picked device: this has to match the EQ on screen, and it's known from the first paint. */
const editingKey = () => useOutputEqs.getState().editing ?? NO_DEVICE;

/** Is the EQ on screen bypassed? */
export const isBypassed = () => !!useBypass.getState().bypassed[editingKey()];

/** The same, for a component. */
export function useIsBypassed(): boolean {
  const key = useOutputEqs((s) => s.editing ?? NO_DEVICE);
  return useBypass((s) => !!s.bypassed[key]);
}

/** Bypass the EQ on screen, or stop. */
export function setBypass(on: boolean) {
  useBypass.setState((s) => ({ bypassed: { ...s.bypassed, [editingKey()]: on } }));
}
