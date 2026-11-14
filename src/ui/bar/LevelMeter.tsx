/**
 * Stereo level meter (left / right), like a mixer's: a column of LED
 * segments per channel (bottom = quiet), standing under a dB scale:
 * input (before the EQ) under the red one, output under the cyan one; green,
 * then yellow as the level gets loud (-18 dBFS up). Both mean "fine": they
 * only show how loud it is. On top of each column sit three red LEDs, the
 * last few dB below full scale, matching Auto's headroom choices:
 *
 *   red 1  above -3 dBFS    louder than 3 dB headroom would let it be
 *   red 2  above -1 dBFS    louder than 1 dB headroom would let it be
 *   red 3  above -0.5 dBFS  Windows' limiter is at work ("clipping"); stays
 *                           lit 2 s so a short one can't be missed
 *
 * Why the top one isn't "0 dBFS": Windows runs every output through a limiter
 * after all effects (CAudioLimiter), and loopback captures after it. Measured
 * with a sine: the level stops at 0.985 (-0.13 dBFS) and, pushed harder, gets
 * turned DOWN. So nothing ever reaches 0 dBFS here; what you hear instead is
 * the limiter squashing the sound. Hovering the red LEDs lists their levels.
 *
 *   bar          peak level, falling back smoothly
 *   lit segment  the highest peak of the last moment, held a little longer
 *
 * Both follow PEAKS on purpose. Music's average (RMS) level sits roughly
 * 10-20 dB below its peaks, so an average bar with a peak marker always shows
 * a big gap between them. With both on peaks, the held segment sits just
 * above the bar and simply marks the recent top.
 *
 * Drawn on a canvas in its own animation loop (no React re-renders at 60 fps).
 * Data: `spectrumSource.level()` / `inputLevel()` (system audio on desktop,
 * the preview song in the browser). The desktop can't hear the input (Windows
 * only captures after Equalizer APO), so that meter stays dark there.
 *
 * Click it to switch it off (`meterOn` in the store): every segment goes
 * dark and the loop stops; click again to switch it back on.
 */
import { useEffect, useRef } from 'react';
import { spectrumSource } from '../../audio/spectrum-source';
import { useEq } from '../../state/store';
import { useElementSize } from '../common/useElementSize';
import { meterColor } from '../theme/active';
import { TOOLTIPS } from '../tooltips';

/** The green / yellow column's range in dBFS; the red LEDs continue it to 0. */
const MIN_DB = -48;
const MAX_DB = -3;
/** Green below, yellow from here up. */
const YELLOW_DB = -18;
/**
 * The red LEDs, bottom up: each lights above its level. -3 and -1 are Auto's
 * headroom choices; -0.5 is "at Windows' limiter" (it holds peaks at -0.13).
 */
const RED_DB = [-3, -1, -0.5] as const;
const LIMIT_HOLD_MS = 2000;
/** Segment height and gap (px). */
const SEG = 4;
const GAP = 2;
/** The red LEDs' block: they continue the column at the same spacing. */
const RED_H = RED_DB.length * (SEG + GAP) - GAP;
/** Ballistics: levels jump up at once and fall at FALL dB/s; peaks hold, then fall. */
const FALL = 24;
const PEAK_HOLD_MS = 1200;
const PEAK_FALL = 18;

/** Channel column width and the gap between L and R (px). */
const COL_W = 9;
const COL_GAP = 4;
const W = COL_W * 2 + COL_GAP;

type Zone = 'green' | 'yellow' | 'red';
/** One LED: lights while the level is above `lo` (up to `hi`, its top). */
interface Led { y: number; lo: number; hi: number; zone: Zone }

export function LevelMeter({ which, title }: { which: 'input' | 'output'; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [boxRef, box] = useElementSize<HTMLDivElement>();
  const H = Math.floor(box.height);
  const on = useEq((s) => s.meterOn);
  // Every LED (column, then the red ones) at the same pitch from the bottom
  // up; what's left over sits above the top one.
  const count = Math.max(1, Math.floor((H + GAP) / (SEG + GAP)) - RED_DB.length);
  const redTop = H - (count + RED_DB.length) * (SEG + GAP) + GAP;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || H <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const step = (MAX_DB - MIN_DB) / count;
    // Every LED from the bottom up: the column, then the red ones on top.
    const leds: Led[] = Array.from({ length: count }, (_, i) => {
      const lo = MIN_DB + i * step;
      return { y: H - SEG - i * (SEG + GAP), lo, hi: lo + step, zone: lo + step > YELLOW_DB ? 'yellow' : 'green' };
    });
    RED_DB.forEach((lo, i) => {
      leds.push({ y: H - SEG - (count + i) * (SEG + GAP), lo, hi: RED_DB[i + 1] ?? 0, zone: 'red' });
    });
    const top = leds.length - 1;
    const read = () => (which === 'input' ? spectrumSource.inputLevel() : spectrumSource.level());

    const shown = [MIN_DB, MIN_DB];
    const peak = [MIN_DB, MIN_DB];
    const peakUntil = [0, 0];
    const limitUntil = [0, 0];
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      // Off: one frame with nothing lit (the dark segments stay as the switch).
      if (on) raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const level = on ? read() : undefined;

      for (let ch = 0; ch < 2; ch++) {
        const pk = level ? level.peak[ch]! : MIN_DB;
        if (pk > RED_DB[2]) limitUntil[ch] = now + LIMIT_HOLD_MS;
        shown[ch] = Math.max(pk, shown[ch]! - FALL * dt);
        if (pk >= peak[ch]!) {
          peak[ch] = pk;
          peakUntil[ch] = now + PEAK_HOLD_MS;
        } else if (now > peakUntil[ch]!) {
          peak[ch] = Math.max(pk, peak[ch]! - PEAK_FALL * dt);
        }
      }

      g.clearRect(0, 0, W, H);
      for (let ch = 0; ch < 2; ch++) {
        const x = ch * (COL_W + COL_GAP);
        // The LED holding the peak lights up on its own; the top one also
        // stays lit a while after the limiter was reached.
        const peakLed = leds.findLastIndex((l) => l.lo < peak[ch]!);
        leds.forEach((l, i) => {
          const lit = l.lo < shown[ch]! || i === peakLed || (i === top && now < limitUntil[ch]!);
          g.fillStyle = meterColor(l.zone, lit ? 1 : 0.14);
          g.fillRect(x, l.y, COL_W, SEG);
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [H, count, which, on]);

  return (
    <div ref={boxRef} className={`level-meter ${which}`} role="switch" aria-checked={on} tabIndex={0}
      title={title ?? TOOLTIPS.levelMeter.body}
      aria-label={`${which === 'input' ? 'Input' : 'Output'} level meter`}
      onClick={() => useEq.getState().setMeterOn(!on)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); useEq.getState().setMeterOn(!on); } }}>
      <div className="meter-body">
        <canvas ref={ref} style={{ width: W, height: H }} />
        {/* Over the red LEDs, so hovering them explains them (canvas parts can't have their own title). */}
        <div className="meter-red" style={{ top: redTop, height: RED_H }} title={TOOLTIPS.levelMeter.red} />
      </div>
    </div>
  );
}
