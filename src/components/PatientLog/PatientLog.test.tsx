import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualScroll } from './useVirtualScroll';
import { useReducer } from 'react';

function useForceUpdate() {
  const [, dispatch] = useReducer((x: number) => x + 1, 0);
  return dispatch;
}

describe('useVirtualScroll', () => {
  it('does not render all 400 items when container is 600px', () => {
    const TOTAL = 400;
    const ITEM_H = 44;
    const CONTAINER_H = 600;

    let forceUpdate: (() => void) | null = null;

    const { result } = renderHook(() => {
      const fu = useForceUpdate();
      forceUpdate = fu;
      return useVirtualScroll(
        { totalItems: TOTAL, getItemHeight: () => ITEM_H, containerHeight: CONTAINER_H },
        fu
      );
    });

    const { startIndex, endIndex } = result.current;
    const visibleCount = endIndex - startIndex + 1;

    // With overscan 8, max visible ≈ ceil(600/44) + 16 = ~28
    expect(visibleCount).toBeLessThanOrEqual(28);
    expect(visibleCount).toBeGreaterThan(0);

    // Use the variable to avoid lint warning
    expect(forceUpdate).not.toBeNull();
  });

  it('totalHeight equals sum of all item heights', () => {
    let forceUpdate: (() => void) | null = null;
    const heights = [44, 140, 44, 44, 140, 44];
    const { result } = renderHook(() => {
      const fu = useForceUpdate();
      forceUpdate = fu;
      return useVirtualScroll(
        { totalItems: 6, getItemHeight: (i) => heights[i], containerHeight: 300 },
        fu
      );
    });
    expect(result.current.totalHeight).toBe(heights.reduce((a, b) => a + b, 0));
    expect(forceUpdate).not.toBeNull();
  });

  it('changing item height (expanded) increases totalHeight', () => {
    const heights = [44, 44, 44, 44, 44];
    let forceUpdate: (() => void) | null = null;

    const { result, rerender } = renderHook(
      ({ heights }: { heights: number[] }) => {
        const fu = useForceUpdate();
        forceUpdate = fu;
        return useVirtualScroll(
          { totalItems: heights.length, getItemHeight: (i) => heights[i], containerHeight: 300 },
          fu
        );
      },
      { initialProps: { heights } }
    );

    const before = result.current.totalHeight;

    act(() => {
      heights[1] = 140; // expand row 1
    });

    rerender({ heights: [...heights] });
    expect(result.current.totalHeight).toBeGreaterThan(before);
    expect(forceUpdate).not.toBeNull();
  });
});
