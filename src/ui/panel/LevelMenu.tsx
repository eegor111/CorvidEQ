/**
 * Right-click menu of the Level fader (Equalizer APO's preamp): the dashed
 * "what you hear" line on the graph, Auto and its headroom, and Level back to 0 dB. Placed at
 * the pointer, kept inside the window. Closes on Escape, on a click outside
 * it, or after choosing.
 */
import { useRef } from 'react';
import { HEADROOM_CHOICES, useEq } from '../../state/store';
import { useMenuClose } from '../common/useMenuClose';
import { usePlaceInWindow } from '../common/usePlaceInWindow';
import { TOOLTIPS } from '../tooltips';

export function LevelMenu({ at, onClose }: { at: { x: number; y: number }; onClose(): void }) {
  const showHeard = useEq((s) => s.showHeard);
  const autoGain = useEq((s) => s.autoGain);
  const preamp = useEq((s) => s.settings.preamp);
  const headroom = useEq((s) => s.headroom);
  const { setShowHeard, setAutoGain, setHeadroom, setPreamp, checkpoint } = useEq.getState();
  const ref = useRef<HTMLDivElement>(null);
  useMenuClose(ref, onClose);

  const pick = (fn: () => void) => () => { fn(); onClose(); };
  const style = usePlaceInWindow(ref, at.x, at.y);

  return (
    <div ref={ref} className="menu" style={style} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      <div className="menu-note">Level</div>
      {/* A view setting, not an edit: no undo step. */}
      <button role="menuitem" className={showHeard ? 'on' : ''} onClick={pick(() => setShowHeard(!showHeard))}
        title={TOOLTIPS.levelMenu.levelLine}>
        {showHeard ? 'Hide' : 'Show'} the level line
      </button>
      <hr />
      <button role="menuitem" className={autoGain ? 'on' : ''} onClick={pick(() => { checkpoint(); setAutoGain(!autoGain); })}
        title={TOOLTIPS.levelMenu.auto}>
        Auto level {autoGain ? 'on' : 'off'}
      </button>
      {/* A listening setting for every EQ, not an edit: no undo step. */}
      {HEADROOM_CHOICES.map((db) => (
        <button key={db} role="menuitem" className={headroom === db ? 'on' : ''} onClick={pick(() => setHeadroom(db))}
          title={TOOLTIPS.levelMenu.headroom}>
          Auto headroom {db} dB
        </button>
      ))}
      <button role="menuitem" disabled={!autoGain && preamp === 0} onClick={pick(() => { checkpoint(); setPreamp(0); })}
        title={TOOLTIPS.levelMenu.zero}>
        Set to 0 dB
      </button>
    </div>
  );
}
