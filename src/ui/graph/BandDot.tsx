/**
 * One band's handle on the graph: a translucent disc with a colored ring and
 * number, and two arcs (top and bottom) that grow symmetrically with Q.
 * Empty arcs = widest band, nearly full rings = narrowest.
 *
 * Three looks, dimmest to brightest, so you can read the EQ at a glance:
 * flat (not changing the sound) · shaping · selected (neon).
 * Switched-off bands are only drawn while touched, dimmed (EqGraph).
 * Hover lights a node up on top of that. Colors live in index.css (".dot").
 */
import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from 'react';
import type { Band } from '../../eapo/types';
import { FILTER_INFO, hasQ } from '../../eapo/types';
import { PARAMS } from '../../state/params';
import { bandColor } from '../theme/active';

/** Translucent disc you grab: twice the fader circle (18 px), easy to hit. */
const DISC_R = 18;
/** Q arcs sit just outside the disc. */
const ARC_R = 23;

function qArcs(q: number): string {
  const half = Math.max(0.05, PARAMS.q.toNorm(q)) * 82; // degrees each side of the arc's middle
  const pt = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return `${(ARC_R * Math.sin(r)).toFixed(2)} ${(-ARC_R * Math.cos(r)).toFixed(2)}`;
  };
  const arc = (mid: number) => `M${pt(mid - half)} A${ARC_R} ${ARC_R} 0 0 1 ${pt(mid + half)}`;
  return `${arc(0)} ${arc(180)}`;
}

export interface DotHandlers {
  onPointerDown(e: RPointerEvent): void;
  onPointerMove(e: RPointerEvent): void;
  onPointerUp(e: RPointerEvent): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
  onDoubleClick(e: RMouseEvent): void;
  onContextMenu(e: RMouseEvent): void;
}

/** A bell or shelf at 0 dB does nothing; cuts and notches always shape the sound. */
const isFlat = (b: Band) => FILTER_INFO[b.type].hasGain && b.gain === 0;

export function BandDot({ band, index, x, y, hot, selected, handlers }: {
  band: Band;
  index: number;
  x: number;
  y: number;
  /** Hovered, dragged or touched in the panel. */
  hot: boolean;
  selected: boolean;
  handlers: DotHandlers;
}) {
  const state = !band.enabled ? 'off' : isFlat(band) ? 'flat' : '';
  return (
    <g
      className={`dot ${state} ${hot ? 'hot' : ''} ${selected ? 'selected' : ''}`}
      transform={`translate(${x},${y})`}
      style={{ '--band': bandColor(index) } as React.CSSProperties}
      {...handlers}
      onPointerCancel={handlers.onPointerUp}
    >
      <circle r={ARC_R + 6} className="hit" />
      {/* Dark base first, so the curve and spectrum behind don't show through the number. */}
      <circle r={DISC_R} className="disc-base" />
      <circle r={DISC_R} className="disc" />
      <circle r={ARC_R} className="q-track" />
      {hasQ(band.type) && <path d={qArcs(band.q)} className="q-arcs" />}
      <text y={8} textAnchor="middle">{index + 1}</text>
    </g>
  );
}
