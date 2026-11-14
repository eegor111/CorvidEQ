/**
 * Applies the colors two ways:
 * - as CSS variables on <html>, for everything styled in index.css
 * - as plain values here, for code that draws colors itself (SVG fills,
 *   the canvas analyzer)
 */
import { channelsHex, hexChannels, normalizeHex, themeColors, UI_THEMES, type Hex, type ThemeColors, type UiColors, type UiMode } from './theme';

/** "#ff3c4b" → "255 60 75": CSS can then add any transparency, rgb(var(--x-rgb) / 0.5). */
const rgb = (hex: Hex) => hexChannels(hex).join(' ');

/** What the app is drawn with, as "r g b" triplets. */
interface Current {
  frame: string;
  primary: string;
  secondary: string;
  analyzer: string;
  heat: string;
  loudest: string;
  hottest: string;
  heatIce: string[];
  afterEq: string;
  firstBand: string;
  lastBand: string;
}

// Set from the default palettes at the end of this file, once every helper below exists.
let current: Current;
let heatRamp: string[] = [];
let heatIceRamp: string[] = [];
/** Band colors for the current number of bands ("r g b"), see setBandCount(). */
let palette: string[] = [];
let paletteCount = 0;

function toCurrent({ ui, analyzer, bands }: ThemeColors): Current {
  const n = resolveUi(ui);
  return {
    frame: rgb(n.frame),
    primary: rgb(n.primary),
    secondary: rgb(n.secondary),
    analyzer: rgb(analyzer.analyzer),
    heat: rgb(analyzer.heat),
    loudest: rgb(analyzer.loudest),
    hottest: rgb(analyzer.hottest),
    heatIce: analyzer.heatIce.map(rgb),
    afterEq: rgb(analyzer.afterEq),
    firstBand: rgb(bands.firstBand),
    lastBand: rgb(bands.lastBand),
  };
}

export function applyTheme(theme: ThemeColors) {
  current = toCurrent(theme);
  heatRamp = buildHeatRamp(heatStops(current));
  heatIceRamp = buildHeatRamp(heatIceStops(current));
  palette = buildPalette(current, paletteCount || 7);

  const n = resolveUi(theme.ui);
  const vars: Record<string, string> = {
    '--bg': n.background,
    // Surface levels: 0 = the window, 1 = panels (bottom bar, band panel,
    // settings sections), 2 = things ON a panel (buttons, inputs, fader bars).
    // Each is see-through over the level below it, so they never stack.
    '--surface': glassFor(n.surface, n.background),
    '--surface-raised': glassFor(n.raised, n.surface),
    // Level 1 without the see-through: for what sits over the dimmed app
    // (--surface only looks right on the window).
    '--surface-solid': n.surface,
    '--text': n.text,
    '--text-dim': n.textSecondary,
    '--text-faint': n.textFaint,
    // Text on the primary accent (a yellow button): whichever end of the
    // range stands out more from it, window or text.
    '--on-selected': farther(n.primary, n.background, n.text),
    '--base-rgb': current.frame,
    '--accent-rgb': current.secondary,
    '--selected-rgb': current.primary,
    '--danger-rgb': rgb(n.danger),
    // The analyzer's own red, for its labels in CSS (canvas: spectrumColor()).
    '--analyzer-rgb': current.analyzer,
    // Small text in a color: the scales' numbers, the EQ curve.
    '--scale': labelColor(n.secondary, n.text, 0.35, 4),
    '--curve': labelColor(n.secondary, n.text, 0.25, 4),
    // Outlines: the frame color laid over the surface, opaque (see edgeColor).
    // Plain edge < clickable thing's edge < strong edge (menus) < hover.
    '--edge': edgeColor(n.surface, n.frame, 0.24),
    '--edge-button': edgeColor(n.surface, n.frame, 0.34),
    '--edge-strong': edgeColor(n.surface, n.frame, 0.43),
    '--hover': edgeColor(n.surface, n.frame, 0.75),
  };
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
}

/**
 * Panels and boxes are see-through, so they sit on whatever is behind them
 * (the graph, the analyzer). The palette gives the surface as an opaque color
 * (how it looks on the background); this finds the most see-through color
 * that looks exactly like that on the background: the smallest opacity at
 * which some color can still reach it, and that color.
 */
function glassFor(surface: Hex, bg: Hex): string {
  const s = hexChannels(surface);
  const b = hexChannels(bg);
  const alpha = Math.max(...s.map((v, i) => {
    const d = v - b[i]!;
    return d > 0 ? d / (255 - b[i]!) : d < 0 ? -d / b[i]! : 0;
  }));
  if (alpha <= 0) return 'transparent';
  const c = s.map((v, i) => Math.round(b[i]! + (v - b[i]!) / alpha));
  return `rgb(${c.join(' ')} / ${alpha.toFixed(4)})`;
}

/**
 * Tones: the OKLCH lightness of each worked-out color, per mode. Every
 * palette of a mode gets the same tones; the neutral key color only gives
 * them its hue and colorfulness, the way Material Design builds both its
 * themes from one seed color. Dark: surface levels get lighter going up, the
 * frame is lighter than them. Light: the window is nearly white, levels get
 * darker going up, the frame is darker than them (Material's way too).
 * The accents: see accentTone().
 */
function tonesFor(mode: UiMode) {
  return mode === 'light'
    ? { background: 0.97, surface: 0.94, raised: 0.91, frame: 0.5, text: 0.25, textSecondary: 0.45, danger: 0.52 }
    : { background: 0.145, surface: 0.175, raised: 0.215, frame: FRAME_TONE, text: 0.93, textSecondary: 0.75, danger: 0.68 };
}

/** The neutral key color's lightness as stored (= dark mode's frame). */
const FRAME_TONE = 0.62;

/**
 * An accent's lightness: where its hue can be most colorful (the "cusp" of
 * the screen's colors: yellow is most vivid nearly white, blue quite dark),
 * kept inside the mode's readable range (dark mode: light enough to stand
 * out from the window; light mode: dark enough). One fixed tone for every
 * hue would leave most hues washed out: at a lightness that suits yellow,
 * blue or red can only be pastel. The dark range's top is Corvid's yellow,
 * so the brand comes out exact.
 */
function accentTone(mode: UiMode, hue: number): number {
  const [lo, hi] = mode === 'light' ? [0.45, 0.6] : [0.7, 0.931];
  return Math.min(hi, Math.max(lo, cuspLightness(hue)));
}

/** Cusp lightness per half degree of hue: worked out once each (a search), then remembered. */
const cusps = new Map<number, number>();
function cuspLightness(hue: number): number {
  const key = Math.round(hue * 2) / 2;
  let l = cusps.get(key);
  if (l === undefined) {
    // Most colorful lightness: colorfulness rises, then falls, so narrow in on the peak.
    let lo = 0.05;
    let hi = 0.99;
    for (let i = 0; i < 40; i++) {
      const a = lo + (hi - lo) / 3;
      const b = hi - (hi - lo) / 3;
      if (maxChroma(a, key) < maxChroma(b, key)) lo = a;
      else hi = b;
    }
    l = (lo + hi) / 2;
    cusps.set(key, l);
  }
  return l;
}

/** The palette's key colors. Each is stored at its dark-mode lightness, so a file's hex is the color as dark mode draws it. */
export type KeyRole = 'neutral' | 'primary' | 'secondary';
const storedTone = (role: KeyRole, hue: number) => (role === 'neutral' ? FRAME_TONE : accentTone('dark', hue));
/** How much of the key's colorfulness surfaces and text keep: a tint, not a color. */
const TINT = 0.1;
/**
 * The window and panels keep less: they're big areas, so even a faint tint
 * reads as "everything is red", and a colorful neutral should show in the
 * frame and text, not flood the background.
 */
const SURFACE_TINT = 0.03;
/** The window (the bottom level) keeps none: a plain gray, so the panels' tint is all the color there is. */
const BACKGROUND_TINT = 0;
/** Danger: a fixed red, whatever the palette (Material keeps its error color fixed too). */
const DANGER = { hue: 27, chroma: 0.2 };

/** The UI palette as drawn: every color worked out. */
export interface UiResolved {
  background: Hex;
  surface: Hex;
  raised: Hex;
  frame: Hex;
  text: Hex;
  textSecondary: Hex;
  textFaint: Hex;
  primary: Hex;
  secondary: Hex;
  danger: Hex;
}

export function resolveUi(ui: UiColors): UiResolved {
  const t = tonesFor(ui.mode);
  const [, c, h] = lchOf(ui.neutral);
  const tint = (l: number, k = TINT) => hexOf([l, c * k, h]);
  // An accent at the mode's lightness for its hue, with its own colorfulness.
  const accent = (hex: Hex) => { const { hue, colorfulness } = keyColorParts(hex); return atTone(accentTone(ui.mode, hue), hue, colorfulness); };
  const background = tint(t.background, BACKGROUND_TINT);
  const text = tint(t.text);
  const frame = hexOf([t.frame, c, h]);
  return {
    background,
    surface: tint(t.surface, SURFACE_TINT),
    raised: tint(t.raised, SURFACE_TINT),
    frame,
    text,
    // A little more color than the text, so it reads as the quieter voice, not just grayer.
    textSecondary: tint(t.textSecondary, TINT * 1.5),
    textFaint: faintText(background, text),
    primary: accent(ui.primary),
    // normalizeHex: a palette kept in local storage by an older version may still say "auto".
    secondary: accent(secondaryKey(ui)),
    danger: hexOf([t.danger, DANGER.chroma, DANGER.hue]),
  };
}

/** The most colorful the screen can show at this lightness and hue. */
function maxChroma(l: number, h: number): number {
  return fitGamut([l, 0.4, h])[1];
}

/**
 * A key color's hue (0…360) and colorfulness: 0…1 of the most the screen can
 * show at its lightness and hue. A share, not an amount, because the room
 * differs: a light blue can't be very colorful, a light yellow can. So moving
 * a color to another lightness keeps it as vivid as it can be there.
 */
export function keyColorParts(hex: Hex): { hue: number; colorfulness: number } {
  const [l, c, h] = lchOf(hex);
  return { hue: h, colorfulness: Math.min(1, c / Math.max(1e-6, maxChroma(l, h))) };
}

/** A color from lightness, hue and colorfulness (a share, see keyColorParts). */
function atTone(l: number, hue: number, colorfulness: number): Hex {
  return hexOf([l, maxChroma(l, hue) * colorfulness, hue]);
}

/** A key color from hue and colorfulness, at the tone it's stored at (dark mode's). */
export function keyColor(role: KeyRole, hue: number, colorfulness: number): Hex {
  return atTone(storedTone(role, hue), hue, colorfulness);
}

/**
 * The secondary accent's key color as the palette means it: with
 * secondaryHue 'opposite', the neutral's hue + 180° and its own
 * colorfulness; else as stored. (normalizeHex: a palette kept in local
 * storage by an older version may still say "auto".)
 */
export function secondaryKey(ui: UiColors): Hex {
  const own = normalizeHex(ui.secondary) ?? UI_THEMES[0]!.colors.secondary;
  if (ui.secondaryHue !== 'opposite') return own;
  return keyColor('secondary', (keyColorParts(ui.neutral).hue + 180) % 360, keyColorParts(own).colorfulness);
}

/** Whichever of `a` / `b` differs more in lightness from `color`: the readable text color on it. */
function farther(color: Hex, a: Hex, b: Hex): Hex {
  const l = lchOf(color)[0];
  return Math.abs(lchOf(a)[0] - l) >= Math.abs(lchOf(b)[0] - l) ? a : b;
}

/**
 * Faint text (the least important text, switched-off things): halfway
 * between the background and the text, in lightness and colorfulness, with
 * the text's hue. Always readable, always clearly quieter than the text.
 */
function faintText(background: Hex, text: Hex): Hex {
  const b = lchOf(background);
  const t = lchOf(text);
  return hexOf([(b[0] + t[0]) / 2, (b[1] + t[1]) / 2, t[2]]);
}

/**
 * An outline: `t` of the way from the surface to the frame color, in OKLCH
 * (lightness and colorfulness blend, the hue is the frame's). Opaque, so an
 * outline is the same color on any panel, and it belongs to the surface it
 * sits on: a lighter surface gets lighter outlines. Dark mode's frame is
 * lighter than its surfaces, so outlines are lighter than the panel; light
 * mode's is darker (the standard both ways, e.g. Material's outline tones).
 */
function edgeColor(surface: Hex, frame: Hex, t: number): Hex {
  const s = lchOf(surface);
  const f = lchOf(frame);
  return hexOf([s[0] + (f[0] - s[0]) * t, s[1] + (f[1] - s[1]) * t, f[2]]);
}

/** Roughly where yellow sits on the OKLCH hue wheel. */
const YELLOW_HUE = 110;

/**
 * A color as small text: lightened `t` of the way toward the text's
 * lightness, a little less colorful, and its hue turned `turn` degrees toward
 * yellow. That turn is what light does to color in nature (sunlit things look
 * warmer); lightening red without it, or mixing in white, turns it pink.
 */
function labelColor(color: Hex, text: Hex, t: number, turn: number): Hex {
  const [l, c, h] = lchOf(color);
  return hexOf([l + (lchOf(text)[0] - l) * t, c * 0.85, turnToward(h, YELLOW_HUE, turn)]);
}

/**
 * Call when the number of bands changes (main.tsx follows the store), so
 * bandColor() spreads the rainbow over the new count.
 */
export function setBandCount(count: number) {
  if (count === paletteCount) return;
  paletteCount = count;
  palette = buildPalette(current, count);
}

/** Band color (band index 0…count-1) with optional transparency. */
export const bandColor = (index: number, alpha = 1) =>
  `rgb(${palette[Math.min(index, palette.length - 1)] ?? current.firstBand} / ${alpha})`;

/** Analyzer line color with transparency. */
export const spectrumColor = (alpha: number) => `rgb(${current.analyzer} / ${alpha})`;

/** The analyzer's "after the EQ" line in before/after view. */
export const afterColor = (alpha: number) => `rgb(${current.afterEq} / ${alpha})`;

/**
 * Before/after view: the sound both have in common, a blend of the analyzer
 * (red) and after-EQ (cyan) colors. Blended straight, those make a dull
 * grey-blue; going round the color wheel the other way (through magenta)
 * gives a vivid violet.
 */
export const sharedColor = (alpha: number) => `rgb(${blendViaViolet(current.analyzer, current.afterEq)} / ${alpha})`;

/**
 * Level meter zones, the classic mixer colors taken from the palettes: green =
 * the band rainbow's green, yellow = primary, red = the analyzer's red.
 */
export function meterColor(zone: 'green' | 'yellow' | 'red', alpha: number): string {
  const c = zone === 'green' ? paletteAt(current, 150) : zone === 'yellow' ? current.primary : current.analyzer;
  return `rgb(${c} / ${alpha})`;
}

/** Heat view color for a level 0…1, Fire palette. */
export const heatColor = (t: number) => heatRamp[Math.round(Math.max(0, Math.min(1, t)) * 255)]!;

/** Heat view color for a level 0…1, Ice palette. */
export const heatIceColor = (t: number) => heatIceRamp[Math.round(Math.max(0, Math.min(1, t)) * 255)]!;

/** A point on a heat ramp: position 0…1, color, opacity. */
type HeatStop = [position: number, color: Lch, opacity: number];

/**
 * Heat ramp, quiet → loud: invisible → heat (red) → loudest (yellow) →
 * hottest (warm white), with opacity rising along the way. Red blends into yellow in OKLCH (lightness,
 * colorfulness and hue each move evenly, the hue the short way: through
 * orange), so the orange stays vivid. The stops climb in even-looking steps
 * (a long flat orange made most loud notes look the same) and reach white as
 * soon as Ice does, so the peaks get whitish highlights as often.
 */
function heatStops(c: Current): HeatStop[] {
  const base = toLch(parse(c.heat));
  const top = toLch(parse(c.loudest));
  const toward = (t: number) => mixLch(base, top, t);
  return [
    [0, base, 0],
    [0.4, base, 0.15], // quiet: faint red
    [0.65, base, 0.55], // medium: red
    [0.78, toward(0.1), 0.9], // loud: bright red
    [0.84, toward(0.35), 1], // orange
    [0.89, toward(0.65), 1], // amber
    [0.93, top, 1], // yellow
    [0.97, toLch(parse(c.hottest)), 1], // warm white, from here up
    [1, toLch(parse(c.hottest)), 1],
  ];
}

/** The Ice palette, quiet → loud: deep blue → azure → icy blue → white. */
function heatIceStops(c: Current): HeatStop[] {
  const color = (i: number) => toLch(parse(c.heatIce[i]!));
  return [
    [0, color(0), 0],
    [0.4, color(0), 0.15],
    [0.65, color(0), 0.55],
    [0.78, color(1), 0.9],
    [0.86, color(2), 1],
    [0.92, color(3), 1],
    [0.97, color(4), 1],
    [1, color(5), 1],
  ];
}

/** 256 precomputed steps between a ramp's stops: drawing is then a lookup. */
function buildHeatRamp(stops: HeatStop[]): string[] {
  return Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    const k = Math.max(0, stops.findIndex((s) => s[0] >= t) - 1);
    const a = stops[k]!;
    const b = stops[Math.min(k + 1, stops.length - 1)]!;
    const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    const alpha = a[2] + (b[2] - a[2]) * f;
    return `rgb(${toRgb(fitGamut(mixLch(a[1], b[1], f)))} / ${alpha.toFixed(3)})`;
  });
}

// --- Band rainbow ---------------------------------------------------------------
//
// Colors are blended in OKLCH, a color space built so that equal steps LOOK
// equal (plain HSL crowds the greens together: several bands looked alike).
// L = lightness, C = colorfulness, h = hue angle.

type Lch = [l: number, c: number, h: number];
const parse = (rgb: string) => rgb.split(' ').map(Number) as [number, number, number];

const toLinear = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLinear = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};

function toLch(rgb: [number, number, number]): Lch {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** OKLCH → linear sRGB (0…1 inside the screen's colors, outside them beyond). */
function toLinearRgb([L, C, h]: Lch): number[] {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function toRgb(lch: Lch): string {
  return toLinearRgb(lch).map(fromLinear).join(' ');
}

/**
 * A screen can't show every OKLCH color (very light AND very colorful, say).
 * Cutting each channel to 0…255 would shift the hue; this keeps lightness and
 * hue and lowers the colorfulness just enough instead (halving the search
 * 20 times), the standard way to bring a color into the screen's range.
 */
function fitGamut([L, C, h]: Lch): Lch {
  const inside = (c: number) => toLinearRgb([L, c, h]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (inside(C)) return [L, C, h];
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return [L, lo, h];
}

function lchOf(hex: Hex): Lch {
  return toLch(hexChannels(hex));
}
function hexOf(lch: Lch): Hex {
  return channelsHex(toRgb(fitGamut(lch)).split(' ').map(Number));
}

/** `t` of the way from a to b: lightness and colorfulness straight, the hue the short way round. */
function mixLch(a: Lch, b: Lch, t: number): Lch {
  const d = ((b[2] - a[2] + 540) % 360) - 180;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] + d * t + 360) % 360];
}

/** Hue `h` turned up to `deg` degrees toward `target`, the short way round. */
function turnToward(h: number, target: number, deg: number): number {
  const d = ((target - h + 540) % 360) - 180;
  return (h + Math.sign(d) * Math.min(Math.abs(d), deg) + 360) % 360;
}

/**
 * `count` colors from firstBand to lastBand: hue goes the long way round the
 * color wheel (red → yellow → green → blue → violet) in equal-looking steps;
 * lightness and colorfulness blend from one end to the other.
 */
function buildPalette(c: Current, count: number): string[] {
  const a = toLch(parse(c.firstBand));
  const b = toLch(parse(c.lastBand));
  let span = b[2] - a[2];
  if (span <= 0) span += 360; // always travel forward through the rainbow
  // Same start and end color = the whole color wheel. Then the last band
  // stops one step short of the first, so neighbours are as far apart as
  // possible (360° / count each) and no two bands share a color.
  const fullWheel = span === 360;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : fullWheel ? i / count : i / (count - 1);
    return toRgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] + span * t) % 360]);
  });
}

/** The rainbow's color at a given hue (with the start color's lightness and colorfulness). */
function paletteAt(cur: Current, hue: number): string {
  const [l, c] = toLch(parse(cur.firstBand));
  return toRgb([l, c, hue]);
}

/** Midpoint of two colors in OKLCH, taking the way round the hue wheel that passes violet (~300°). */
function blendViaViolet(a: string, b: string): string {
  const [la, ca, ha] = toLch(parse(a));
  const [lb, cb, hb] = toLch(parse(b));
  const d = ((hb - ha + 540) % 360) - 180; // shortest signed hue distance
  const mids = [ha + d / 2, ha + d / 2 + 180].map((h) => (h + 360) % 360);
  const dist = (h: number) => Math.abs(((h - 300 + 540) % 360) - 180);
  const h = dist(mids[0]!) <= dist(mids[1]!) ? mids[0]! : mids[1]!;
  return toRgb([(la + lb) / 2, Math.max(ca, cb), h]);
}

current = toCurrent(themeColors(UI_THEMES[0]!.id));
