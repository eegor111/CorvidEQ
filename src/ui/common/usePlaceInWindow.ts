/**
 * Placement for popup menus: opens at (x, y) in window coordinates, then is
 * measured and moved back inside the window if it would stick out (right or
 * bottom edge: it shifts left / up). A menu taller than the window gets a
 * max height and scrolls. Measured, not guessed: menus change length.
 *
 * Runs in a layout effect, so the correction happens before anything is
 * painted: the menu never flashes in the wrong place.
 */
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** Space kept between a menu and the window edge. */
const EDGE = 8;

/** `content`: anything that changes the menu's size while open, to measure again. */
export function usePlaceInWindow(menu: RefObject<HTMLElement | null>, x: number, y: number, content?: unknown): CSSProperties {
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const room = window.innerHeight - 2 * EDGE;
    // Measuring the DOM and correcting before paint is what layout effects
    // are for; the second render happens before anything is shown.
    // oxlint-disable-next-line react/set-state-in-effect
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - w - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - Math.min(h, room) - EDGE)),
      maxHeight: h > room ? room : undefined,
    });
  }, [menu, x, y, content]);

  return { position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxHeight, overflowY: pos.maxHeight ? 'auto' : undefined };
}
