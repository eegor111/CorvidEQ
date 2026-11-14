/**
 * Desktop: a row in the source picker's list, and the question it asks before
 * unsplitting. Split = a left and a right EQ (state/split.ts); the L/R switch
 * in the bottom bar only shows while it's on.
 */
import { targetDevice, useAudioSource } from '../../state/audio-source';
import { canSplit, setSplit, sidesDiffer } from '../../state/split';
import { useEq } from '../../state/store';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { TOOLTIPS } from '../tooltips';

/** `onAsk`: the sides differ, so unsplitting needs the user's OK first (`UnsplitModal`). */
export function SplitButton({ onAsk }: { onAsk(): void }) {
  const on = useEq((s) => !!s.settings.split?.on);
  const source = useAudioSource((s) => targetDevice(s));
  const channels = source?.format?.channels;
  const blocked = !on && !canSplit(source);
  return (
    <>
      <button className={on ? 'on' : ''} aria-pressed={on} disabled={blocked}
        onClick={() => { if (on && sidesDiffer()) onAsk(); else setSplit(!on); }}
        title={TOOLTIPS.topBar.splitButton(on)}>
        Split left / right EQ
      </button>
      {blocked && channels !== undefined && channels !== 2 && <div className="menu-note">Needs a stereo output: this one has {channels} channels.</div>}
    </>
  );
}

export function UnsplitModal({ onClose }: { onClose(): void }) {
  const side = useEq((s) => s.settings.split?.side);
  const [shown, kept] = side === 'R' ? ['right', 'left'] : ['left', 'right'];

  return (
    <Modal label="Unsplit EQ" onClose={onClose} onSubmit={() => { setSplit(false); onClose(); }}>
      <h2>Use the {shown} EQ on both channels?</h2>
      <div className="modal-note">The {kept} EQ is kept and comes back if you split again.</div>
      <div className="modal-actions">
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="primary" autoFocus>Use {shown} EQ</Button>
      </div>
    </Modal>
  );
}
