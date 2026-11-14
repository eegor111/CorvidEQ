/**
 * Bar along the top of the window, over the graph and the band panel. From
 * the left: power (is CorvidEQ shaping my sound?), the app's name (opens About),
 * the source (which output, and so which EQ).
 * Then desktop problems, and at the right end history (back to flat = the Default preset),
 * the band counter and Settings. It runs the whole width, so it's the roomy one: whatever can live here keeps
 * the bottom bar on one line (folded, that one spreads the Q knobs apart).
 */
import { isDesktop } from '../../audio/spectrum-source';
import { useEqFile } from '../../state/eq-file';
import { useEq } from '../../state/store';
import { installUpdate, restartAfterUpdate, useUpdater } from '../../state/updater';
import { Button } from '../common/Button';
import { RedoIcon, SettingsIcon, UndoIcon } from '../common/icons';
import { BandCount } from './BandCount';
import { Brand } from './Brand';
import { DeviceWarning } from './DeviceWarning';
import { PowerButton } from './PowerButton';
import { SourcePicker, SourceRate } from './SourcePicker';
import { TOOLTIPS } from '../tooltips';

/**
 * Desktop: problems talking to Equalizer APO's folder (the on/off switch
 * itself is the power button in this bar).
 */
function EqFileProblem() {
  const { state, error, switchError } = useEqFile();
  const problem = switchError ?? (state === 'error' ? error : undefined);
  if (!problem) return null;
  return <div className="file-status error" title={problem}><span className="led" /> {switchError ? 'Didn\'t switch' : 'Can\'t save'}</div>;
}

function UpdateButton() {
  const { status, availableVersion, progress, error, errorPhase } = useUpdater();
  if (status === 'available' && availableVersion) {
    return (
      <Button on onClick={() => void installUpdate()} title={TOOLTIPS.topBar.update(availableVersion)}>
        Update v{availableVersion}
      </Button>
    );
  }
  if (status === 'downloading') {
    return <Button disabled>{progress !== null ? `Updating ${progress}%…` : 'Updating…'}</Button>;
  }
  if (status === 'error' && errorPhase === 'install' && availableVersion) {
    return (
      <Button onClick={() => void installUpdate()} title={`${error ?? 'Update failed'}\nClick to retry.`}>
        Update failed
      </Button>
    );
  }
  if (status === 'installed') {
    return <Button on onClick={() => void restartAfterUpdate()}>Restart to update</Button>;
  }
  return null;
}

export function TopBar({ onSettings }: { onSettings(): void }) {
  const canUndo = useEq((s) => s.past.length > 0);
  const canRedo = useEq((s) => s.future.length > 0);
  const { undo, redo } = useEq.getState();

  return (
    <header className="topbar">
      <PowerButton />
      <Brand />
      {isDesktop && <SourcePicker />}
      {isDesktop && <SourceRate />}
      {isDesktop && <EqFileProblem />}
      {isDesktop && <DeviceWarning />}
      {/* Pinned to the right end, also when the bar wraps. Fixed widths from
          there on, so + stays under the mouse when a band is added. */}
      <div className="group bar-end">
        {isDesktop && <UpdateButton />}
        <Button className="icon" onClick={undo} disabled={!canUndo} title={TOOLTIPS.topBar.undo} aria-label="Undo"><UndoIcon /></Button>
        <Button className="icon" onClick={redo} disabled={!canRedo} title={TOOLTIPS.topBar.redo} aria-label="Redo"><RedoIcon /></Button>
        <BandCount />
        <button type="button" className="icon-toggle" onClick={onSettings} title={TOOLTIPS.topBar.settings} aria-label="Settings"><SettingsIcon /></button>
      </div>
    </header>
  );
}
