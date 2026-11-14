/**
 * The scales that frame the graph, each outside it:
 *   RegionStrip  names of the sound regions (Sub bass … Air), above the graph
 *   FreqAxis     20 · 50 · 100 … 10k, below the graph, beside the Freq knobs
 *   FreqUnit     its unit "Hz", far left under the analyzer scale's "dB"
 *   DbScale      +18 … -18, right of the graph, in its own slot at the start
 *                of the band panel (beside the faders). Click = zoom ±12/±24.
 *   AnalyzerScale  0 … -84 dBFS, left of the graph, in red: the line's (or
 *                bars') levels (always shown; in split view only the half
 *                where the line is)
 *
 * They use the same scales as the graph and sit in boxes with the same
 * borders, so every label lines up with the graph's grid lines.
 */
import { useEq } from '../../state/store';
import { useElementSize } from '../common/useElementSize';
import { CEIL, FLOOR, levelToY, lineBox } from './analyzerStyle';
import { FREQ_LABELS, REGIONS, dbGrid, formatFreqShort, freqToX, gainToY } from './geometry';
import { TOOLTIPS } from '../tooltips';

/** Rough text width at the label size, to hide region names that don't fit. */
const fits = (name: string, px: number) => px > name.length * 7.5 + 10;

export function RegionStrip() {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div className="axis-strip regions" ref={ref}>
      <svg width={size.width} height={size.height}>
        {REGIONS.map((r, i) => {
          const x0 = freqToX(r.from, size);
          const x1 = freqToX(r.to, size);
          return (
            <g key={r.name}>
              <rect x={x0} y={0} width={Math.max(0, x1 - x0)} height={size.height} fill="transparent">
                <title>{TOOLTIPS.regions[r.name]}</title>
              </rect>
              {i > 0 && <line x1={x0} x2={x0} y1={size.height * 0.25} y2={size.height} pointerEvents="none" />}
              {fits(r.name, x1 - x0) && (
                <text x={(x0 + x1) / 2} y={size.height / 2 + 5} textAnchor="middle" pointerEvents="none">{r.name}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function FreqAxis() {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div className="axis-strip freq-axis" ref={ref}>
      <svg width={size.width} height={size.height}>
        {FREQ_LABELS.map((f) => (
          <line key={f} x1={freqToX(f, size)} x2={freqToX(f, size)} y1={0} y2={6} />
        ))}
      </svg>
      {/* Labels as HTML (crisper than SVG text on Windows). */}
      {size.width > 0 && FREQ_LABELS.map((f) => (
        <span key={f} className={`freq-label ${f === 20 ? 'first' : ''}`}
          style={{ left: Math.round(f === 20 ? 4 : freqToX(f, size)) }}>
          {formatFreqShort(f)}
        </span>
      ))}
    </div>
  );
}

/**
 * The frequency scale's unit, "Hz": far left, in the analyzer scale's
 * column, right under its "dB" (FreqAxis's row, same height as its labels).
 */
export function FreqUnit() {
  return (
    <div className="freq-unit" title={TOOLTIPS.graph.freqUnit}>
      <span>Hz</span>
    </div>
  );
}

/**
 * dB scale = zoom switch, in its own column between the graph and the panel.
 * Its box has the graph's height and border width, so its inner height equals
 * the graph's and labels sit on the grid lines. The ends (±12 / ±24) are
 * labelled too: they sit in the graph's top and bottom margin.
 */
export function DbScale() {
  const [ref, size] = useElementSize<HTMLButtonElement>();
  const db = useEq((s) => s.viewDb);
  const toggleViewDb = useEq((s) => s.toggleViewDb);
  const view = { ...size, db };
  const labels = [db, ...dbGrid(db), -db];
  return (
    <button
      ref={ref}
      className="db-scale"
      onClick={toggleViewDb}
      aria-label={`Zoom: ±${db} dB. Click for ±${db === 24 ? 12 : 24} dB`}
      title={TOOLTIPS.graph.dbScale(db)}
    >
      {size.height > 0 && labels.map((g) => (
        <span key={g} className="scale-label" style={{ top: Math.round(gainToY(g, view)) }}>
          {g > 0 ? `+${g}` : g}
        </span>
      ))}
    </button>
  );
}

/**
 * Analyzer levels every 12 dB (0 … -72; split view every 24: 0, -24, -48,
 * -72); the unit "dB" takes the floor's place (-84). The graph's dB lines don't apply: this is a different scale.
 */
/** Labels every `step` dB from the top, stopping above the floor (that's where "dB" goes). */
const levelLabels = (step: number) =>
  Array.from({ length: Math.floor((CEIL - FLOOR - 1) / step) + 1 }, (_, i) => CEIL - i * step);
/** Full-height line view: every 12 dB. Split view has half the room: every 24 dB. */
const LEVEL_LABELS = levelLabels(12);
const LEVEL_LABELS_SPLIT = levelLabels(24);

/** Same box as the graph (height, border), so 0 px here is the graph's top. */
export function AnalyzerScale() {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const display = useEq((s) => s.display);
  const swapped = useEq((s) => s.splitSwapped);
  const bars = useEq((s) => s.display === 'bars' || (s.display === 'split' && s.levelView === 'bars'));
  const box = lineBox(size.height, display, swapped);
  const labels = display === 'split' ? LEVEL_LABELS_SPLIT : LEVEL_LABELS;
  // Same numbers for both: the bars use the line's window, only without its tilt.
  return (
    <div ref={ref} className="analyzer-scale" title={TOOLTIPS.graph.analyzerScale(bars)}>
      {size.height > 0 && labels.map((db) => (
        <span key={db} className="scale-label" style={{ top: Math.round(box.top + levelToY(db, box.height)) }}>{db}</span>
      ))}
      {size.height > 0 && <span className="scale-label" style={{ top: Math.round(box.top + levelToY(FLOOR, box.height)) }}>dB</span>}
    </div>
  );
}
