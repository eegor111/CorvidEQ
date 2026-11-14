/**
 * The fonts to pick from (Settings → Appearance), each by its real name.
 * Sets `--font` on :root, which styles all text, scales and nodes.
 */

export type FontId = 'oxanium' | 'sans' | 'mono';

export interface FontPreset {
  id: FontId;
  label: string;
  description: string;
  stack: string;
}

export const FONT_PRESETS: Record<FontId, FontPreset> = {
  oxanium: {
    id: 'oxanium',
    label: 'Oxanium',
    description: 'Squared and geometric: CorvidEQ’s own, built in.',
    stack: "'Oxanium', 'Segoe UI', system-ui, sans-serif",
  },
  sans: {
    id: 'sans',
    label: 'Segoe UI',
    description: 'Windows’ own font: plain and neutral.',
    stack: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },
  mono: {
    id: 'mono',
    label: 'Cascadia Code',
    description: 'Monospaced: every digit the same width (Consolas where it isn’t installed).',
    stack: "'Cascadia Code', 'Consolas', ui-monospace, monospace",
  },
};

/** A font id from saved settings; anything unknown (an older version's "custom") = the default, Segoe UI. */
export const knownFont = (id: unknown): FontId => (typeof id === 'string' && id in FONT_PRESETS ? (id as FontId) : 'sans');

export function applyFont(fontId: FontId) {
  document.documentElement.style.setProperty('--font', FONT_PRESETS[knownFont(fontId)].stack);
}
