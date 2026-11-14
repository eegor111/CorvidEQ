import { useCallback, useState } from 'react';

/** Tracks an element's size with ResizeObserver; returns a callback ref. */
export function useElementSize<T extends Element>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    // React 19: returning a function from a callback ref = cleanup.
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
