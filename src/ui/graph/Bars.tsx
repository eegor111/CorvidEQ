/**
 * Bars view: one bar per ISO third-octave band (25 Hz … 20 kHz), the
 * standard studio analyzer, on a <canvas> behind the EQ curve like Spectrum.
 *
 * Each bar is its band's TOTAL energy (summed in spectrum.rs), so a tone and
 * noise both read their true level in dBFS: no +3 dB/octave tilt and no
 * noise fix, unlike the line. Coarser than the line, but nothing is made up.
 * It uses the line's level window and box (`levelToY`, `lineBox`), so the
 * analyzer scale on the left reads off it unchanged.
 *
 * While our EQ is applied, Pre / Post / Overlay work as on the line: before
 * the EQ = red bars, after = cyan, and overlaid the part they share is
 * violet with a cyan tip where the EQ boosts and a red one where it cuts.
 */
import { useEffect, useRef } from 'react';
import { BAR_BANDS, spectrumSource } from '../../audio/spectrum-source';
import { bandResponse, sumResponses } from '../../dsp/response';
import type { EqSettings } from '../../eapo/types';
import { curveRate, useAudioSource } from '../../state/audio-source';
import { appliedSettings, useEq } from '../../state/store';
import { afterColor, sharedColor, spectrumColor } from '../theme/active';
import { AFTER, BEFORE, FLOOR, HOLD_WIDTH, PEAK_FALL, PEAK_HOLD_MS, SUPERSAMPLE, eqApplied, glow, levelToY, lineBox } from './analyzerStyle';
import { freqToX } from './geometry';

/** Gap between neighbouring bars, px. */
const GAP = 3;
/** The EQ's gain over a band is averaged from this many frequencies in it. */
const EQ_SAMPLES = 16;

export function Bars({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

    const size = { width, height };
    const { top, height: boxH } = lineBox(height, split ? 'split' : 'bars', swapped);
    const n = BAR_BANDS.length;
    // Each bar spans its band on the log frequency axis, minus the gap.
    const xs = BAR_BANDS.map((b) => {
      const x0 = freqToX(b.lo, size) + GAP / 2;
      return { x: x0, w: Math.max(1, freqToX(b.hi, size) - GAP / 2 - x0) };
    });
    const levels = new Float32Array(n).fill(FLOOR);
    // Peak cap per bar: level, and when it may start falling (ms).
    const peaks = new Float32Array(n).fill(FLOOR);
    const peakUntil = new Float64Array(n);
    let raf = 0;
    let lastTime = performance.now();
    // The line's look (analyzerStyle.ts): the same glow fills under the
    // tops, which fade toward the bottom of the box, so quiet bars are faint.
    const fill = glow(g, spectrumColor, boxH);
    const fillAfter = glow(g, afterColor, boxH, AFTER.fill);
    const fillShared = glow(g, sharedColor, boxH);

    // "Before" per bar = captured level − the EQ's gain over that band: the
    // mean of its LINEAR power across the band (bands + preamp), in dB.
    // Recomputed only when the EQ changes.
    const eqFreqs = Float64Array.from({ length: n * EQ_SAMPLES }, (_, k) => {
      const b = BAR_BANDS[Math.floor(k / EQ_SAMPLES)]!;
      return b.lo * (b.hi / b.lo) ** ((k % EQ_SAMPLES + 0.5) / EQ_SAMPLES);
    });
    const eqDb = new Float32Array(n);
    let eqFor: EqSettings | null = null;
    let soloFor: string | null = null;
    let rateFor = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      if (!spectrumSource.readBars(levels)) {
        // Nothing live: let the bars sink gracefully instead of freezing.
        for (let b = 0; b < n; b++) levels[b] = Math.max(FLOOR, levels[b]! - 1.5);
      }
      for (let b = 0; b < n; b++) {
        // Peak cap: jump up to new highs, hold, then fall slowly.
        if (levels[b]! >= peaks[b]!) {
          peaks[b] = levels[b]!;
          peakUntil[b] = now + PEAK_HOLD_MS;
        } else if (now > peakUntil[b]!) {
          peaks[b] = Math.max(levels[b]!, peaks[b]! - PEAK_FALL * dt);
        }
      }

      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.clearRect(0, 0, width, height);
      const eq = useEq.getState();
      const { peakHold, lines } = eq;
      const compare = eqApplied();
      const fs = curveRate(useAudioSource.getState());
      if (compare && (eq.settings !== eqFor || eq.soloId !== soloFor || fs !== rateFor)) {
        eqFor = eq.settings;
        soloFor = eq.soloId;
        rateFor = fs;
        const applied = appliedSettings(eq);
        const db = sumResponses(applied.bands.map((b) => bandResponse(b, eqFreqs, fs)), eqFreqs.length, applied.preamp);
        for (let b = 0; b < n; b++) {
          let power = 0;
          for (let k = 0; k < EQ_SAMPLES; k++) power += 10 ** (db[b * EQ_SAMPLES + k]! / 10);
          eqDb[b] = 10 * Math.log10(power / EQ_SAMPLES);
        }
      }

      // The bars live in the line's box: shift down to it (split view, swapped).
      g.setTransform(scale, 0, 0, scale, 0, scale * top);
      const y = (db: number) => levelToY(db, boxH);
      // A filled stretch of a bar from level `from` up to level `to`.
      const body = (b: number, from: number, to: number, style: CanvasGradient) => {
        if (to <= from) return;
        g.fillStyle = style;
        g.fillRect(xs[b]!.x, y(to), xs[b]!.w, y(from) - y(to));
      };
      // A line across a bar at `level`, `thick` px: its top (drawn like the
      // line view's stroke) or its peak cap.
      const mark = (b: number, level: number, color: string, thick: number) => {
        if (level <= FLOOR) return;
        g.fillStyle = color;
        g.fillRect(xs[b]!.x, y(level) - thick / 2, xs[b]!.w, thick);
      };
      const red = (b: number, level: number) => mark(b, level, spectrumColor(BEFORE.line), BEFORE.width);
      const cyan = (b: number, level: number) => mark(b, level, afterColor(AFTER.line), AFTER.width);

      const pre = compare && lines === 'pre';
      const post = compare && lines === 'post';
      for (let b = 0; b < n; b++) {
        const after = levels[b]!;
        const before = after - eqDb[b]!;
        if (pre) {
          body(b, FLOOR, before, fill);
          red(b, before);
        } else if (post) {
          body(b, FLOOR, after, fillAfter);
          cyan(b, after);
        } else if (compare) {
          // As on the line: the part they share violet; above it the cyan
          // glow where the EQ boosts, the red one where it cuts.
          const shared = Math.min(before, after);
          body(b, FLOOR, shared, fillShared);
          if (after > before) body(b, shared, after, fillAfter);
          else body(b, shared, before, fill);
          red(b, before);
          cyan(b, after);
        } else {
          body(b, FLOOR, after, fill);
          red(b, after);
        }
      }

      // Peak caps follow the bars you see, as the line's hold does: after
      // the EQ (cyan) in post, before it (red: the captured peak minus the
      // EQ) in pre, both in overlay; red without a comparison.
      if (peakHold) {
        for (let b = 0; b < n; b++) {
          if (compare && !pre) mark(b, peaks[b]!, afterColor(AFTER.hold), HOLD_WIDTH);
          if (!compare || !post) mark(b, peaks[b]! - (compare ? eqDb[b]! : 0), spectrumColor(BEFORE.hold), HOLD_WIDTH);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, split, swapped, channel]);

  return <canvas ref={canvasRef} className="spectrum" style={{ width, height }} />;
}
