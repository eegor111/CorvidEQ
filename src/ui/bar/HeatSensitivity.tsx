/**
 * Heat view sensitivity ("gamma"): just a tiny picture of the curve it
 * applies, and the picture is the control. Scroll it or drag up/down;
 * double-click = back to linear.
 *
 *   middle  linear: brightness follows level
 *   down    quiet sound sinks away, only the strong parts glow
 *   up      quiet sound is lifted, more detail shows
 *
 * The picture plots level (left → right) against brightness (bottom → top),
 * with the straight "linear" line faintly behind it.
 */
import { heatCurve, useEq } from '../../state/store';
import { Control } from '../panel/controls';
import { TOOLTIPS } from '../tooltips';

const STEP = 0.05;
const FINE = 0.01;
const SIZE = 28; // with its outline, as tall as the buttons beside it
const PAD = 4;

function curvePath(sensitivity: number) {
  const span = SIZE - 2 * PAD;
  let d = '';
  for (let i = 0; i <= 24; i++) {
    const x = i / 24;
    const y = heatCurve(x, sensitivity);
    d += `${i ? 'L' : 'M'}${(PAD + x * span).toFixed(1)},${(SIZE - PAD - y * span).toFixed(1)}`;
  }
  return d;
}

export function HeatSensitivity() {
  const value = useEq((s) => s.heatSensitivity);
  const set = useEq.getState().setHeatSensitivity;
  return (
    <Control
      className="heat-gamma"
      shiftFine
      props={{
        focusId: 'heat',
        label: 'Heat sensitivity',
        title: TOOLTIPS.graph.heatSensitivity,
        color: 'var(--selected)',
        undoable: false,
        norm: value,
        setNorm: set,
        step: (dir, fine) => set(value + dir * (fine ? FINE : STEP)),
        reset: () => set(0.5),
      }}
    >
      <svg className="heat-curve" width={SIZE} height={SIZE} aria-hidden>
        <path className="linear" d={`M${PAD},${SIZE - PAD}L${SIZE - PAD},${PAD}`} />
        <path className="shape" d={curvePath(value)} />
      </svg>
    </Control>
  );
}
