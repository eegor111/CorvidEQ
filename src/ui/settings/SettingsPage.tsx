/**
 * Settings: a full-window page over the app (the EQ keeps working: Equalizer
 * APO does the sound). Categories on the left, one readable column on the
 * right that gets room to breathe in a big window and simply fills a small
 * one (`.settings-column` in index.css). Built from the blocks in primitives.tsx.
 *
 * Esc or the back arrow closes it. The last category and each category's
 * scroll position are remembered while the app runs (not saved: a fresh
 * start opens on the first category).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { isDesktop, setCapturePaused, type FftMode } from '../../audio/spectrum-source';
import { openConfigFolder, openFftVideo, refreshStatus, switchOff, useEqFile } from '../../state/eq-file';
import { openLogFolder } from '../../state/error-log';
import { getStartupState, setStartupState, useSettings } from '../../state/settings';
import { AboutContent } from '../common/About';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { BackIcon } from '../common/icons';
import { FONT_PRESETS, type FontId } from '../theme/fonts';
import { UI_THEMES } from '../theme/theme';
import { Action, Keys, Note, Page, Row, Section, Segmented, Value, type Option } from './primitives';

type Category = 'eapo' | 'analyzer' | 'appearance' | 'system' | 'controls' | 'about';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'eapo', label: 'Equalizer APO' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'analyzer', label: 'Analyzer' },
  { id: 'system', label: 'Window & tray' },
  { id: 'controls', label: 'Controls' },
  { id: 'about', label: 'About' },
];

/** Where you were, for as long as the app runs. */
const memory: { category: Category; scroll: Partial<Record<Category, number>> } = { category: 'eapo', scroll: {} };
const rememberCategory = (c: Category) => { memory.category = c; };
const rememberScroll = (c: Category, top: number) => { memory.scroll[c] = top; };

export function SettingsPage({ onClose }: { onClose(): void }) {
  const [category, setCategory] = useState(memory.category);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);

  const choose = (c: Category) => { rememberCategory(c); setCategory(c); };

  // Back to where this category was scrolled, before it's painted.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = memory.scroll[category] ?? 0;
  }, [category]);

  // Nothing shows the analyzer while this page is open.
  useEffect(() => {
    setCapturePaused(true);
    return () => setCapturePaused(false);
  }, []);

  // Keys typed in the page stay in it (onKeyDown below), so B or Delete don't
  // reach the EQ. Focus starts here; if it ever lands outside (on the body),
  // Esc still closes. An open dropdown catches its own Esc first.
  useEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !root.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div ref={root} className="settings-page" role="dialog" aria-modal aria-label="Settings" tabIndex={-1}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <nav className="settings-nav" aria-label="Settings categories">
        <button type="button" className="settings-back" onClick={onClose} title="Back to the EQ (Esc)">
          <BackIcon />
          <span>Settings</span>
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`settings-cat ${c.id === category ? 'on' : ''}`}
            aria-current={c.id === category ? 'page' : undefined} onClick={() => choose(c.id)}>
            {c.label}
          </button>
        ))}
      </nav>
      <main ref={scroller} className="settings-scroll" onScroll={(e) => rememberScroll(category, e.currentTarget.scrollTop)}>
        <div className="settings-column">
          {/* A broken page shows its error instead of blanking the window. A new key per category starts it fresh. */}
          <ErrorBoundary key={category} what="this page">
            {category === 'eapo' && <EapoPage />}
            {category === 'analyzer' && <AnalyzerPage />}
            {category === 'appearance' && <AppearancePage />}
            {category === 'system' && <SystemPage />}
            {category === 'controls' && <ControlsPage />}
            {category === 'about' && <AboutPage />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function EapoPage() {
  const { configDir, installed, included, hasBackup, switching, deviceSelector, deviceSelectorPath } = useEqFile();
  const customConfigDir = useSettings((s) => s.customConfigDir);
  const setCustomConfigDir = useSettings((s) => s.setCustomConfigDir);
  const [note, setNote] = useState<string | null>(null);

  // Every action reports how it went in the note at the bottom.
  const run = async (action: () => Promise<unknown>, done: string | null, failed: string) => {
    try {
      await action();
      if (done) setNote(done);
    } catch (err) {
      setNote(`${failed}: ${String(err)}`);
    }
  };

  if (!isDesktop) {
    return (
      <Page title="Equalizer APO" description="Equalizer APO does the actual sound processing, inside Windows.">
        <Note>These settings are only in the desktop app. The browser version has no access to files or system audio.</Note>
      </Page>
    );
  }

  const browse = () => run(async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: configDir, title: 'Equalizer APO config folder' });
    if (typeof picked === 'string') {
      await setCustomConfigDir(picked);
      setNote('Config folder changed.');
    }
  }, null, 'Could not change the folder');

  return (
    <Page title="Equalizer APO" description="Equalizer APO does the actual sound processing, inside Windows. CorvidEQ writes its settings.">
      <Section title="Status">
        <Row label="Equalizer APO">
          {installed === false ? <Value status="error">Not found</Value> : <Value>{installed ? 'Installed' : 'Checking…'}</Value>}
        </Row>
        <Row label="CorvidEQ" description="Switch it with the power button, top left.">
          {included ? <Value status="on">On: shaping Windows audio</Value> : <Value status="off">Off</Value>}
        </Row>
      </Section>

      <Section title="Files">
        <Row label="Config folder" description={<span className="set-path">{configDir || 'Looking for it…'}</span>}>
          <Action onClick={browse}>Browse…</Action>
          {customConfigDir && (
            <Action onClick={() => run(() => setCustomConfigDir(null), 'Back to the default folder.', 'Could not reset')}
              title="Back to Equalizer APO's own folder">
              Use default
            </Action>
          )}
          <Action onClick={() => run(openConfigFolder, null, 'Could not open the folder')} disabled={installed === false}>
            Open
          </Action>
        </Row>
        <Row label="Device Selector"
          description={<span className="set-path">{deviceSelector === false
            ? `Not found. Looked at ${deviceSelectorPath}`
            : `Equalizer APO's own tool for choosing which outputs and inputs it works on. Run it from ${deviceSelectorPath}`}</span>} />
        <Row label="Your original config.txt"
          description={hasBackup
            ? 'Kept as config-before-corvideq.txt while CorvidEQ is on. Restoring it switches CorvidEQ off.'
            : 'Nothing to restore: CorvidEQ is off, so config.txt is your own.'}>
          {hasBackup && (
            <Action tone="danger" disabled={switching}
              onClick={() => run(async () => { await switchOff(); await refreshStatus(); }, 'Your original config.txt is back.', 'Restore failed')}>
              {switching ? 'Restoring…' : 'Restore'}
            </Action>
          )}
        </Row>
        <Row label="Error log" description="What went wrong, if anything did. Attach it to a bug report.">
          <Action onClick={() => run(openLogFolder, null, 'Could not open the folder')}>Open</Action>
        </Row>
      </Section>

      {note && <Note>{note}</Note>}
    </Page>
  );
}

/** How the analyzer measures. Each choice says what it gains and what it costs. */
const FFT_MODES: (Option<FftMode> & { description: string })[] = [
  { value: 'dual', label: 'Dual', description:
    'Affects Line, Heat, and Bars. Runs two FFTs: a long snapshot for bass detail, and a 4x shorter one for mids and highs so drums and hits show at once. '
    + 'Tuned so music and noise keep their true shape; in Line and Heat, a lone pure tone above 500 Hz reads lower than it is.' },
  { value: 'single', label: 'Single', description:
    'Affects Line, Heat, and Bars. Uses one long FFT across every frequency: 4x sharper detail in the mids and highs so close notes separate, '
    + 'at the cost of reacting about 4x slower in the highs (~170 ms).' },
];

function AnalyzerPage() {
  const fftMode = useSettings((s) => s.fftMode);
  const setFftMode = useSettings((s) => s.setFftMode);
  const [note, setNote] = useState<string | null>(null);
  return (
    <Page
      title="Analyzer"
      description="Every sound is a mix of vibrations tangled into a single wave. The Fast Fourier Transform (FFT) splits that wave into individual frequencies—letting you see bass, mids, and treble separately in real time."
    >
      <Section title="Measuring">
        <Row label="FFT" description={FFT_MODES.find((m) => m.value === fftMode)!.description}>
          <Segmented label="FFT" value={fftMode} options={FFT_MODES} onChange={setFftMode} />
        </Row>
        <Note>
          Line and Heat draw that FFT spectrum directly. Bars does not run a separate FFT per bar—it adds up the energy of the FFT bins inside each third-octave bucket (using the shorter FFT for upper bars in Dual mode).
        </Note>
      </Section>
      <Section title="Learn more">
        <Row
          stack
          label="How the FFT changed the world"
          description="Fascinating video by Veritasium on the Fast Fourier Transform — from Cold War seismology to music and Wi-Fi."
        >
          <Action onClick={() => { setNote(null); void openFftVideo().catch((err) => setNote(String(err))); }}>
            The Most Underrated Algorithm - Veritasium ↗
          </Action>
        </Row>
      </Section>
      {note && <Note>{note}</Note>}
    </Page>
  );
}

function AppearancePage() {
  const uiTheme = useSettings((s) => s.uiTheme);
  const setUiTheme = useSettings((s) => s.setUiTheme);
  const font = useSettings((s) => s.font);
  const setFont = useSettings((s) => s.setFont);

  // Each font is shown in itself.
  const fonts: Option<FontId>[] = Object.values(FONT_PRESETS).map((p) => ({ value: p.id, label: p.label, style: { fontFamily: p.stack } }));

  return (
    <Page title="Appearance">
      <Section title="Colors">
        <Row label="Theme" description="The analyzer and the band colors stay the same in every theme.">
          <Segmented label="Theme" value={uiTheme} options={UI_THEMES.map((t) => ({ value: t.id, label: t.label }))} onChange={setUiTheme} />
        </Row>
      </Section>
      <Section title="Text">
        <Row label="Font" description={FONT_PRESETS[font].description}>
          <Segmented label="Font" value={font} options={fonts} onChange={setFont} />
        </Row>
      </Section>
    </Page>
  );
}

const TOGGLE_OPTIONS: Option<'off' | 'on'>[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];

function SystemPage() {
  const closeToTray = useSettings((s) => s.closeToTray);
  const minimizeToTray = useSettings((s) => s.minimizeToTray);
  const startMinimized = useSettings((s) => s.startMinimized);
  const { setCloseToTray, setMinimizeToTray, setStartMinimized } = useSettings.getState();
  const [startupOn, setStartupOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    void getStartupState().then((s) => {
      setStartupOn(s.enabled);
      if (s.enabled && s.minimized !== useSettings.getState().startMinimized) {
        setStartMinimized(s.minimized);
      }
    }).catch(() => {});
  }, [setStartMinimized]);

  if (!isDesktop) {
    return (
      <Page title="Window & tray" description="System tray and Windows startup options.">
        <Note>These settings are only in the desktop app.</Note>
      </Page>
    );
  }

  const updateStartup = async (enabled: boolean, minimized: boolean) => {
    setNote(null);
    try {
      const next = await setStartupState(enabled, minimized);
      setStartupOn(next.enabled);
    } catch (err) {
      setNote(String(err));
    }
  };

  return (
    <Page title="Window & tray" description="While hidden in the tray, CorvidEQ stops audio capture and polling; Equalizer APO keeps running.">
      <Section title="System tray">
        <Row label="Close to tray" description="Closing the window hides it to the system tray instead of quitting.">
          <Segmented label="Close to tray" value={closeToTray ? 'on' : 'off'} options={TOGGLE_OPTIONS}
            onChange={(v) => setCloseToTray(v === 'on')} />
        </Row>
        <Row label="Minimize to tray" description="Minimizing hides the window to the system tray instead of the taskbar.">
          <Segmented label="Minimize to tray" value={minimizeToTray ? 'on' : 'off'} options={TOGGLE_OPTIONS}
            onChange={(v) => setMinimizeToTray(v === 'on')} />
        </Row>
      </Section>

      <Section title="Startup">
        <Row label="Run on startup" description="Start CorvidEQ automatically when signing in to Windows. (Your EQ already runs without the app open.)">
          <Segmented label="Run on startup" value={startupOn ? 'on' : 'off'} options={TOGGLE_OPTIONS}
            onChange={(v) => void updateStartup(v === 'on', startMinimized)} />
        </Row>
        <Row label="Start minimized to tray" description="When launched on Windows startup, start silently in the system tray.">
          <Segmented label="Start minimized to tray" value={startMinimized ? 'on' : 'off'} options={TOGGLE_OPTIONS}
            onChange={(v) => {
              const next = v === 'on';
              setStartMinimized(next);
              if (startupOn) void updateStartup(true, next);
            }} />
        </Row>
      </Section>

      {note && <Note>{note}</Note>}
    </Page>
  );
}

const KEYBOARD: { label: string; combos: string[][] }[] = [
  { label: 'Hear without the EQ (bypass)', combos: [['B']] },
  { label: 'Undo', combos: [['Ctrl', 'Z']] },
  { label: 'Redo', combos: [['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']] },
  { label: 'Remove the selected band', combos: [['Delete']] },
  { label: 'Deselect, close a menu or this page', combos: [['Esc']] },
  { label: 'Fine steps while dragging', combos: [['Shift']] },
  { label: 'Windows / WebView2 quirk — opens a non-existent menu (ignore it; click anywhere to resume)', combos: [['Alt']] },
];

const MOUSE: { label: string; gesture: string }[] = [
  { label: 'Move a band (frequency and gain)', gesture: 'Drag a node' },
  { label: 'Band width (Q)', gesture: 'Scroll on a node' },
  { label: 'Back to 0 dB and its home frequency', gesture: 'Double-click a node' },
  { label: 'Band menu: shape, solo, mute, reset, remove', gesture: 'Right-click a node or fader' },
  { label: 'One fine step up or down', gesture: 'Scroll on any control' },
  { label: 'Reset a fader or knob', gesture: 'Double-click it' },
  { label: 'Type an exact value ("1.2k" works)', gesture: 'Click Hz, dB or Q' },
  { label: 'Level menu: Auto, headroom, level line', gesture: 'Right-click the Level fader' },
];

const ANALYZER_CONTROLS: { label: string; gesture: string }[] = [
  { label: 'Switch Heat color palette (Fire / Ice)', gesture: 'Click Heat again while active' },
  { label: 'Split view (Heat + last used Line or Bars)', gesture: 'Click Split' },
  { label: 'Swap top and bottom halves in Split view', gesture: 'Click Split again' },
  { label: 'Cycle Pre / Post / Overlay', gesture: 'Click Pre / Post / Overlay (while EQ is active)' },
  { label: 'Adjust Heat sensitivity (quiet vs loud detail)', gesture: 'Scroll or drag curve (double-click = linear)' },
  { label: 'Zoom graph range (±12 / ±24 dB)', gesture: 'Click the dB scale' },
  { label: 'Turn analyzer off / back on (keeps last view)', gesture: 'Click analyzer power' },
];

function ControlsPage() {
  return (
    <Page title="Controls" description="Everything you can do with the keyboard and mouse.">
      <Section title="Keyboard">
        {KEYBOARD.map((k) => <Row key={k.label} label={k.label}><Keys combos={k.combos} /></Row>)}
      </Section>
      <Section title="Mouse">
        {MOUSE.map((m) => <Row key={m.label} label={m.label}><Value>{m.gesture}</Value></Row>)}
      </Section>
      <Section title="Analyzer">
        {ANALYZER_CONTROLS.map((a) => <Row key={a.label} label={a.label}><Value>{a.gesture}</Value></Row>)}
      </Section>
    </Page>
  );
}

function AboutPage() {
  return (
    <Page title="About">
      <div className="set-section about-panel">
        <AboutContent />
      </div>
    </Page>
  );
}
