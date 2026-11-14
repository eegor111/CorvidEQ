/**
 * The app's colors. Two UI themes to pick from (Settings → Appearance; Dark
 * is the default); the analyzer and the band rainbow are fixed, the same in
 * every theme (user's choice: they're part of the instrument, not the skin).
 *
 * - ui: the app itself: a mode and three key colors, everything else worked out.
 * - analyzer: the spectrum lines, heat view and the meter's red lights.
 * - bands: the first and last band's color; the rainbow between is generated.
 *
 * Everything else (border strengths, hover, grid, number fields, tints, the
 * curve's shades, the heat ramp's middle…) is DERIVED from these, in
 * index.css and ui/theme/active.ts, so there's nothing to keep in sync.
 * Colors are opaque "#rrggbb"; the app adds any transparency itself. Pure:
 * no storage here (the chosen theme is in state/settings.ts).
 */
export type Hex = string;

/**
 * Dark: light text on dark surfaces, outlines lighter than the surface.
 * Light: the other way round. Same key colors, other tones (active.ts).
 */
export type UiMode = 'dark' | 'light';

/** The secondary accent's hue: its own, or the opposite of the neutral's (it then follows the neutral). */
export type SecondaryHue = 'own' | 'opposite';

export interface UiColors {
  mode: UiMode;
  /**
   * The neutral key color. Only its hue and colorfulness count: the window,
   * panels and text are it at fixed lightness steps, barely colored; the
   * frame (outlines, grid, hover) is it at full colorfulness. One color makes
   * the whole look, the way Material Design builds a theme from a seed color.
   * Stored at the frame's lightness, so the swatch shows the frame.
   */
  neutral: Hex;
  /**
   * Selected / switched on / the main action (yellow). Like the secondary
   * accent, only its hue and colorfulness count: the mode sets its lightness.
   */
  primary: Hex;
  /** The EQ curve, the scales, editable numbers, the preset name (cyan). Its own color: not tied to the neutral. */
  secondary: Hex;
  /**
   * 'opposite': the secondary accent's hue is the neutral's + 180° (red →
   * cyan) and follows it; only its colorfulness is its own. 'own': its hue too.
   */
  secondaryHue: SecondaryHue;
  // Worked out, not given (active.ts): surfaces, frame, the three text tones,
  // and danger (a fixed red, like Material's error color).
}

export interface AnalyzerColors {
  /** The spectrum line ("before" in Pre / Post / Overlay), the meter's red LEDs and the analyzer's labels. */
  analyzer: Hex;
  /** The heat view's own colors, nothing to do with the line: quiet → loud parts. */
  heat: Hex;
  /** Near the top of the heat ramp: the loudest parts but the very peaks. */
  loudest: Hex;
  /** The very top of the heat ramp: a warm white, Fire's answer to Ice's white. */
  hottest: Hex;
  /**
   * The heat view's other palette, Ice: medium, loud, the upper end of loud,
   * icy, ice white, loudest. It stays clear of cyan on the way to white,
   * because the EQ curve is cyan and would vanish against a cyan stripe.
   */
  heatIce: [medium: Hex, loud: Hex, upper: Hex, icy: Hex, white: Hex, loudest: Hex];
  /** The "after the EQ" line in Pre / Post / Overlay. */
  afterEq: Hex;
}

/**
 * The first and last band's color. Bands in between are spread evenly around
 * the color wheel from one to the other (the long way round), so any number
 * of bands gets a rainbow. The SAME color for both = the whole wheel, every
 * neighbour 360°/count apart: the biggest possible difference between bands.
 */
export interface BandColors {
  firstBand: Hex;
  lastBand: Hex;
}

/** What the app is drawn with. */
export interface ThemeColors {
  ui: UiColors;
  analyzer: AnalyzerColors;
  bands: BandColors;
}

/**
 * CorvidEQ's signature color, #FFF000: the brand, used by the app icon and
 * near the top of the heat view's Fire palette. The UI themes use #F3F200
 * for their primary accent.
 */
export const SIGNATURE_YELLOW: Hex = '#fff000';

export type UiThemeId = 'dark' | 'corvideq';

/** The UI themes, in the order the picker shows them. The first is the default. */
export const UI_THEMES: { id: UiThemeId; label: string; colors: UiColors }[] = [
  // A pure gray (no colorfulness: borders, surfaces and text all neutral) with
  // the signature accents: calm, for long sessions. The cyan is its own (a gray has no hue to be opposite of).
  { id: 'dark', label: 'Dark', colors: { mode: 'dark', neutral: '#8e8e8e', primary: '#f3f200', secondary: '#00f0ff', secondaryHue: 'own' } },
  // The signature look: neon red frame, red-tinted panels, electric cyan, yellow accents.
  { id: 'corvideq', label: 'CorvidEQ', colors: { mode: 'dark', neutral: '#f62200', primary: '#f3f200', secondary: '#00f0ff', secondaryHue: 'opposite' } },
];

export const uiTheme = (id: UiThemeId): UiColors => (UI_THEMES.find((t) => t.id === id) ?? UI_THEMES[0]!).colors;

/** The analyzer's colors, in every theme. The line and the heat view each have their own. */
export const ANALYZER: AnalyzerColors = { analyzer: '#ff3c4b', afterEq: '#00f0ff', heat: '#ff3c4b', loudest: SIGNATURE_YELLOW, hottest: '#fdf7d0', heatIce: ['#104aee', '#167afa', '#3291ff', '#a4c5ff', '#f4f6ff', '#ffffff'] };

/**
 * The band rainbow, in every theme: first = last, so the whole wheel is
 * spread over however many bands there are (up to 20: neighbours get close,
 * hover tells them apart).
 */
export const BANDS: BandColors = { firstBand: '#ff8aa0', lastBand: '#ff8aa0' };

export const themeColors = (id: UiThemeId): ThemeColors => ({ ui: uiTheme(id), analyzer: ANALYZER, bands: BANDS });

// --- Hex ---------------------------------------------------------------------

/** "#rrggbb" (lowercase) from "#rgb" / "#rrggbb", with or without "#"; null if it isn't one. */
export function normalizeHex(input: string): Hex | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}

/** "#ff3c4b" → [255, 60, 75]. */
export const hexChannels = (hex: Hex): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** [255, 60, 75] → "#ff3c4b". */
export const channelsHex = (c: number[]): Hex =>
  `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
