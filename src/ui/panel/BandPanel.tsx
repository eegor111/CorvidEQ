/**
 * Band panel: one column per band, plus a Level column (Equalizer APO's preamp).
 * Sits at the right edge of the window.
 *
 * Level column first (its foot also labels the knob rows), then one column per
 * band: filter shape, gain fader, Freq knob, and the Q knob beside the bottom
 * bar. Every control edits exactly one parameter. On/off (mute), solo, moving
 * and resets are in the band menu (right-click the shape button or the fader).
 */
import { useCallback, useRef, useState } from 'react';
import { FILTER_INFO, hasQ, type Band } from '../../eapo/types';
import { paramDef, type BandParam } from '../../state/params';
import { PREAMP_ID, useEq } from '../../state/store';
import { FilterIcon } from '../common/icons';
import { FilterMenu } from '../common/FilterMenu';
import { bandColor } from '../theme/active';
import { useWheelSteps } from '../common/useWheelSteps';
import { BandMenu } from './BandMenu';
import { LevelMenu } from './LevelMenu';
import { Fader, Knob, type ControlProps } from './controls';
import { TOOLTIPS } from '../tooltips';

/** Wire a band parameter to a control: everything comes from params + store. */
function bandControl(band: Band, key: BandParam, label: string, color: string, title?: string): ControlProps {
  const s = useEq.getState();
  return {
    focusId: band.id,
    norm: paramDef(key, s.viewDb).toNorm(band[key]),
    setNorm: (n) => s.setParamNorm(band.id, key, n),
    step: (dir, fine) => s.stepParam(band.id, key, dir, fine),
    reset: () => s.resetParam(band.id, key),
    label,
    color,
    title,
  };
}

function BandColumn({ band, index }: { band: Band; index: number }) {
  useEq((s) => s.viewDb); // re-render when the zoom changes (gain fader travel follows it)
  const selected = useEq((s) => s.selectedId === band.id);
  // Its node is hovered or dragged on the graph: the fader lights up as if hovered.
  const graphHot = useEq((s) => s.graphHotId === band.id);
  // Solo: 'solo' = this band is the one you hear alone, 'muted' = another one is.
  const solo = useEq((s) => (s.soloId === null ? '' : s.soloId === band.id ? 'solo' : 'muted'));
  const { focus, select, cycleType } = useEq.getState();
  const typeRef = useRef<HTMLButtonElement>(null);
  const color = bandColor(index);
  const info = FILTER_INFO[band.type];
  const hover = { onPointerEnter: () => focus(band.id), onPointerLeave: () => focus(null) };

  // Shape: click opens a dropdown; the wheel still cycles through the shapes.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const toggleMenu = () => {
    if (menuAt) return closeMenu();
    const r = typeRef.current!.getBoundingClientRect();
    // Below the button (FilterMenu keeps itself inside the window).
    setMenuAt({ x: r.left, y: r.bottom + 6 });
  };
  useWheelSteps(typeRef, () => (dir) => cycleType(band.id, dir === 1 ? -1 : 1));

  // Fader right-click: the band menu (BandMenu), at the pointer.
  const [bandMenuAt, setBandMenuAt] = useState<{ x: number; y: number } | null>(null);
  const closeBandMenu = useCallback(() => setBandMenuAt(null), []);

  return (
    <div
      className={`band-col ${selected ? 'selected' : ''} ${graphHot ? 'graph-hot' : ''} ${band.enabled ? '' : 'off'} ${solo}`}
      style={{ '--band': color } as React.CSSProperties}
      // Touching any of the band's controls selects it (its values show on the graph).
      onPointerDown={() => select(band.id)}
    >
      {/* The column's four cells line up with the app's four rows:
          heads · graph · (heat strip) · frequency scale · bottom bar. */}
      <div className="col-head">
          <button
            ref={typeRef}
            className={`type ${menuAt ? 'on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={!!menuAt}
            title={TOOLTIPS.bandPanel.shapeButton(index, info.label, band.enabled)}
            {...hover}
            onClick={toggleMenu}
            // The same band menu as the fader's (solo, mute, move, reset).
            onContextMenu={(e) => { e.preventDefault(); closeMenu(); setBandMenuAt({ x: e.clientX, y: e.clientY }); }}
          >
            <FilterIcon type={band.type} size={22} />
          </button>
          {menuAt && (
            <FilterMenu band={band} anchor={typeRef} onClose={closeMenu} at={menuAt} />
          )}
      </div>
      <div
        className="col-fader"
        title={TOOLTIPS.bandPanel.faderCell}
        // "contextmenu" covers every kind of right-click (mouse, touchpad tap,
        // menu key). The web view's own menu is blocked app-wide (main.tsx).
        onContextMenu={(e) => { e.preventDefault(); setBandMenuAt({ x: e.clientX, y: e.clientY }); }}
      >
        <Fader {...bandControl(band, 'gain', `Band ${index + 1} gain`, color, TOOLTIPS.bandPanel.gainFader)} disabled={!info.hasGain} />
      </div>
      {bandMenuAt && <BandMenu band={band} index={index} at={bandMenuAt} onClose={closeBandMenu} />}
      <div className="col-freq">
        <Knob {...bandControl(band, 'freq', `Band ${index + 1} frequency`, color, TOOLTIPS.bandPanel.freqKnob)} />
      </div>
      <div className="col-q">
        <Knob {...bandControl(band, 'q', `Band ${index + 1} Q (width)`, color, TOOLTIPS.bandPanel.qKnob)} disabled={!hasQ(band.type)} />
      </div>
    </div>
  );
}

/** Overall level = Equalizer APO's preamp. "Auto" keeps the loudest point at 0 dB minus the headroom (Level menu). */
function LevelColumn() {
  const settings = useEq((s) => s.settings);
  const autoGain = useEq((s) => s.autoGain);
  // Spans the graph's zoom like the gain faders, so it lines up with the dB scale.
  const level = paramDef('preamp', useEq((s) => s.viewDb));
  const { setPreamp, setAutoGain, checkpoint, focus } = useEq.getState();
  const hover = { onPointerEnter: () => focus(PREAMP_ID), onPointerLeave: () => focus(null) };
  // Fader right-click: the Level menu (LevelMenu), at the pointer.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);

  return (
    <div className="band-col level" style={{ '--band': 'var(--curve)' } as React.CSSProperties}>
      <div className="col-head">
          <button
            className={`type auto ${autoGain ? 'on' : ''}`}
            aria-pressed={autoGain}
            title={TOOLTIPS.bandPanel.autoButton}
            {...hover}
            onClick={() => { checkpoint(); setAutoGain(!autoGain); }}
          >
            Auto
          </button>
      </div>
      <div className="col-fader" title={TOOLTIPS.bandPanel.levelCell}
        onContextMenu={(e) => { e.preventDefault(); setMenuAt({ x: e.clientX, y: e.clientY }); }}>
        <Fader
          focusId={PREAMP_ID}
          label="Level"
          title={TOOLTIPS.bandPanel.levelFader}
          color="var(--curve)"
          norm={level.toNorm(settings.preamp)}
          setNorm={(n) => setPreamp(level.fromNorm(n))}
          step={(dir, fine) => setPreamp(level.step(settings.preamp, dir, fine))}
          reset={() => setAutoGain(true)}
        />
      </div>
      {menuAt && <LevelMenu at={menuAt} onClose={closeMenu} />}
      {/* Row labels for the knobs to the right, written once instead of under every band. */}
      <div className="col-freq row-label">Freq</div>
      {/* Q ends where "Freq" ends: a hidden "Freq" in the same cell gives the box its width. */}
      <div className="col-q row-label">
        <span className="label-under">
          <span className="sizer" aria-hidden="true">Freq</span>
          <span>Q</span>
        </span>
      </div>
    </div>
  );
}

/** Past this many bands, the panel splits into two rows (decks). */
const DECK_SIZE = 10;

/**
 * Column width: up to 7 bands per row keep the full 48 px (--col-max); from 8
 * to 10 the columns get narrower step by step (the graph gives up the rest of
 * the room). Never by window width: the spacing stays put while resizing.
 */
const columnWidth = (count: number) => Math.max(42, 48 - Math.max(0, count - 7) * 2);

/**
 * Up to 10 bands, the panel's rows line up with the app's (subgrid), so each
 * fader is exactly as tall as the graph.
 *
 * From 11 bands on, the bands are split evenly over two decks stacked on top
 * of each other (the top one gets the odd band), each with its own heads,
 * faders and knobs. The faders are then
 * about half as tall and no longer line up with the graph's dB lines (their
 * travel still covers the same dB range, measured from the bar). The Level
 * column stays full height on the left, still lined up with the graph.
 */
export function BandPanel() {
  const bands = useEq((s) => s.settings.bands);
  const split = bands.length > DECK_SIZE;
  // Split evenly (the top row gets the extra one), so the panel is only as
  // wide as half the bands: 11 bands = 6 + 5, 20 = 10 + 10.
  const perRow = split ? Math.ceil(bands.length / 2) : bands.length;
  const columns = `repeat(${perRow}, min(var(--col-w), var(--col-max)))`;
  const style = {
    '--col-w': `${columnWidth(perRow)}px`,
    // The Level column keeps its full width; only band columns get narrower.
    gridTemplateColumns: split ? 'var(--level-w) auto' : `var(--level-w) ${columns}`,
  } as React.CSSProperties;
  const column = (b: Band, i: number) => <BandColumn key={b.id} band={b} index={i} />;

  return (
    <aside className={`band-panel ${split ? 'split' : ''}`} style={style}>
      <LevelColumn />
      {split ? (
        <div className="band-decks">
          {[bands.slice(0, perRow), bands.slice(perRow)].map((deck, d) => (
            // Same column template in both decks, so the first band of the
            // lower row sits under band 1.
            <div key={d} className="band-deck" style={{ gridTemplateColumns: columns }}>
              {deck.map((b, i) => column(b, d * perRow + i))}
            </div>
          ))}
        </div>
      ) : (
        bands.map(column)
      )}
    </aside>
  );
}
