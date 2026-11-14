/**
 * Everything about what you see, as buttons on the graph's inside edges.
 * One row along the top edge, from the left:
 *
 *   the view: power (lit while any view is on; click = all off, click again
 *   = the last view back), Line, Bars, Heat (click again = its other
 *   palette), then Split (line or bars,
 *   whichever was used last, in one half, heat in the other; clicking Split
 *   again swaps the halves)
 *   the options of what's in the upper part: the line's (or bars')
 *   Pre / Post / Overlay (only while our EQ is applied) and Hold, or heat's
 *   own Pre / Post (likewise) and the heat sensitivity
 *
 * Split view stacks the lower half's options up the left edge from the
 * bottom left corner, so swapping the halves swaps their controls too.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop } from '../../audio/spectrum-source';
import { useIsBypassed } from '../../state/bypass';
import { useEqFile } from '../../state/eq-file';
import { useEq, type HeatLines, type SpectrumDisplay, type SpectrumLines } from '../../state/store';
import { HeatSensitivity } from '../bar/HeatSensitivity';
import { BarsViewIcon, FullscreenIcon, HeatViewIcon, LineViewIcon, PowerIcon } from '../common/icons';
import { Button } from '../common/Button';
import { TOOLTIPS } from '../tooltips';

const DISPLAYS: { id: SpectrumDisplay; label: ReactNode; title: string }[] = [
  { id: 'line', label: <LineViewIcon />, title: TOOLTIPS.graph.display.line },
  { id: 'bars', label: <BarsViewIcon />, title: TOOLTIPS.graph.display.bars },
  { id: 'heat', label: <HeatViewIcon />, title: TOOLTIPS.graph.display.heat },
];

/**
 * While our EQ shapes the captured sound, the analyzer can show the sound
 * before it, after it, or both overlaid (red = before, cyan = after, with
 * the boost/cut bands between them).
 */
const LINES: { id: SpectrumLines; label: string; title: string }[] = [
  { id: 'pre', label: 'Pre', title: TOOLTIPS.graph.lines.pre },
  { id: 'post', label: 'Post', title: TOOLTIPS.graph.lines.post },
  { id: 'overlay', label: 'Overlay', title: TOOLTIPS.graph.lines.overlay },
];

/** The heat view's version: a stripe has one color per frequency, so no overlay. */
const HEAT_LINES: { id: HeatLines; label: string; title: string }[] = [
  { id: 'pre', label: 'Pre', title: TOOLTIPS.graph.heatLines.pre },
  { id: 'post', label: 'Post', title: TOOLTIPS.graph.heatLines.post },
];

/**
 * The graph alone fills the screen (analyzer, curve and nodes, still
 * editable); click again or Esc to come back. Uses the page's Fullscreen
 * API on the graph element, so it re-lays itself out at the new size.
 */
function FullscreenButton() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => {
      const on = document.fullscreenElement !== null;
      setFull(on);
      // Desktop: the element only fills the web view; the window has to
      // cover the screen too (and give it back when Esc leaves fullscreen).
      if (isDesktop) getCurrentWindow().setFullscreen(on).catch(() => {});
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return (
    <Button className="toggle" on={full} aria-pressed={full} aria-label="Fullscreen"
      title={TOOLTIPS.graph.fullscreen(full)}
      onClick={(e) => {
        if (full) void document.exitFullscreen();
        else void e.currentTarget.closest<HTMLElement>('.graph')?.requestFullscreen();
      }}>
      <FullscreenIcon exit={full} />
    </Button>
  );
}

export function GraphTools() {
  const display = useEq((s) => s.display);
  const swapped = useEq((s) => s.splitSwapped);
  const peakHold = useEq((s) => s.peakHold);
  const lines = useEq((s) => s.lines);
  const heatLines = useEq((s) => s.heatLines);
  const heatPalette = useEq((s) => s.heatPalette);
  const levelView = useEq((s) => s.levelView);
  const { setDisplay, swapSplit, setPeakHold, setLines, setHeatLines, setHeatPalette } = useEq.getState();
  // Same test as Spectrum: is OUR EQ what's applied to the captured sound?
  const eqIncluded = useEqFile((s) => !!s.included);
  const bypass = useIsBypassed();
  // (Browser: no sound, so never.)
  const compare = isDesktop && eqIncluded && !bypass;
  const split = display === 'split';
  // The view the power button brings back after switching everything off.
  const lastOn = useRef<SpectrumDisplay>('line');
  // Clicks here must not reach the graph (that would deselect the band).
  const keep = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  // The line's (or the bars') options: Pre / Post / Overlay while our EQ is
  // applied, then Hold. The corner stacks bottom-up, so first here = lowest there.
  const bars = display === 'bars' || (split && levelView === 'bars');
  const lineOpts = (
    <>
      {compare && (
        // One box: each click steps Pre → Post → Overlay → Pre.
        <Button title={`${LINES.find((l) => l.id === lines)!.title} (click: next)`}
          onClick={() => setLines(LINES[(LINES.findIndex((l) => l.id === lines) + 1) % LINES.length]!.id)}>
          {LINES.find((l) => l.id === lines)!.label}
        </Button>
      )}
      <Button className="toggle" on={peakHold} aria-pressed={peakHold}
        onClick={() => setPeakHold(!peakHold)}
        title={TOOLTIPS.graph.peakHold(bars)}>
        Hold
      </Button>
    </>
  );
  const heatOpts = (
    <>
      {compare && (
        <Button title={`${HEAT_LINES.find((l) => l.id === heatLines)!.title} (click: switch)`}
          onClick={() => setHeatLines(heatLines === 'pre' ? 'post' : 'pre')}>
          {HEAT_LINES.find((l) => l.id === heatLines)!.label}
        </Button>
      )}
      <HeatSensitivity />
    </>
  );
  // The top row carries the options of what's in the upper part of the graph;
  // in split view the lower half's options stack up from the bottom left corner.
  const top = display === 'line' || display === 'bars' ? lineOpts : display === 'heat' ? heatOpts : split ? (swapped ? heatOpts : lineOpts) : null;
  const corner = split ? (swapped ? lineOpts : heatOpts) : null;

  return (
    <>
      <div className="graph-toolbar" {...keep}>
        <div className="graph-tools-row" role="group" aria-label="Analyzer view">
          <Button className="view" on={display !== 'off'} aria-pressed={display !== 'off'} aria-label="Analyzer on/off"
            title={TOOLTIPS.graph.analyzerPower(display !== 'off')}
            onClick={() => {
              if (display !== 'off') lastOn.current = display;
              setDisplay(display !== 'off' ? 'off' : lastOn.current);
            }}>
            <PowerIcon />
          </Button>
          {DISPLAYS.map((d) => {
            // Heat, already on: the button switches its palette, as Split swaps its halves.
            const palette = d.id === 'heat' && display === 'heat';
            return (
              <Button key={d.id} className="view" on={display === d.id} aria-pressed={display === d.id}
                title={palette ? TOOLTIPS.graph.heatPalette(heatPalette) : d.title}
                aria-label={typeof d.label === 'string' ? undefined : d.title.split(':')[0]}
                onClick={() => (palette ? setHeatPalette(heatPalette === 'ice' ? 'fire' : 'ice') : setDisplay(d.id))}>
                {d.label}
              </Button>
            );
          })}
          {/* Off: split view. On: swaps the halves (and their controls). */}
          <Button className="toggle" on={split} aria-pressed={split}
            title={TOOLTIPS.graph.split(split, levelView)}
            onClick={() => (split ? swapSplit() : setDisplay('split'))}>
            Split
          </Button>
        </div>
        {top && <div className="graph-tools-row">{top}</div>}
      </div>
      {corner && <div className="graph-corner graph-tools-row" {...keep}>{corner}</div>}
      <div className="graph-fullscreen" {...keep}><FullscreenButton /></div>
    </>
  );
}
