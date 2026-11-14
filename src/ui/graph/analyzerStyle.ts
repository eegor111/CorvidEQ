/**
 * How the analyzer's level views are drawn, shared by the line (Spectrum.tsx)
 * and the bars (Bars.tsx) so the two look the same: the red level (before
 * the EQ, or the only one), the cyan "after" level, the glow under them, and
 * peak hold.
 */
import { isDesktop } from '../../audio/spectrum-source';
import { isBypassed } from '../../state/bypass';
import { useEqFile } from '../../state/eq-file';

/**
 * Draw at (at least) twice the screen resolution and let the browser scale
 * down. Thin, steep line segments then look continuous instead of broken
 * ("aliasing"), the same idea as supersampling in games.
 */
export const SUPERSAMPLE = 2;
/** Peak hold: a high stays put this long, then falls at PEAK_FALL dB per second. */
export const PEAK_HOLD_MS = 1000;
export const PEAK_FALL = 18;
/** Peak hold is drawn this thick (the line's hold line, the bars' caps). */
export const HOLD_WIDTH = 2;
/** The red level: its line (alpha, width) and its peak hold (alpha). */
export const BEFORE = { line: 0.85, width: 2.5, hold: 0.75 };
/**
 * Before/after: the red "before" line is the main one; the cyan "after" line
 * is secondary, so it's thinner and dimmer (cyan is brighter to the eye than
 * red and would otherwise take over). Alphas, glow strength and width.
 */
export const AFTER = { line: 0.4, fill: 0.45, hold: 0.3, width: 1.5 };

/**
 * Glow under a level, for a box `height` px tall: strong near the top,
 * fading toward the bottom, the same for every column or bar, so quiet
 * parts are faint. `k` scales its strength (the cyan "after" glow is kept
 * faint, see AFTER).
 */
export function glow(g: CanvasRenderingContext2D, color: (alpha: number) => string, height: number, k = 1) {
  const gr = g.createLinearGradient(0, 0, 0, height);
  gr.addColorStop(0, color(0.42 * k));
  gr.addColorStop(0.55, color(0.14 * k));
  gr.addColorStop(1, color(0.02 * k));
  return gr;
}

/**
 * Is OUR EQ what's applied to the captured sound? Desktop: only when
 * Equalizer APO uses CorvidEQ and it isn't bypassed. (Browser: no sound.)
 * Then the analyzer can show the sound before the EQ too.
 */
export const eqApplied = () => isDesktop && !!useEqFile.getState().included && !isBypassed();

/**
 * Visible level window of the line and bars views (dBFS). Shared with
 * AnalyzerScale. A sine of X dBFS reads X in the bass (spectrum.rs), so the
 * top is full scale.
 */
export const FLOOR = -84;
export const CEIL = 0;

/** Level (dBFS) <-> y in a box `height` px tall. */
export const levelToY = (db: number, height: number) => height - Math.max(0, Math.min(1, (db - FLOOR) / (CEIL - FLOOR))) * height;
export const yToLevel = (y: number, height: number) => FLOOR + (1 - y / height) * (CEIL - FLOOR);

/**
 * The line/bars view's box: the whole graph, or in split view the half the
 * line/bars has (upper, or lower when swapped). Heat gets the other half.
 */
export const lineBox = (height: number, display: string, swapped: boolean) =>
  display !== 'split' ? { top: 0, height } : { top: swapped ? height / 2 : 0, height: height / 2 };
