/**
 * Desktop: the most common reasons "the EQ does nothing". Equalizer APO only
 * runs on the devices ticked in its Device Selector, and only after Windows
 * restarts. When the device you're listening to doesn't have it (read from
 * the registry, devices.rs), say so; a click says which tool to run. The app
 * doesn't start that tool itself: no Windows prompts coming from CorvidEQ
 * (user's choice). Once it's ticked, say a restart is still to come
 * (`restartNeeded`).
 *
 * Equalizer APO itself or its tool missing: say so without linking to an
 * external download page. The app never downloads anything and never restarts
 * Windows: both stay the user's to do.
 */
import { useState, type ReactNode } from 'react';
import { targetDevice, useAudioSource } from '../../state/audio-source';
import { useEqFile } from '../../state/eq-file';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return <div className="file-status error" title={title}><span className="led" /> {children}</div>;
}

/** Which tool to run: its real name (it differs by version) and folder, from the status read. */
function SetupHelp({ device, toolPath, onClose }: { device: string; toolPath: string; onClose(): void }) {
  const slash = toolPath.lastIndexOf('\\');
  const tool = toolPath.slice(slash + 1) || 'DeviceSelector.exe';
  const folder = toolPath.slice(0, Math.max(slash, 0));

  return (
    <Modal label="Not installed" className="about" onClose={onClose}>
      <p>Run {tool} from the Equalizer APO folder.</p>
      {folder && <div className="modal-note set-path">{folder}</div>}
      <p>Tick {device}, click OK, then restart Windows.</p>
      <div className="modal-actions">
        <Button className="primary" autoFocus onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

export function DeviceWarning() {
  const device = useAudioSource((s) => targetDevice(s));
  const restartNeeded = useAudioSource((s) => s.restartNeeded);
  const installed = useEqFile((s) => s.installed);
  const configDir = useEqFile((s) => s.configDir);
  const toolFound = useEqFile((s) => s.deviceSelector);
  const toolPath = useEqFile((s) => s.deviceSelectorPath);
  const [help, setHelp] = useState(false);

  if (installed === false) {
    return (
      <Problem title={`Equalizer APO's config folder wasn't found.\n${configDir ?? ''}`}>Equalizer APO not found</Problem>
    );
  }
  if (toolFound === false) {
    return (
      <Problem title={`Equalizer APO's Device Selector wasn't found, so it may be damaged or removed. Installing it again brings it back.\nLooked at ${toolPath ?? ''}`}>Device Selector not found</Problem>
    );
  }
  if (!device) return null;
  if (device.eapo.length > 0) {
    if (!restartNeeded.includes(device.id)) return null;
    return <Problem title={`Equalizer APO is set up on ${device.name}, but it only starts working after you restart Windows.`}>Restart Windows</Problem>;
  }

  // The window sits outside .device-warning, whose buttons are all red.
  return (
    <>
      <div className="device-warning">
        <Button onClick={() => setHelp(true)} title={`Equalizer APO isn't installed on ${device.name}, so the EQ can't reach it.`}>
          Not installed
        </Button>
      </div>
      {help && <SetupHelp device={device.name} toolPath={toolPath ?? ''} onClose={() => setHelp(false)} />}
    </>
  );
}
