/**
 * App settings store (Zustand + localStorage persistence).
 *
 * Persists user preferences: the UI theme, the font, a custom Equalizer
 * APO path and the analyzer's FFT mode.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDesktop, setFftMode, type FftMode } from '../audio/spectrum-source';
import { applyTheme } from '../ui/theme/active';
import { applyFont, knownFont, type FontId } from '../ui/theme/fonts';
import { themeColors, UI_THEMES, type UiThemeId } from '../ui/theme/theme';
import { applyStatus, type Status } from './eq-file';

export interface StartupState {
  enabled: boolean;
  minimized: boolean;
}

export interface SettingsState {
  uiTheme: UiThemeId;
  font: FontId;
  customConfigDir: string | null;
  fftMode: FftMode;
  closeToTray: boolean;
  minimizeToTray: boolean;
  startMinimized: boolean;
  setUiTheme(id: UiThemeId): void;
  setFont(font: FontId): void;
  setCustomConfigDir(path: string | null): Promise<void>;
  setFftMode(mode: FftMode): void;
  setCloseToTray(on: boolean): void;
  setMinimizeToTray(on: boolean): void;
  setStartMinimized(on: boolean): void;
}

function syncTrayBehavior(closeToTray: boolean, minimizeToTray: boolean) {
  if (!isDesktop) return;
  invoke('set_tray_behavior', { closeToTray, minimizeToTray }).catch(() => {});
}

export async function getStartupState(): Promise<StartupState> {
  if (!isDesktop) return { enabled: false, minimized: false };
  return invoke<StartupState>('get_startup_state');
}

export async function setStartupState(enabled: boolean, minimized: boolean): Promise<StartupState> {
  if (!isDesktop) return { enabled: false, minimized: false };
  return invoke<StartupState>('set_startup_state', { enabled, minimized });
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      uiTheme: legacyUiTheme(),
      font: 'sans',
      customConfigDir: null,
      fftMode: 'dual',
      closeToTray: false,
      minimizeToTray: false,
      startMinimized: false,
      setUiTheme(id: UiThemeId) {
        // Applied before the store changes: listeners and React then read the new colors.
        applyTheme(themeColors(id));
        set({ uiTheme: id });
      },
      setFont(font: FontId) {
        applyFont(font);
        set({ font });
      },
      setFftMode(mode: FftMode) {
        setFftMode(mode);
        set({ fftMode: mode });
      },
      setCloseToTray(closeToTray: boolean) {
        set({ closeToTray });
        syncTrayBehavior(closeToTray, get().minimizeToTray);
      },
      setMinimizeToTray(minimizeToTray: boolean) {
        set({ minimizeToTray });
        syncTrayBehavior(get().closeToTray, minimizeToTray);
      },
      setStartMinimized(startMinimized: boolean) {
        set({ startMinimized });
      },
      async setCustomConfigDir(path: string | null) {
        set({ customConfigDir: path });
        if (isDesktop) {
          try {
            const status = await invoke<Status>('eapo_set_config_dir', { path });
            applyStatus(status);
          } catch {
            // informative only
          }
        }
      },
    }),
    {
      name: 'corvid-eq-settings',
      onRehydrateStorage: () => (state) => {
        // A theme id an older or newer version saved, that this one lacks: the default.
        if (state && !UI_THEMES.some((t) => t.id === state.uiTheme)) state.uiTheme = UI_THEMES[0]!.id;
        if (state) {
          state.font = knownFont(state.font);
          applyFont(state.font);
          // Before the analyzer starts, so its first capture already uses it.
          if (state.fftMode !== 'single') state.fftMode = 'dual';
          setFftMode(state.fftMode);
          syncTrayBehavior(!!state.closeToTray, !!state.minimizeToTray);
        }
        if (isDesktop && state?.customConfigDir) {
          invoke<Status>('eapo_set_config_dir', { path: state.customConfigDir })
            .then(applyStatus)
            .catch(() => {});
        }
      },
    },
  ),
);

/**
 * Before this setting, the theme was a palette picked by name (kept under
 * "corvid-eq-palettes"): someone who had picked CorvidEQ keeps it.
 */
function legacyUiTheme(): UiThemeId {
  try {
    const old = JSON.parse(localStorage.getItem('corvid-eq-palettes') ?? '{}') as { state?: { active?: { ui?: unknown } } };
    const name = old.state?.active?.ui;
    if (typeof name === 'string' && /^corvid/i.test(name)) return 'corvideq';
  } catch {
    // nothing saved, or not readable
  }
  return UI_THEMES[0]!.id;
}
