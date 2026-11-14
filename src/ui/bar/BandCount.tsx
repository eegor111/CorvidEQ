/**
 * Band counter in the top bar: one editable number like every other, with
 * a small − and + inside its box. One click = one band (one undo step);
 * scroll or drag it (one band per notch) or click the number to type. Bands are added
 * in the widest empty stretch of the spectrum and taken off the end.
 */
import { MAX_BANDS, MIN_BANDS, useEq } from '../../state/store';
import { NumberField } from '../common/NumberField';
import { TOOLTIPS } from '../tooltips';

export function BandCount() {
  const count = useEq((s) => s.settings.bands.length);
  const { setBandCount } = useEq.getState();
  return (
    <div className="band-count-box">
      <NumberField className="band-count" text={String(count)} edit={String(count)} label="Number of bands"
        title={TOOLTIPS.topBar.bandCount(MIN_BANDS, MAX_BANDS)}
        // A band is a big step: slower than the default, so one can be picked by hand.
        dragPx={12}
        // The wheel burst or drag is already one undo step (NumberField).
        onStep={(dir) => setBandCount(useEq.getState().settings.bands.length + dir, false)}
        onCommit={(t) => setBandCount(parseInt(t, 10))}>
        <button type="button" className="band-step minus" disabled={count <= MIN_BANDS}
          onClick={() => setBandCount(count - 1)} aria-label="Remove the last band" title={TOOLTIPS.topBar.bandRemove}>−</button>
        <button type="button" className="band-step plus" disabled={count >= MAX_BANDS}
          onClick={() => setBandCount(count + 1)} aria-label="Add a band" title={TOOLTIPS.topBar.bandAdd}>+</button>
      </NumberField>
    </div>
  );
}
