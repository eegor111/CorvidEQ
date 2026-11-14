/**
 * Filter shape menu, shared by the graph (right-click a node) and the band
 * panel (click a shape button). Lists the everyday shapes with their icons,
 * and "More…" opens the rest in place (already open if the band uses one).
 * The graph's version also has on/off, solo, resets and remove.
 *
 * Closes on Escape, on a click outside it, or after choosing.
 */
import { useRef, useState, type RefObject } from 'react';
import { FILTER_INFO, FILTER_TYPES, MORE_TYPES, type Band, type FilterType } from '../../eapo/types';
import { MIN_BANDS, useEq } from '../../state/store';
import { FilterIcon } from './icons';
import { useMenuClose } from './useMenuClose';
import { usePlaceInWindow } from './usePlaceInWindow';
import { TOOLTIPS } from '../tooltips';

interface Props {
  band: Band;
  /** Where to open it, in window coordinates (kept inside the window). */
  at: { x: number; y: number };
  onClose(): void;
  /** Add a "Turn on / off" item (the panel has its own on/off button). */
  withPower?: boolean;
  /** The button that opened the menu: clicking it again shouldn't count as "outside". */
  anchor?: RefObject<Element | null>;
}

export function FilterMenu({ band, at, onClose, withPower = false, anchor }: Props) {
  const { checkpoint, setType, updateBand, removeBand, toggleSolo, resetParam, resetGainFreq, resetBand } = useEq.getState();
  const bandCount = useEq((s) => s.settings.bands.length);
  const soloed = useEq((s) => s.soloId === band.id);
  const [more, setMore] = useState(() => (MORE_TYPES as readonly FilterType[]).includes(band.type));
  const ref = useRef<HTMLDivElement>(null);
  useMenuClose(ref, onClose, anchor);
  const style = usePlaceInWindow(ref, at.x, at.y, more);

  const act = (fn: () => void) => () => { checkpoint(); fn(); onClose(); };
  const shape = (t: FilterType) => (
    <button key={t} role="menuitem" title={TOOLTIPS.filterMenu.shape(t)} className={t === band.type ? 'on' : ''} onClick={act(() => setType(band.id, t))}>
      <FilterIcon type={t} /> {FILTER_INFO[t].label}
    </button>
  );

  return (
    <div ref={ref} className="menu" style={style} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      {FILTER_TYPES.map(shape)}
      <button role="menuitem" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Less' : 'More…'}</button>
      {more && MORE_TYPES.map(shape)}
      {withPower && (
        <>
          <hr />
          <button role="menuitem" onClick={act(() => updateBand(band.id, { enabled: !band.enabled }))}>
            {band.enabled ? 'Turn off' : 'Turn on'}
          </button>
          {/* A listening aid, not an edit: no undo step. */}
          <button role="menuitem" className={soloed ? 'on' : ''} onClick={() => { toggleSolo(band.id); onClose(); }}>
            {soloed ? 'Unsolo' : 'Solo'}
          </button>
          <hr />
          <button role="menuitem" disabled={!FILTER_INFO[band.type].hasGain || band.gain === 0}
            onClick={act(() => resetParam(band.id, 'gain'))}>
            Reset gain
          </button>
          {/* Each of these is one undo step on its own (the store checkpoints). */}
          <button role="menuitem" title={TOOLTIPS.filterMenu.resetGainFreq}
            onClick={() => { resetGainFreq(band.id); onClose(); }}>
            Reset gain + frequency
          </button>
          <button role="menuitem" title={TOOLTIPS.filterMenu.resetBand}
            onClick={() => { resetBand(band.id); onClose(); }}>
            Reset band
          </button>
          <hr />
          <button role="menuitem" disabled={bandCount <= MIN_BANDS} onClick={() => { removeBand(band.id); onClose(); }}>
            Remove band
          </button>
        </>
      )}
    </div>
  );
}
