import { useRef, useCallback } from 'react';

export interface VirtualScrollOptions {
  totalItems: number;
  getItemHeight: (index: number) => number;
  containerHeight: number;
  overscan?: number;
}

export interface VirtualScrollResult {
  startIndex: number;
  endIndex: number;
  offsetY: number;
  totalHeight: number;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

export function useVirtualScroll(
  opts: VirtualScrollOptions,
  _forceUpdate: () => void
): VirtualScrollResult {
  const { totalItems, getItemHeight, containerHeight, overscan = 8 } = opts;
  const scrollTopRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Build cumulative heights
  const heights: number[] = [];
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < totalItems; i++) {
    offsets.push(acc);
    const h = getItemHeight(i);
    heights.push(h);
    acc += h;
  }
  const totalHeight = acc;

  const scrollTop = scrollTopRef.current;

  // Find startIndex
  let startIndex = 0;
  for (let i = 0; i < totalItems; i++) {
    if (offsets[i] + heights[i] > scrollTop) { startIndex = i; break; }
  }

  // Find endIndex
  let endIndex = startIndex;
  for (let i = startIndex; i < totalItems; i++) {
    if (offsets[i] > scrollTop + containerHeight) { endIndex = i - 1; break; }
    else endIndex = i;
  }

  // Apply overscan
  startIndex = Math.max(0, startIndex - overscan);
  endIndex = Math.min(totalItems - 1, endIndex + overscan);

  const offsetY = offsets[startIndex] ?? 0;

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = (e.target as HTMLDivElement).scrollTop;
    scrollTopRef.current = newScrollTop;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      _forceUpdate();
    });
  }, [_forceUpdate]);

  return { startIndex, endIndex, offsetY, totalHeight, onScroll };
}
