/**
 * Precise values, for the people who want numbers, without cluttering the
 * graph: only ever ONE band's values, and the crosshair's position.
 *
 *   BandReadout  top edge: the band you're touching, else the selected one
 *                (then bright, like the selected node)
 *   BandCross    a crosshair snapped to a node, in the band's color, with its
 *                exact frequency on the bottom edge and gain on the right edge
 *                (shown for the selected band, and the one you're touching)
 *   Crosshair    follows the pointer over empty graph (cyan), same labels
 */
import { useEffect, useState, type RefObject } from 'react';
import { FILTER_INFO, SLOPES, hasQ, hasSlope, type Band } from '../../eapo/types';
import { NumberField } from '../common/NumberField';
import { bandColor } from '../theme/active';
import { useEq } from '../../state/store';
import { PARAMS, type BandParam } from '../../state/params';
import { TOOLTIPS } from '../tooltips';
import { formatDb, formatHz, xToFreq, yToGain, type View } from './geometry';
import { lineBox, yToLevel } from './analyzerStyle';

/**
 * `editable` (the selected band): its Hz, dB and Q sit in editable-number
 * boxes (NumberField: cyan, click to type an exact value, for copying
 * filters from a measurement). Anything that doesn't read as a number is ignored.
 */
export function BandReadout({ band, index, editable, bright }: { band: Band; index: number; editable: boolean; bright: boolean }) {
  const info = FILTER_INFO[band.type];
  const value = (key: BandParam, text: string) =>
    editable ? <EditableValue band={band} index={index} param={key} text={text} /> : <span>{text}</span>;
  return (
    <div
      className={`readout ${band.enabled ? '' : 'off'} ${editable ? 'editable' : ''} ${bright ? 'bright' : ''}`}
      style={{ '--band': bandColor(index) } as React.CSSProperties}
    >
      <span className="readout-num">{index + 1}</span>
      <span>{info.label}</span>
      {value('freq', formatHz(band.freq))}
      {info.hasGain && value('gain', formatDb(band.gain))}
      {hasSlope(band.type) && <SlopeToggle band={band} index={index} editable={editable} />}
      {hasQ(band.type) && value('q', `Q ${band.q.toFixed(2)}`)}
      {!band.enabled && <span className="readout-off">off</span>}
    </div>
  );
}

/**
 * A cut's steepness: all three choices in one button, the one in use lit
 * (yellow, "chosen"); a click takes the next. Not selected: just shown.
 */
function SlopeToggle({ band, index, editable }: { band: Band; index: number; editable: boolean }) {
  const slope = band.slope ?? 12;
  const parts = (
    <>
      {SLOPES.map((s) => <span key={s} className={s === slope ? 'on' : undefined}>{s}</span>)}
      <span>dB</span>
    </>
  );
  if (!editable) return <span className="slope">{parts}</span>;
  const next = SLOPES[(SLOPES.indexOf(slope) + 1) % SLOPES.length]!;
  return (
    <button type="button" className="slope" title={TOOLTIPS.graph.slope}
      aria-label={`Band ${index + 1} slope ${slope} dB per octave`}
      onClick={() => useEq.getState().setSlope(band.id, next)}>
      {parts}
    </button>
  );
}

/** What the field starts with: the plain number, ready to retype. */
const rawValue = (band: Band, key: BandParam) => (key === 'q' ? band.q.toFixed(2) : String(PARAMS[key].round(band[key])));

/**
 * Reads what was typed: "1.2k" / "1.2 kHz" = 1200 Hz, "−3" (real minus sign,
 * as the readout shows it) = -3, a comma works as the decimal point.
 */
function parseValue(text: string, key: BandParam): number {
  const t = text.trim().toLowerCase().replace(',', '.').replace('−', '-');
  const n = parseFloat(t.replace(/^q\s*/, ''));
  if (key === 'freq' && /\dk|\d\s*khz/.test(t)) return n * 1000;
  return n;
}

const PARAM_NAMES: Record<BandParam, string> = { freq: 'frequency', gain: 'gain', q: 'Q' };

function EditableValue({ band, index, param, text }: { band: Band; index: number; param: BandParam; text: string }) {
  return (
    <NumberField text={text} edit={rawValue(band, param)} label={`Band ${index + 1} ${PARAM_NAMES[param]}`}
      title={param === 'freq' ? TOOLTIPS.numberField.freq : undefined}
      onStep={(dir, fine) => useEq.getState().stepParam(band.id, param, dir, fine)}
      onCommit={(t) => useEq.getState().setParam(band.id, param, parseValue(t, param))} />
  );
}

/** Crosshair locked onto a band's node, in the band's color. */
export function BandCross({ band, index, x, y, view }: { band: Band; index: number; x: number; y: number; view: View }) {
  const hasGain = FILTER_INFO[band.type].hasGain;
  return (
    <div className="crosshair band" aria-hidden style={{ '--band': bandColor(index) } as React.CSSProperties}>
      <div className="crosshair-v" style={{ left: x }} />
      {hasGain && <div className="crosshair-h" style={{ top: y }} />}
      <div className="crosshair-label hz" style={{ left: Math.min(Math.max(x, 40), view.width - 40) }}>
        {formatHz(band.freq)}
      </div>
      {hasGain && (
        <div className="crosshair-label db" style={{ top: Math.min(Math.max(y, 14), view.height - 14) }}>
          {formatDb(band.gain)}
        </div>
      )}
    </div>
  );
}

/**
 * Listens to the graph's own pointer events (no re-render of the whole graph
 * on every mouse move). Hidden over a node: the band readout shows its values.
 */
export function Crosshair({ target, view }: { target: RefObject<SVGSVGElement | null>; view: View }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const display = useEq((s) => s.display);
  const swapped = useEq((s) => s.splitSwapped);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      // Over a node, or dragging one: that node's own crosshair shows instead.
      const overNode = (e.target as Element).closest('.dot');
      if (overNode || e.buttons !== 0) return setAt(null);
      const r = el.getBoundingClientRect();
      setAt({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const leave = () => setAt(null);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [target]);

  if (!at || at.x < 0 || at.y < 0 || at.x > view.width || at.y > view.height) return null;
  // Where the line analyzer is (split view: one half), for its level readout.
  const box = lineBox(view.height, display, swapped);
  return (
    <div className="crosshair" aria-hidden>
      <div className="crosshair-v" style={{ left: at.x }} />
      <div className="crosshair-h" style={{ top: at.y }} />
      <div className="crosshair-label hz" style={{ left: Math.min(Math.max(at.x, 40), view.width - 40) }}>
        {formatHz(xToFreq(at.x, view))}
      </div>
      <div className="crosshair-label db" style={{ top: Math.min(Math.max(at.y, 14), view.height - 14) }}>
        {formatDb(yToGain(at.y, view))}
      </div>
      {/* The line's (or bars') level at the pointer, in its red (scale left of the graph). */}
      {(display === 'line' || display === 'bars' || display === 'split') && at.y >= box.top && at.y <= box.top + box.height && (
        <div className="crosshair-label level" style={{ top: Math.min(Math.max(at.y, 14), view.height - 14) }}>
          {yToLevel(at.y - box.top, box.height).toFixed(0)} dBFS
        </div>
      )}
    </div>
  );
}
