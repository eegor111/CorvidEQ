/**
 * Shared About content used by both the top-bar Brand modal and Settings → About,
 * so version, credits, license, and links always stay in sync.
 */
import { getVersion } from '@tauri-apps/api/app';
import { useEffect, useState } from 'react';
import { isDesktop } from '../../audio/spectrum-source';
import { openIssuesWebsite, openSourceWebsite } from '../../state/eq-file';
import { checkForUpdates, installUpdate, restartAfterUpdate, useUpdater } from '../../state/updater';
import { Button } from './Button';

export function AboutContent({ onClose }: { onClose?: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const { status, availableVersion, progress, error, errorPhase } = useUpdater();

  // The version the app was built with (tauri.conf.json), not a copy of it here.
  useEffect(() => {
    if (isDesktop) void getVersion().then(setVersion).catch(() => {});
  }, []);

  const openLink = (open: () => Promise<void>) => {
    setLinkFailed(false);
    open().catch(() => setLinkFailed(true));
  };

  const canRetryInstall = status === 'error' && errorPhase === 'install' && !!availableVersion;
  const updateNote =
    status === 'up-to-date'
      ? "You're on the latest version."
      : status === 'available'
        ? `Update available: v${availableVersion}`
        : status === 'installed'
          ? 'Update ready — restart CorvidEQ to finish.'
          : status === 'error'
            ? `${errorPhase === 'install' ? "Couldn't install update" : "Couldn't check for updates"}: ${error}`
            : null;

  return (
    <>
      <img src="/icon.svg" alt="" draggable={false} />
      <h2>CorvidEQ</h2>
      {version && <div className="modal-note">Version {version}</div>}
      {isDesktop && (
        <div className="about-update">
          {status === 'checking' && <Button disabled>Checking…</Button>}
          {status === 'available' && (
            <Button on onClick={() => void installUpdate()}>Update to v{availableVersion}</Button>
          )}
          {canRetryInstall && (
            <Button on onClick={() => void installUpdate()}>Retry update to v{availableVersion}</Button>
          )}
          {status === 'downloading' && (
            <Button disabled>{progress !== null ? `Updating ${progress}%…` : 'Updating…'}</Button>
          )}
          {status === 'installed' && (
            <Button on onClick={() => void restartAfterUpdate()}>Restart</Button>
          )}
          {(status === 'idle' || status === 'up-to-date' || (status === 'error' && !canRetryInstall)) && (
            <Button onClick={() => void checkForUpdates(false)}>Check for updates</Button>
          )}
          {updateNote && <div className={`modal-note ${status === 'error' ? 'warn' : ''}`}>{updateNote}</div>}
        </div>
      )}
      <p>
        <strong>Heads-up:</strong> CorvidEQ is an early release, still in testing. It started as a personal tool,
        and its code was written largely by AI. It's shared in good will, as is, with no warranty. It edits
        Equalizer APO's config, so back up your files before using it.
      </p>
      <ul className="about-credits">
        <li>Designed by Igor Mitrović</li>
        <li>Sound processing: Equalizer APO, by Jonas Thedering</li>
        <li>Filter math: Audio EQ Cookbook, by Robert Bristow-Johnson</li>
        <li>Font: Oxanium, by Severin Meyer (SIL Open Font License)</li>
        <li>Built with Tauri and React</li>
        <li>Copyright © 2026 Igor Mitrović. MIT License. Provided as is, no warranty.</li>
      </ul>
      <p>Inspired by Fruity Parametric EQ 2. Not affiliated with Image-Line.</p>
      <p>
        FL Studio raised a generation of musicians with tools that teach by being fun, and easy enough for a kid
        to use. CorvidEQ tries to do the same.
      </p>
      {linkFailed && <div className="modal-note warn">Couldn't open it</div>}
      <div className="modal-actions">
        <Button onClick={() => openLink(openSourceWebsite)}>Source code</Button>
        <Button onClick={() => openLink(openIssuesWebsite)}>Report a problem</Button>
        {onClose && <Button className="primary" autoFocus onClick={onClose}>Close</Button>}
      </div>
    </>
  );
}
