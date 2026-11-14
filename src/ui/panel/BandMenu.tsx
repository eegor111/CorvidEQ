/**
 * Right-click menu of a band's fader: listening (solo, mute), position
 * (move left / right) and resets. Edits are one undo step each; solo is a
 * listening aid and adds none. Placed at the pointer, kept inside the window.
 * Closes on Escape, on a click outside it, or after choosing.
 */
import { useRef } from 'react';
import { FILTER_INFO, type Band } from '../../eapo/types';
import { MIN_BANDS, useEq } from '../../state/store';
import { useMenuClose } from '../common/useMenuClose';
import { usePlaceInWindow } from '../common/usePlaceInWindow';
import { TOOLTIPS } from '../tooltips';

export function BandMenu({ band, index, at, onClose }: {
  band: Band;
  index: number;
  /** Where the right-click happened (screen coordinates). */
  at: { x: number; y: number };
  onClose(): void;
}) {
  const count = useEq((s) => s.settings.bands.length);
  const soloed = useEq((s) => s.soloId === band.id);
  const { toggleSolo, checkpoint, updateBand, moveBand, resetParam, resetBand, removeBand } = useEq.getState();
  const ref = useRef<HTMLDivElement>(null);
  useMenuClose(ref, onClose);

  const pick = (fn: () => void) => () => { fn(); onClose(); };
  const mute = () => {
    // During a solo, on/off would do nothing you can hear: end the solo first
    // (the same as clicking the band's number).
    const { soloId } = useEq.getState();
    if (soloId) toggleSolo(soloId);
    checkpoint();
    updateBand(band.id, { enabled: !band.enabled });
  };
  const style = usePlaceInWindow(ref, at.x, at.y);

  return (
    <div ref={ref} className="menu" style={style} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      <div className="menu-note">Band {index + 1}</div>
      <button role="menuitem" className={soloed ? 'on' : ''} onClick={pick(() => toggleSolo(band.id))}>
        {soloed ? 'Unsolo' : 'Solo'}
      </button>
      <button role="menuitem" className={band.enabled ? '' : 'on'} onClick={pick(mute)}>
        {band.enabled ? 'Mute' : 'Unmute'}
      </button>
      <hr />
      <button role="menuitem" disabled={index === 0} onClick={pick(() => moveBand(band.id, -1))}>Move left</button>
      <button role="menuitem" disabled={index === count - 1} onClick={pick(() => moveBand(band.id, 1))}>Move right</button>
      <hr />
      <button role="menuitem" disabled={!FILTER_INFO[band.type].hasGain || band.gain === 0}
        onClick={pick(() => { checkpoint(); resetParam(band.id, 'gain'); })}>
        Reset gain
      </button>
      <button role="menuitem" title={TOOLTIPS.filterMenu.resetBand}
        onClick={pick(() => resetBand(band.id))}>
        Reset band
      </button>
      <button role="menuitem" disabled={count <= MIN_BANDS} onClick={pick(() => removeBand(band.id))}>Remove band</button>
    </div>
  );
}
