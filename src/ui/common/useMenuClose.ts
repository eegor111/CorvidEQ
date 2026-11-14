/**
 * Shared by every popup menu: close on Escape (captured first, so it doesn't
 * reach other shortcuts) or on a press outside the menu. `anchor` is the
 * button that opened it: pressing it again shouldn't count as "outside".
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useMenuClose(
  menu: RefObject<Element | null>,
  onClose: () => void,
  anchor?: RefObject<Element | null>,
  enabled = true,
) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !anchor?.current?.contains(t)) closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [menu, anchor, enabled]);
}
