/**
 * Curve data for the graph: each band's own shape and the combined EQ,
 * sampled once per ~2 px, plus a helper that turns a response into an SVG path.
 *
 * Two combined curves:
 *   total  the EQ's shape (bands only). It passes through the nodes.
 *   heard  total + preamp (Level): what you actually hear compared to no EQ.
 * They're kept apart because nodes can't follow the preamp: with Auto on,
 * raising a band lowers the preamp, so a node would barely move under the mouse.
 */
import { useMemo } from 'react';
import type { Band } from '../../eapo/types';
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ } from '../../audio/spectrum-source';
import { bandResponse, logFrequencies, sumResponses } from '../../dsp/response';
import { curveRate, useAudioSource } from '../../state/audio-source';
import { freqToX, gainToY, type View } from './geometry';

export function useCurves(bands: Band[], preamp: number, size: View, otherBands?: Band[]) {
  // Across the whole graph (to 22.4 kHz, past the nodes' 20 kHz).
  const freqs = useMemo(() => logFrequencies(Math.max(64, Math.round(size.width / 2)), SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ), [size.width]);
  // Each band's shape as if it were on, so hovering a switched-off band still
  // shows what it would do. The total only counts bands that are on.
  // At the captured output's rate, as Equalizer APO applies them.
  const fs = useAudioSource(curveRate);
  const responses = useMemo(() => bands.map((b) => bandResponse({ ...b, enabled: true }, freqs, fs)), [bands, freqs, fs]);
  const total = useMemo(
    () => sumResponses(responses.filter((_, i) => bands[i]!.enabled), freqs.length),
    [bands, responses, freqs],
  );
  const heard = useMemo(() => total.map((g) => g + preamp), [total, preamp]);
  // Split EQ: faint reference curve of the channel not currently on screen.
  const other = useMemo(
    () => (otherBands ? sumResponses(otherBands.filter((b) => b.enabled).map((b) => bandResponse(b, freqs, fs)), freqs.length) : null),
    [otherBands, freqs, fs],
  );

  /** Polyline through a response, clamped a little beyond the edges. */
  const toPath = (r: Float64Array) => {
    let d = '';
    for (let i = 0; i < freqs.length; i++) {
      const y = Math.max(-50, Math.min(size.height + 50, gainToY(r[i]!, size)));
      d += `${i ? 'L' : 'M'}${freqToX(freqs[i]!, size).toFixed(1)},${y.toFixed(1)}`;
    }
    return d;
  };

  /** Same path, closed down/up to the 0 dB line, for a soft fill. */
  const toArea = (r: Float64Array) => {
    const zero = gainToY(0, size);
    return `${toPath(r)}L${size.width},${zero}L0,${zero}Z`;
  };

  return { responses, total, heard, other, toPath, toArea };
}
