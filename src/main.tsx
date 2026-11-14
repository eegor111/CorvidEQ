import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { connectEqFile } from './state/eq-file';
import { connectErrorLog } from './state/error-log';
import { connectOutputEqs } from './state/output-eqs';
import { useSettings } from './state/settings';
import { connectSplit } from './state/split';
import { useEq } from './state/store';
import { connectUpdater } from './state/updater';
import { connectWindowIdle } from './state/window-idle';
import { applyTheme, setBandCount } from './ui/theme/active';
import { applyFont } from './ui/theme/fonts';
import { themeColors } from './ui/theme/theme';

connectErrorLog();

// Apply colors and font before the first paint, so there's no flash of wrong styling.
const settings = useSettings.getState();
applyTheme(themeColors(settings.uiTheme));
applyFont(settings.font);
// The band rainbow is spread over however many bands there are. Store
// listeners run before React re-renders, so colors are ready in time.
setBandCount(useEq.getState().settings.bands.length);
useEq.subscribe((s) => setBandCount(s.settings.bands.length));
// Before the file writer: the editor first follows the output you listen to.
connectOutputEqs();
connectEqFile();
connectSplit();
connectWindowIdle();
connectUpdater();

// A desktop app has no use for the web view's right-click menu (Back, Reload,
// Inspect...); right-click means our own actions (node menu, fader solo).
document.addEventListener('contextmenu', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
