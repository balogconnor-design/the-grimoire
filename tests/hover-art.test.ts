import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_H, ART_W, HOVER_DELAY_MS, hideArt, hoverArt, hoverArtStateForTests, placeArt, resetHoverArtForTests } from '../src/components/HoverArt';
import { card } from './helpers';

describe('placing the hover art', () => {
  it('goes right of the pointer when there is room, left when there is not', () => {
    expect(placeArt(100, 400, 1600, 900).left).toBe(124);
    expect(placeArt(1500, 400, 1600, 900).left).toBe(1500 - 24 - ART_W);
  });

  it('stays inside a narrow window when neither side fits', () => {
    const { left } = placeArt(200, 400, 420, 900);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + ART_W).toBeLessThanOrEqual(420 - 8);
  });

  it('is centred on the pointer but kept inside the top and bottom', () => {
    expect(placeArt(100, 450, 1600, 900).top).toBe(450 - ART_H / 2);
    expect(placeArt(100, 10, 1600, 900).top).toBe(8);
    expect(placeArt(100, 890, 1600, 900).top).toBe(900 - 8 - ART_H);
  });
});

describe('hover delay', () => {
  const sol = card('Sol Ring', { image_uris: { normal: 'sol.jpg' } as never });
  const bolt = card('Lightning Bolt', { image_uris: { normal: 'bolt.jpg' } as never });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { innerWidth: 1600, innerHeight: 900 });
    resetHoverArtForTests();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('waits before showing, and a quick pass over a card shows nothing', () => {
    hoverArt(sol, 100, 400);
    vi.advanceTimersByTime(HOVER_DELAY_MS - 50);
    expect(hoverArtStateForTests()).toBeNull();
    hideArt(); // left before the delay
    vi.advanceTimersByTime(1000);
    expect(hoverArtStateForTests()).toBeNull();
  });

  it('shows after the delay where the pointer ended up', () => {
    hoverArt(sol, 100, 400);
    hoverArt(sol, 1500, 400); // moved while waiting
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(hoverArtStateForTests()).toMatchObject({ src: 'sol.jpg', left: 1500 - 24 - ART_W });
  });

  it('swaps straight to the next card once art is showing, or just after', () => {
    hoverArt(sol, 100, 400);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    hideArt();
    hoverArt(bolt, 100, 430); // within the grace period
    expect(hoverArtStateForTests()?.src).toBe('bolt.jpg');
  });
});
