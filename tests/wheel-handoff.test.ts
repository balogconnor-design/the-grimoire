import { describe, expect, it } from 'vitest';
import { canScrollFurther, wheelPixels } from '../src/lib/wheelHandoff';

describe('wheel handoff', () => {
  it('knows when a panel has reached its end', () => {
    expect(canScrollFurther(0, 500, 400, 100)).toBe(true); // room below
    expect(canScrollFurther(100, 500, 400, 100)).toBe(false); // at the bottom
    expect(canScrollFurther(0, 500, 400, -100)).toBe(false); // at the top, going up
    expect(canScrollFurther(50, 500, 400, -100)).toBe(true);
    expect(canScrollFurther(0, 400, 400, 100)).toBe(false); // nothing to scroll
  });
  it('turns lines and pages into pixels', () => {
    expect(wheelPixels(120, 0, 800)).toBe(120);
    expect(wheelPixels(3, 1, 800)).toBe(99);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });
});
