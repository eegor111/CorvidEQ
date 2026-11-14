/**
 * Shown once on startup when the previous session ended in a Rust crash.
 * Equalizer APO kept running the EQ undisturbed; this only lets the user
 * inspect or copy the details for a bug report.
 */
import { useEffect, useState } from 'react';
import { openLogFolder, takeLastCrash } from '../../state/error-log';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

export function CrashModal() {
  const [crash, setCrash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void takeLastCrash().then((text) => {
      if (text) setCrash(text);
    });
  }, []);

  if (!crash) return null;

  const copy = () => {
    navigator.clipboard.writeText(crash).then(() => setCopied(true)).catch(() => {});
  };

  return (
    <Modal label="CorvidEQ crashed last time" onClose={() => setCrash(null)}>
      <h2>CorvidEQ closed unexpectedly last time</h2>
      <div className="modal-note">Your EQ kept running in Equalizer APO. You can attach these details to a bug report.</div>
      <pre className="crash-details">{crash}</pre>
      <div className="modal-actions">
        <Button onClick={() => void openLogFolder()}>Open log folder</Button>
        <Button onClick={copy}>{copied ? 'Copied' : 'Copy crash info'}</Button>
        <Button className="primary" autoFocus onClick={() => setCrash(null)}>Close</Button>
      </div>
    </Modal>
  );
}
