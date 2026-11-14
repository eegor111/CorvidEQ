/**
 * Desktop: which device the analyzer and level meter listen to, and so which
 * EQ is on screen, plus what Windows says about it. In the top bar; its list
 * opens downward, outputs first, then inputs.
 *
 * The facts say what Windows reports for this device, such as whether the
 * device or Windows applies the volume. On an output the capture undoes the
 * volume either way (`OutputVolume` in devices.rs), so the analyzer doesn't
 * follow it. On an input it stays in: it can change the recording itself.
 */
import { useEffect, useRef, useState } from 'react';
import { useAudioSource, type DeviceInfo } from '../../state/audio-source';
import { ChevronIcon } from '../common/icons';
import { Button } from '../common/Button';
import { useMenuClose } from '../common/useMenuClose';
import { SplitButton, UnsplitModal } from './SplitButton';
import { TOOLTIPS } from '../tooltips';

/** While the list is open, volume and default device are re-read this often. */
const REFRESH_MS = 1000;

const kHz = (hz: number) => `${(hz / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz`;

function Facts({ device }: { device: DeviceInfo }) {
  const { volume, eapo, format } = device;
  return (
    <dl className="source-facts">
      <dt>Windows volume</dt>
      <dd>
        {volume ? `${Math.round(volume.percent)}% (${volume.db.toFixed(1)} dB)${volume.muted ? ', muted' : ''}` : 'unknown'}
      </dd>
      <dt>Volume control</dt>
      <dd>{volume ? (volume.hardware ? 'in the device (hardware)' : 'in Windows (software)') : 'unknown'}</dd>
      <dt>Equalizer APO</dt>
      <dd className={eapo.length ? '' : 'warn'}>{eapo.length ? eapo.join('; ') : 'not installed'}</dd>
      <dt>Format</dt>
      <dd>{format ? `${kHz(format.sampleRate)} · ${format.channels} ch · ${format.sampleFormat}` : 'unknown'}</dd>
    </dl>
  );
}

/** Faint beside the picker: the sample rate, which sets the top of what can be captured (half of it, Nyquist). */
export function SourceRate() {
  const { devices, capture } = useAudioSource();
  const format = devices.find((d) => d.id === capture.device)?.format;
  if (!format) return null;
  const text = kHz(format.sampleRate);
  return (
    <span className="source-rate" title={TOOLTIPS.topBar.sourceRate(text)}>
      {text}
    </span>
  );
}

export function SourcePicker() {
  const [open, setOpen] = useState(false);
  const [askUnsplit, setAskUnsplit] = useState(false);
  const { choice, input, devices, capture, listError } = useAudioSource();
  const { choose, chooseInput, refresh } = useAudioSource.getState();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [showFull, setShowFull] = useState(false);

  // Read the list once (for the button's name), then keep it fresh while open.
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  // Close on Escape or a click anywhere else.
  useMenuClose(rootRef, () => setOpen(false), undefined, open);

  const captured = devices.find((d) => d.id === capture.device);
  const defaultOutput = devices.find((d) => d.isDefault);
  const outputs = devices.filter((d) => !d.input);
  const inputs = devices.filter((d) => d.input);
  // Listening to an input: no output row is the chosen one.
  const outputChoice = input === null ? choice : undefined;
  const label = captured?.name ?? (capture.problem ? 'No device' : '…');

  return (
    <div className="source" ref={rootRef}>
      <Button className="source-current" on={open} onClick={() => setOpen(!open)}
        aria-haspopup="listbox" aria-expanded={open}
        onPointerEnter={() => { const n = nameRef.current; setShowFull(!!n && n.scrollWidth > n.clientWidth); }}
        onPointerLeave={() => setShowFull(false)}
        title={TOOLTIPS.topBar.sourcePicker}>
        <span className="source-name" ref={nameRef}>{label}</span>
        <ChevronIcon />
      </Button>
      {/* A cut-off name, whole while hovered: a copy on top that ignores the
          mouse, so the hit area stays the real button and the buttons under
          it keep working. */}
      {showFull && !open && (
        <Button className="source-current source-full" tabIndex={-1} aria-hidden="true">
          <span className="source-name">{label}</span>
          <ChevronIcon />
        </Button>
      )}

      {open && (
        <div className="menu source-menu">
          <div role="listbox">
            <div className="menu-note source-heading">Outputs</div>
            <button role="option" aria-selected={outputChoice === null} className={outputChoice === null ? 'on' : ''}
              onClick={() => choose(null)} title={TOOLTIPS.topBar.sourceDefault}>
              <span className="source-name">Windows default{defaultOutput ? `: ${defaultOutput.name}` : ''}</span>
            </button>
            {outputs.map((o) => (
              <button key={o.id} role="option" aria-selected={outputChoice === o.id} className={outputChoice === o.id ? 'on' : ''}
                onClick={() => choose(o.id)}>
                <span className="source-name">{o.name}</span>
              </button>
            ))}
            {inputs.length > 0 && <div className="menu-note source-heading">Inputs</div>}
            {inputs.map((i) => (
              <button key={i.id} role="option" aria-selected={input === i.id} className={input === i.id ? 'on' : ''}
                onClick={() => chooseInput(i.id)}
                title={TOOLTIPS.topBar.sourceInput}>
                <span className="source-name">{i.name}</span>
              </button>
            ))}
          </div>
          <hr />
          <SplitButton onAsk={() => { setOpen(false); setAskUnsplit(true); }} />
          <hr />
          {captured ? (
            <>
              <div className="menu-note source-heading">Listening to {captured.name}</div>
              <Facts device={captured} />
            </>
          ) : (
            <div className="menu-note warn">{capture.problem ?? 'Not capturing yet.'}</div>
          )}
          {listError && <div className="menu-note warn">Couldn't list devices: {listError}</div>}
        </div>
      )}
      {askUnsplit && <UnsplitModal onClose={() => setAskUnsplit(false)} />}
    </div>
  );
}
