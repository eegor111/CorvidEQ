/**
 * Static background of the graph: grid lines only. All labels live outside
 * the graph (AxisStrips.tsx): region names above, frequencies below, and the
 * dB scale in its own slot at the start of the band panel.
 *
 * Two marks at the top end, both teaching something true: the graph is
 * shaded above 20 kHz, where hearing ends, and a line marks the captured
 * output's Nyquist frequency (half its sample rate: nothing above it can
 * exist in that stream) when it falls inside the graph (44.1 kHz: 22.05 kHz).
 */
import { SPECTRUM_MAX_HZ } from '../../audio/spectrum-source';
import { capturedRate, useAudioSource } from '../../state/audio-source';
import { FREQ_GRID, FREQ_LABELS, HEARING_MAX_HZ, dbGrid, freqToX, gainToY, type View } from './geometry';
import { TOOLTIPS } from '../tooltips';

/** Where the faint cyan hint line sits. */
const HINT_HZ = 8000;

export function GraphGrid({ view }: { view: View }) {
  const rate = useAudioSource(capturedRate);
  const { width, height, db } = view;
  const lines = dbGrid(db);
  if (!height) return null;
  const hearing = freqToX(HEARING_MAX_HZ, view);
  const nyquist = rate && rate / 2 < SPECTRUM_MAX_HZ ? freqToX(rate / 2, view) : null;

  return (
    <g className="grid">
      <rect className="beyond-hearing" x={hearing} y={0} width={width - hearing} height={height}>
        <title>{TOOLTIPS.graph.beyondHearing}</title>
      </rect>
      {FREQ_GRID.map((f) => (
        <line key={f} x1={freqToX(f, view)} x2={freqToX(f, view)} y1={0} y2={height}
          className={FREQ_LABELS.includes(f) ? 'major' : ''} />
      ))}
      {lines.map((g) => (
        <line key={g} x1={0} x2={width} y1={gainToY(g, view)} y2={gainToY(g, view)} className={g === 0 ? 'zero' : ''} />
      ))}
      {/* A faint cyan hint at 8 kHz, unlabelled (user's choice). */}
      <line x1={freqToX(HINT_HZ, view)} x2={freqToX(HINT_HZ, view)} y1={0} y2={height} className="hint" />
      {nyquist !== null && (
        <line className="nyquist" x1={nyquist} x2={nyquist} y1={0} y2={height}>
          <title>{TOOLTIPS.graph.nyquist(rate!)}</title>
        </line>
      )}
    </g>
  );
}
