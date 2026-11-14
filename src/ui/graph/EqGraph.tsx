/**
 * The graph: analyzer, grid, EQ curve and the draggable band dots.
 *
 *   drag dot          left/right = frequency, up/down = gain (Shift = fine)
 *   wheel             Q of the dot under the pointer
 *   click dot         select it: its values show on the graph's top edge
 *   click empty space deselect
 *   double-click dot  reset its gain
 *   right-click dot   menu: filter shape, on/off
 *
 * This component owns only the interaction state (drag, hover, menu). The
 * drawing is split into GraphGrid, BandDot, FilterMenu and Spectrum.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { FILTER_INFO, clamp, type Band } from '../../eapo/types';
import { roundGain } from '../../state/params';
import { useShallow } from 'zustand/react/shallow';
import { PREAMP_ID, appliedSettings, useEq } from '../../state/store';
import { bandColor } from '../theme/active';
import { useElementSize } from '../common/useElementSize';
import { useWheelSteps } from '../common/useWheelSteps';
import { FilterMenu } from '../common/FilterMenu';
import { BandDot } from './BandDot';
import { freqToX, gainToY, xToFreq, yToGain } from './geometry';
import { GraphGrid } from './GraphGrid';
import { GraphTools } from './GraphTools';
import { Spectrum } from './Spectrum';
import { Bars } from './Bars';
import { BandCross, BandReadout, Crosshair } from './Readout';
import { useCurves } from './useCurves';

/** Shift-drag moves at this fraction of the mouse speed. */
const FINE = 0.15;

interface Drag {
  id: string;
  pointer: number;
  /** The dot being dragged, which holds the pointer capture. */
  el: Element;
  /** Pointer and dot position when the drag started (px). */
  start: { x: number; y: number };
  origin: { x: number; y: number };
}

export function EqGraph() {
  // Only what the graph draws: re-render on these, not on every store change.
  const { settings, focusId, selectedId, soloId, autoGain, headroom, viewDb, showHeard } = useEq(useShallow((s) => ({
    settings: s.settings, focusId: s.focusId, selectedId: s.selectedId, soloId: s.soloId, autoGain: s.autoGain, headroom: s.headroom,
    viewDb: s.viewDb, showHeard: s.showHeard,
  })));
  const { updateBand, checkpoint, stepParam, select } = useEq.getState();
  const bands = settings.bands;
  // The curves show what you hear: with a band soloed, just that band.
  const applied = useMemo(() => appliedSettings({ settings, soloId, autoGain, headroom }), [settings, soloId, autoGain, headroom]);

  const [containerRef, box] = useElementSize<HTMLDivElement>();
  const size = useMemo(() => ({ ...box, db: viewDb }), [box, viewDb]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const { responses, total, heard, other, toPath, toArea } = useCurves(
    applied.bands,
    applied.preamp,
    size,
    applied.split?.on ? applied.split.other : undefined,
  );

  // Gainless shapes (cuts, notch) sit on the 0 dB line. Gains beyond the
  // current zoom are pinned to the edge so the node stays reachable.
  const dotY = (b: Band) => gainToY(FILTER_INFO[b.type].hasGain ? clamp(b.gain, -viewDb, viewDb) : 0, size);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Wheel = Q of the band under the pointer.
  useWheelSteps(svgRef, () => {
    const id = hoverId;
    return id ? (dir, fine) => stepParam(id, 'q', dir, fine) : null;
  });

  const dotHandlers = (b: Band) => ({
    onPointerDown: (e: RPointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      setMenu(null);
      select(b.id);
      checkpoint(); // the whole drag is one undo step
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id: b.id, pointer: e.pointerId, el: e.currentTarget, start: local(e), origin: { x: freqToX(b.freq, size), y: dotY(b) } });
    },
    onPointerMove: (e: RPointerEvent) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      const p = local(e);
      const k = e.shiftKey ? FINE : 1;
      const x = drag.origin.x + (p.x - drag.start.x) * k;
      const y = drag.origin.y + (p.y - drag.start.y) * k;
      updateBand(drag.id, {
        freq: xToFreq(x, size),
        ...(FILTER_INFO[b.type].hasGain ? { gain: roundGain(clamp(yToGain(y, size), -viewDb, viewDb)) } : {}),
      });
    },
    onPointerUp: (e: RPointerEvent) => {
      if (drag?.pointer === e.pointerId) setDrag(null);
    },
    onPointerEnter: () => setHoverId(b.id),
    onPointerLeave: () => setHoverId((h) => (h === b.id ? null : h)),
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      // Back to its home spot: gain 0 and home frequency (Q stays).
      useEq.getState().resetGainFreq(b.id);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      select(b.id);
      // At the pointer; FilterMenu keeps itself inside the window.
      setMenu({ id: b.id, x: e.clientX, y: e.clientY });
    },
  });

  // Pressing a node selects it, which moves it to the end of the SVG (see
  // `drawOrder`). The browser treats that move as a removal and drops the
  // pointer capture, so take it again or the drag would stop following the mouse.
  useLayoutEffect(() => {
    if (drag) drag.el.setPointerCapture(drag.pointer);
  }, [drag, selectedId]);

  // A node hovered or dragged here lights up its fader in the panel too.
  const graphHot = drag?.id ?? hoverId;
  useEffect(() => { useEq.getState().setGraphHot(graphHot); }, [graphHot]);

  // Whatever band you're touching (a dot here, or a control in the side panel) lights up.
  const activeId = graphHot ?? focusId;
  const highlight = bands.findIndex((b) => b.id === activeId);
  const shown = (b: Band) => b.enabled || b.id === soloId || b.id === activeId;
  // SVG has no z-index: what's drawn last is on top. Band order (higher number
  // over lower), except that the selected band always rises above the rest.
  const drawOrder = bands.map((_, i) => i);
  const selectedIndex = bands.findIndex((b) => b.id === selectedId);
  if (selectedIndex >= 0) drawOrder.push(...drawOrder.splice(selectedIndex, 1));
  // Readout: the band you're touching, else the selected one.
  const readoutIndex = highlight >= 0 ? highlight : bands.findIndex((b) => b.id === selectedId);
  const menuBand = menu && bands.find((b) => b.id === menu.id);
  const ready = size.width > 0;
  const barsShown = useEq((s) => s.display === 'bars' || (s.display === 'split' && s.levelView === 'bars'));

  return (
    <div className="graph" ref={containerRef} onContextMenu={(e) => e.preventDefault()}>
      <Spectrum width={size.width} height={size.height} />
      {barsShown && <Bars width={size.width} height={size.height} />}
      <svg ref={svgRef} className="plot" width={size.width} height={size.height} onPointerDown={() => { setMenu(null); select(null); }}>
        <defs>
          <linearGradient id="curveFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--curve)" stopOpacity="0.22" />
            <stop offset="0.5" stopColor="var(--curve)" stopOpacity="0.02" />
            <stop offset="1" stopColor="var(--curve)" stopOpacity="0.22" />
          </linearGradient>
        </defs>

        <GraphGrid view={size} />

        {ready && highlight >= 0 && (
          <path className="band-area" d={toArea(responses[highlight]!)} fill={bandColor(highlight, 0.14)} stroke={bandColor(highlight, 0.6)}
            strokeWidth={2} pointerEvents="none" />
        )}

        {ready && (
          <>
            <path className="curve-fill" d={toArea(total)} fill="url(#curveFill)" pointerEvents="none" />
            {other && <path d={toPath(other)} className="curve-other" pointerEvents="none" />}
            <path d={toPath(total)} className="curve" pointerEvents="none" />
            {/* What you hear: the shape plus the preamp (only differs when the preamp
                isn't 0). Lights up while the pointer is on the Level column. */}
            {showHeard && Math.abs(applied.preamp) > 0.05 && (
              <path d={toPath(heard)} className={`curve-heard ${focusId === PREAMP_ID ? 'hot' : ''}`} pointerEvents="none" />
            )}
          </>
        )}

        {/* Switched-off bands leave the graph, except while you touch them
            (hover their panel column), so you can see what they'd do. Bands
            muted by a solo stay, dimmed (drawn from `applied`), so you can still grab them. */}
        {drawOrder.map((i) => {
          const b = bands[i]!;
          return shown(b) && (
            <BandDot key={b.id} band={applied.bands[i]!} index={i} x={freqToX(b.freq, size)} y={dotY(b)}
              hot={b.id === activeId} selected={b.id === selectedId} handlers={dotHandlers(b)} />
          );
        })}
      </svg>

      {/* Crosshairs: the selected band's, the touched band's (if another one),
          and the pointer's over empty graph. A switched-off band only gets one
          while touched, like its node. */}
      {ready && [...new Set([selectedId, activeId])].map((id) => {
        const i = bands.findIndex((b) => b.id === id);
        const b = bands[i];
        return b && shown(b) ? <BandCross key={b.id} band={b} index={i} x={freqToX(b.freq, size)} y={dotY(b)} view={size} /> : null;
      })}
      {ready && <Crosshair target={svgRef} view={size} />}
      <GraphTools />
      {/* Top right, above the toolbar: it only shows while a band is touched
          or selected, so it may cover a button for that moment. */}
      {readoutIndex >= 0 && (
        // Keyed by band, so a half-typed value never carries over to another band.
        <BandReadout
          key={bands[readoutIndex]!.id}
          band={bands[readoutIndex]!}
          index={readoutIndex}
          editable={bands[readoutIndex]!.id === selectedId}
          // Showing the selected band: bright, like its node, also while
          // it's hovered or dragged (so it lights up the moment it's clicked).
          bright={bands[readoutIndex]!.id === selectedId}
        />
      )}
      {menuBand && <FilterMenu band={menuBand} at={menu} withPower onClose={closeMenu} />}
    </div>
  );
}
