/**
 * App shell. Columns:
 *
 *   level scale | graph | dB scale | band panel
 *
 * The top bar runs the full width. Under it, four rows shared by all columns
 * so everything lines up (the band panel uses CSS subgrid for its rows):
 *
 *   region names | shape buttons (the row is only as tall as those need)
 *   graph (red analyzer scale left, dB scale right) | faders (same dB range)
 *   frequency scale | Freq knobs
 *   bottom bar | Q knobs
 *
 * Under the cyan dB scale: the output meter (spans the two lower rows).
 * Red analyzer scale: "dB" at its floor (-84); under it, left of the frequency scale: "Hz".
 */
import { useCallback, useState } from 'react';
import { isDesktop } from './audio/spectrum-source';
import { useIsBypassed } from './state/bypass';
import { useEqFile } from './state/eq-file';
import { useSettings } from './state/settings';
import { BottomBar } from './ui/bar/BottomBar';
import { CrashModal } from './ui/bar/CrashModal';
import { LevelMeter } from './ui/bar/LevelMeter';
import { TopBar } from './ui/bar/TopBar';
import { AnalyzerScale, DbScale, FreqAxis, FreqUnit, RegionStrip } from './ui/graph/AxisStrips';
import { EqGraph } from './ui/graph/EqGraph';
import { GAIN_MARGIN } from './ui/graph/geometry';
import { BandPanel } from './ui/panel/BandPanel';
import { SettingsPage } from './ui/settings/SettingsPage';
import { useShortcuts } from './ui/useShortcuts';

/** Graph margin, shared with the panel so faders align with the graph. */
const layoutVars = { '--gain-margin': `${GAIN_MARGIN}px` } as React.CSSProperties;

export default function App() {
  useShortcuts();
  // Colors drawn by code (bandColor…) are read during render: re-render when they change.
  useSettings((s) => s.uiTheme);
  useSettings((s) => s.font);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Stable, so the page's key listener isn't re-added on every render.
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  // Bypassed: the curve, nodes and faders turn gray (index.css, "Bypassed").
  const bypass = useIsBypassed();
  // Desktop, power off (Equalizer APO doesn't use CorvidEQ): no curve or nodes
  // at all. `=== false`: unknown at startup, so nothing flashes away.
  const off = useEqFile((s) => isDesktop && s.included === false);

  // The page replaces the EQ view instead of covering it: unmounted, the
  // analyzer and meter stop drawing (the page also pauses the capture).
  if (settingsOpen) return <SettingsPage onClose={closeSettings} />;

  return (
    <div className={`app ${bypass ? 'bypassed' : ''} ${off ? 'eq-off' : ''}`} style={layoutVars}>
      <TopBar onSettings={openSettings} />
      <RegionStrip />
      <AnalyzerScale />
      <EqGraph />
      <DbScale />
      <FreqAxis />
      <FreqUnit />
      <BottomBar />
      <LevelMeter which="output" />
      <BandPanel />
      {isDesktop && <CrashModal />}
    </div>
  );
}
