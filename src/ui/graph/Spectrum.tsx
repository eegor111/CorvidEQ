/**
 * Real-time spectrum drawn on a <canvas> behind the EQ curve.
 * Canvas (not SVG) because it redraws 60×/s and SVG would churn the DOM.
 *
 * The data comes from `spectrumSource` (the preview song in a browser, the
 * whole system's audio in the desktop app).
 *
 * Two looks of the same data:
 *   line  level = height (a classic analyzer), with a glow under it and a
 *         peak-hold line that remembers recent highs
 *   heat  level = color of a full-height stripe, quiet to loud: dark red through
 *         orange to yellow (Fire), or deep blue through azure to white (Ice).
 *         The palette is only a look; Pre / Post picks the sound
 *   split both in the graph, one per half of the 0 dB middle line: the line
 *         above and heat below, or swapped (click Split again). With the
 *         bars (Bars.tsx) in split view, this draws only the heat.
 *         (the peak-hold line can be switched off on the graph's left edge)
 */
import { useEffect, useRef } from 'react';
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, SPECTRUM_POINTS, spectrumSource } from '../../audio/spectrum-source';
import { curveRate, useAudioSource } from '../../state/audio-source';
import { appliedSettings, heatCurve, useEq } from '../../state/store';
import { bandResponse, sumResponses } from '../../dsp/response';
import type { EqSettings } from '../../eapo/types';
import { afterColor, heatColor, heatIceColor, sharedColor, spectrumColor } from '../theme/active';
import { AFTER, BEFORE, FLOOR, HOLD_WIDTH, PEAK_FALL, PEAK_HOLD_MS, SUPERSAMPLE, eqApplied, glow, levelToY, lineBox } from './analyzerStyle';
import { xToFreq } from './geometry';

/**
 * Music naturally has less energy in the highs (~ -3 dB per octave). Tilting
 * the display by the same amount makes a typical mix look roughly flat,
 * which is what mixing tools do too.
 */
const TILT_DB_PER_OCT = 3;
/**
 * Heat view: the window FOLLOWS the music instead of being fixed. Its top is
 * the loudest level shown recently (it jumps up at once and sinks slowly),
 * and it spans HEAT_RANGE dB below that. Only the very loudest part reaches
 * yellow; loud is bright orange, medium red, quiet fades to nothing, so you
 * can tell loud from quiet at any volume. HEAT_TOP_MIN keeps silence and noise dark.
 */
const HEAT_RANGE = 36;
const HEAT_TOP_MIN = -56;
const HEAT_TOP_FALL = 4; // dB per second
/** The window's top, one frame on: up at once to the loudest of `values`, else sinking. */
function followLoudest(top: number, values: Float32Array, dt: number) {
  let loudest = -Infinity;
  for (const v of values) loudest = Math.max(loudest, v);
  return Math.max(HEAT_TOP_MIN, loudest, top - HEAT_TOP_FALL * dt);
}
/** Pixels per analyzer column. 1 = one point per pixel: no big jumps between neighbours. */
const COL = 1;
/**
 * The peak-hold line is drawn as a smooth envelope over the peaks: each
 * point takes the highest peak within ±PEAK_REACH px (so dips between peaks
 * are bridged), then the result is averaged over ±PEAK_SMOOTH px (so the
 * corners round off). Troughs don't matter for "how high did it get".
 */
const PEAK_REACH = 14;
const PEAK_SMOOTH = 16;

export function Spectrum({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Split view (and which half is which), plus the active L/R channel, changes
  // where/what is drawn, so peak hold and smoothing reset cleanly.
  const split = useEq((s) => s.display === 'split');
  const swapped = useEq((s) => s.splitSwapped);
  const channel = useEq((s) => (s.settings.split?.on ? s.settings.split.side : null));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const scale = Math.max(SUPERSAMPLE, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const g = canvas.getContext('2d')!;
    g.setTransform(scale, 0, 0, scale, 0, 0);

    const size = { width, height };
    // Line view's box (one half in split view) and the heat's (the other half).
    const { top: lineTop, height: lineH } = lineBox(height, split ? 'split' : 'line', swapped);
    const heatTopY = split && !swapped ? height / 2 : 0;
    const heatH = split ? height / 2 : height;
    const columns = Math.ceil(width / COL);
    const levels = new Float32Array(columns).fill(FLOOR);
    // What's drawn: `levels` lightly blended with its neighbours, which
    // softens one-pixel spikes without hiding real peaks.
    const shown = new Float32Array(columns).fill(FLOOR);
    const grid = new Float32Array(SPECTRUM_POINTS);
    // Peak hold per column: level, and when it may start falling (ms).
    const peaks = new Float32Array(columns).fill(FLOOR);
    const envelope = new Float32Array(columns);
    const reach = new Float32Array(columns);
    const peakUntil = new Float64Array(columns);
    let raf = 0;
    let lastTime = performance.now();
    let heatTop = HEAT_TOP_MIN;

    // Which grid points fall in each column (the grid is log-spaced 20 Hz…20 kHz,
    // exactly like the x axis), and the display tilt for that column.
    const span = Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) / (SPECTRUM_POINTS - 1);
    const gridIndex = (f: number) => Math.log(f / SPECTRUM_MIN_HZ) / span;
    // Narrow columns (more pixels than grid points) interpolate at their center
    // so the line stays smooth; wide ones take their loudest point.
    const cols = Array.from({ length: columns }, (_, c) => {
      const f0 = xToFreq(c * COL, size);
      const f1 = xToFreq((c + 1) * COL, size);
      const i0 = gridIndex(f0);
      const i1 = gridIndex(f1);
      const center = Math.min(SPECTRUM_POINTS - 1.001, Math.max(0, (i0 + i1) / 2));
      const lo = Math.max(0, Math.ceil(i0));
      const hi = Math.min(SPECTRUM_POINTS - 1, Math.floor(i1));
      return { lo, hi, center, tilt: TILT_DB_PER_OCT * Math.log2(Math.sqrt(f0 * f1) / 1000) };
    });

    // Glow under the lines (analyzerStyle.ts).
    const fill = glow(g, spectrumColor, lineH);
    const fillAfter = glow(g, afterColor, lineH, AFTER.fill);
    const fillShared = glow(g, sharedColor, lineH);

    // Before/after: we capture the sound AFTER the EQ (measured on Windows:
    // a cut shows up in the analyzer). The EQ is a fixed filter whose exact
    // curve we know, so "before" = what we capture minus that curve (bands +
    // preamp), per column. Recomputed only when the EQ changes.
    const colFreqs = Float64Array.from(cols, (_, c) => Math.sqrt(xToFreq(c * COL, size) * xToFreq((c + 1) * COL, size)));
    const eqDb = new Float32Array(columns);
    const before = new Float32Array(columns);
    const shared = new Float32Array(columns);
    let eqFor: EqSettings | null = null;
    let soloFor: string | null = null;
    let rateFor = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      if (spectrumSource.read(grid)) {
        // Each column takes the loudest grid point it covers, then the tilt.
        for (let c = 0; c < columns; c++) {
          const { lo, hi, center, tilt } = cols[c]!;
          let level: number;
          if (hi - lo >= 1) {
            level = -Infinity;
            for (let k = lo; k <= hi; k++) level = Math.max(level, grid[k]!);
          } else {
            const k = Math.floor(center);
            level = grid[k]! + (grid[k + 1]! - grid[k]!) * (center - k);
          }
          levels[c] = Number.isFinite(level) ? level + tilt : FLOOR;
        }
      } else {
        // Nothing live: let the picture fade out gracefully instead of freezing.
        for (let c = 0; c < columns; c++) levels[c] = Math.max(FLOOR, levels[c]! - 1.5);
      }

      for (let c = 0; c < columns; c++) {
        const l = levels[Math.max(0, c - 1)]!;
        const r = levels[Math.min(columns - 1, c + 1)]!;
        shown[c] = 0.25 * l + 0.5 * levels[c]! + 0.25 * r;
        // Peak hold: jump up to new highs, hold, then fall slowly.
        if (shown[c]! >= peaks[c]!) {
          peaks[c] = shown[c]!;
          peakUntil[c] = now + PEAK_HOLD_MS;
        } else if (now > peakUntil[c]!) {
          peaks[c] = Math.max(shown[c]!, peaks[c]! - PEAK_FALL * dt);
        }
      }

      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.clearRect(0, 0, width, height);
      const { display, levelView, peakHold, heatSensitivity, lines, heatLines, heatPalette } = useEq.getState();
      if (display === 'off' || display === 'bars') return; // bars: Bars.tsx

      const compare = eqApplied();
      if (compare) {
        // The EQ as applied (a solo included), recomputed only when it changes.
        const eq = useEq.getState();
        const fs = curveRate(useAudioSource.getState());
        if (eq.settings !== eqFor || eq.soloId !== soloFor || fs !== rateFor) {
          eqFor = eq.settings;
          soloFor = eq.soloId;
          rateFor = fs;
          const applied = appliedSettings(eq);
          eqDb.set(sumResponses(applied.bands.map((b) => bandResponse(b, colFreqs, fs)), columns, applied.preamp));
        }
        for (let c = 0; c < columns; c++) {
          before[c] = shown[c]! - eqDb[c]!;
          shared[c] = Math.min(before[c]!, shown[c]!);
        }
      }

      if (display === 'heat' || display === 'split') {
        // Pre and post share ONE window, topped by whichever of the two is
        // louder, so flipping Pre / Post shows exactly what the EQ did: a cut
        // gets dimmer, a boost brighter, Auto's headroom a touch dimmer
        // overall. The louder one (usually pre, with Auto on) still reaches
        // the top color. (Each following its own loudest hid all of that.)
        heatTop = followLoudest(heatTop, shown, dt);
        if (compare) heatTop = followLoudest(heatTop, before, 0); // 0: sink once per frame, not twice
        const values = compare && heatLines === 'pre' ? before : shown;
        const floor = heatTop - HEAT_RANGE;
        const color = heatPalette === 'ice' ? heatIceColor : heatColor;
        for (let c = 0; c < columns; c++) {
          const level = Math.max(0, Math.min(1, (values[c]! - floor) / HEAT_RANGE));
          const t = heatCurve(level, heatSensitivity);
          if (t < 0.3) continue; // fully transparent below this anyway
          g.fillStyle = color(t);
          g.fillRect(c * COL, heatTopY, COL, heatH);
        }
        // Split view with the bars: they're drawn by Bars.tsx.
        if (display === 'heat' || levelView === 'bars') return;
      }

      // The line is drawn in its own box: shift down to it (split view, swapped).
      g.setTransform(scale, 0, 0, scale, 0, scale * lineTop);

      // Smooth line: a quadratic curve through the midpoints between columns
      // (each column's point acts as a control point), so there are no corners.
      const smoothLine = (values: Float32Array) => {
        const yAt = (c: number) => levelToY(values[c]!, lineH);
        const path = new Path2D();
        path.moveTo(0, yAt(0));
        for (let c = 1; c < columns - 1; c++) {
          path.quadraticCurveTo(c * COL, yAt(c), c * COL + COL / 2, (yAt(c) + yAt(c + 1)) / 2);
        }
        path.lineTo(width, yAt(columns - 1));
        return path;
      };
      // A line closed down to the bottom edge, for its fill.
      const areaUnder = (line: Path2D) => {
        const area = new Path2D(line);
        area.lineTo(width, lineH);
        area.lineTo(0, lineH);
        area.closePath();
        return area;
      };
      const curve = smoothLine(shown);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.lineWidth = BEFORE.width;

      if (compare && lines === 'pre') {
        // Before the EQ only: the red line, like the single-line view.
        const beforeLine = smoothLine(before);
        g.fillStyle = fill;
        g.fill(areaUnder(beforeLine));
        g.strokeStyle = spectrumColor(BEFORE.line);
        g.stroke(beforeLine);
      } else if (compare && lines === 'post') {
        // After the EQ only: the cyan line, as in overlay.
        g.fillStyle = fillAfter;
        g.fill(areaUnder(curve));
        g.strokeStyle = afterColor(AFTER.line);
        g.lineWidth = AFTER.width;
        g.stroke(curve);
      } else if (compare) {
        // Before = red, after = cyan, the sound they share = violet. So above
        // the violet: a cyan band where the EQ boosts, a red band where it cuts.
        const beforeLine = smoothLine(before);
        const sharedArea = areaUnder(smoothLine(shared));
        g.fillStyle = fillAfter;
        g.fill(areaUnder(curve));
        g.fillStyle = fill;
        g.fill(areaUnder(beforeLine));
        g.globalCompositeOperation = 'destination-out'; // clear the overlap…
        g.fillStyle = '#000';
        g.fill(sharedArea);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = fillShared; // …and paint it violet instead
        g.fill(sharedArea);
        g.strokeStyle = spectrumColor(BEFORE.line);
        g.stroke(beforeLine);
        g.strokeStyle = afterColor(AFTER.line);
        g.lineWidth = AFTER.width;
        g.stroke(curve);
      } else {
        g.fillStyle = fill;
        g.fill(areaUnder(curve));
        // Outline: only the curve itself (not the sides), thick and fairly
        // opaque so it reads as one continuous line.
        g.strokeStyle = spectrumColor(BEFORE.line);
        g.stroke(curve);
      }

      // Peak hold: a thin, fainter line in the same color, resting on recent
      // highs. (Same color on purpose: yellow would look like band 3 or "on".)
      if (peakHold) {
        // It follows the lines you see: after the EQ (cyan) in post, before
        // it (red) in pre, both in overlay.
        const pre = compare && lines === 'pre';
        const both = compare && lines === 'overlay';
        g.lineWidth = HOLD_WIDTH;
        // 1) highest peak nearby  2) moving average of that.
        for (let c = 0; c < columns; c++) {
          let m = -Infinity;
          for (let k = Math.max(0, c - PEAK_REACH); k <= Math.min(columns - 1, c + PEAK_REACH); k++) m = Math.max(m, peaks[k]!);
          reach[c] = m;
        }
        for (let c = 0; c < columns; c++) {
          const lo = Math.max(0, c - PEAK_SMOOTH);
          const hi = Math.min(columns - 1, c + PEAK_SMOOTH);
          let sum = 0;
          for (let k = lo; k <= hi; k++) sum += reach[k]!;
          envelope[c] = sum / (hi - lo + 1);
        }
        if (compare && !pre) {
          g.strokeStyle = afterColor(AFTER.hold);
          g.stroke(smoothLine(envelope));
        }
        if (pre || both) {
          // The peaks we hold are captured after the EQ; take the EQ back off.
          for (let c = 0; c < columns; c++) envelope[c] = envelope[c]! - eqDb[c]!;
        }
        if (!compare || pre || both) {
          g.strokeStyle = spectrumColor(BEFORE.hold);
          g.stroke(smoothLine(envelope));
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, split, swapped, channel]);

  return <canvas ref={canvasRef} className="spectrum" style={{ width, height }} />;
}
