import { useEffect, type RefObject } from 'react';

/**
 * Firefox ties a run of mouse-wheel turns to the first panel that scrolled. On mid-size screens Card
 * Search is a sticky column with its own scroll; once it reached its end, the page wouldn't move
 * until you stopped turning the wheel for a moment. This passes the wheel on to the page whenever
 * nothing under the pointer (inside `ref`) can scroll any further that way.
 */

const LINE_PX = 33; // Firefox reports wheel turns in lines (3 per notch); about 100 px a notch, like its own scrolling.

/** Can `el` scroll further in the direction of `dy` (positive = down)? */
export function canScrollFurther(scrollTop: number, scrollHeight: number, clientHeight: number, dy: number): boolean {
  if (scrollHeight - clientHeight < 1) return false;
  return dy > 0 ? scrollTop + clientHeight < scrollHeight - 1 : scrollTop > 0;
}

/** Wheel delta in pixels from a WheelEvent's deltaY and deltaMode (0 pixels, 1 lines, 2 pages). */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  return deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * pageHeight : deltaY;
}

const isFirefox = () => typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

/** `ready` re-attaches once the element is on screen (e.g. after the deck has loaded). */
export function useWheelHandoff(ref: RefObject<HTMLElement | null>, ready = true) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !isFirefox()) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const doc = document.scrollingElement ?? document.documentElement;
      if (doc.scrollHeight - window.innerHeight < 1) return; // the page itself doesn't scroll (wide screens)
      for (let el = e.target as HTMLElement | null; el && el !== root.parentElement; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && canScrollFurther(el.scrollTop, el.scrollHeight, el.clientHeight, e.deltaY)) return;
      }
      e.preventDefault();
      window.scrollBy(0, wheelPixels(e.deltaY, e.deltaMode, window.innerHeight));
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [ref, ready]);
}
