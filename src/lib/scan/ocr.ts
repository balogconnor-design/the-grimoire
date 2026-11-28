/**
 * Text recognition for the photo scanner, with Tesseract.js running in a web worker.
 *
 * Everything Tesseract needs is served by the app itself under /tesseract/ (copied from node_modules
 * at build time, see vite.config.ts), never from a CDN: the site's Content-Security-Policy only allows
 * its own scripts, and the files then work offline once fetched. The library code is loaded only when
 * someone scans, so it costs nothing on other pages.
 */
import type { PSM, Worker as TessWorker } from 'tesseract.js';
import type { Box, OcrLine } from './detect';

export type OcrProgress = (status: string, progress: number) => void;

let workerPromise: Promise<TessWorker> | null = null;
let progressFn: OcrProgress | undefined;

// When the engine can't load (offline on first use, a blocked file), Tesseract can stall without ever
// rejecting. Every progress message is a heartbeat; a long silence fails the step with a clear message.
let lastBeat = 0;
const beat = () => { lastBeat = Date.now(); };
const START_LIMIT_MS = 90_000; // first start downloads ~7 MB, slow on a weak phone signal
const READ_LIMIT_MS = 60_000;

function watched<T>(p: Promise<T>, limitMs: number, message: string): Promise<T> {
  beat();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() - lastBeat > limitMs) { clearInterval(timer); reject(new Error(message)); }
    }, 1000);
    p.then(
      (v) => { clearInterval(timer); resolve(v); },
      (e) => { clearInterval(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

function getWorker(): Promise<TessWorker> {
  if (workerPromise) return workerPromise;
  workerPromise = watched((async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = new URL('/tesseract/', location.href).href;
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      workerBlobURL: false, // a blob: worker would need 'blob:' in the CSP
      logger: (m: { status: string; progress: number }) => { beat(); progressFn?.(m.status, m.progress); },
      errorHandler: () => undefined, // failures reach us as rejected jobs; without this they're also thrown
    });
  })(), START_LIMIT_MS, "The text reader couldn't start. Check your connection, then try again.");
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

/** Start loading the reader (first time: about 7 MB) while the user is still picking photos. */
export function warmUpOcr(onProgress?: OcrProgress): Promise<unknown> {
  progressFn = onProgress;
  return getWorker();
}

/** Free the worker's memory (tens of MB). The next scan starts it again from the browser's cache. */
export async function stopOcr() {
  const w = workerPromise;
  workerPromise = null;
  if (w) await (await w.catch(() => null))?.terminate();
}

/**
 * Tesseract page segmentation: 11 = sparse text, as much as can be found in any order (whole photos;
 * automatic layout, 3, tends to skip a title next to a card's dark border); 6 = one block of text (the
 * enlarged info strip); 7 = a single line (the enlarged title bar).
 */
const PSM_MODE = { auto: '11', block: '6', line: '7' } as const;

/** Read the text in a canvas, as lines with word boxes (in the canvas's pixels). */
export async function readLines(canvas: HTMLCanvasElement, psm: keyof typeof PSM_MODE = 'auto', onProgress?: OcrProgress): Promise<OcrLine[]> {
  progressFn = onProgress; // before waiting, so a start already under way (warmUpOcr) reports here
  const worker = await getWorker();
  // A photo has no DPI; without one Tesseract guesses and logs "Estimating resolution as …" as an error.
  await worker.setParameters({ tessedit_pageseg_mode: PSM_MODE[psm] as unknown as PSM, user_defined_dpi: '300' });
  const { data } = await watched(worker.recognize(canvas, {}, { blocks: true, text: false }), READ_LIMIT_MS, 'Reading the photo took too long. Try a smaller photo.');
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        lines.push({
          text: line.text.trim(),
          conf: line.confidence,
          bbox: line.bbox,
          words: line.words.map((w) => ({ text: w.text, conf: w.confidence, bbox: w.bbox })),
        });
      }
    }
  }
  return lines;
}

// ---------- Images ----------

export type Rotation = 0 | 90 | 180 | 270;

/** Largest side kept from a photo. Phones take 4000+ px photos; more than this only costs memory. */
const MAX_SOURCE = 4000;

/** A photo drawn upright (camera orientation applied by the browser, plus the user's rotation). */
export async function loadPhoto(file: Blob, rotation: Rotation = 0): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SOURCE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const side = rotation === 90 || rotation === 270;
  const c = document.createElement('canvas');
  c.width = side ? h : w;
  c.height = side ? w : h;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close();
  return c;
}

/** A copy of `src` scaled so its longer side is `maxSide` (never enlarged unless `upTo` allows). */
export function scaled(src: HTMLCanvasElement, maxSide: number, upTo = 1): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(upTo, maxSide / Math.max(src.width, src.height));
  if (scale === 1) return { canvas: src, scale };
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { canvas: c, scale };
}

const clip = (b: Box, w: number, h: number): Box => ({
  x0: Math.max(0, Math.floor(b.x0)), y0: Math.max(0, Math.floor(b.y0)),
  x1: Math.min(w, Math.ceil(b.x1)), y1: Math.min(h, Math.ceil(b.y1)),
});

/** Part of a canvas, at `width` pixels wide (enlarged up to 3×), optionally greyscale with stretched contrast. */
export function crop(src: HTMLCanvasElement, box: Box, width: number, enhance = false): HTMLCanvasElement | null {
  const b = clip(box, src.width, src.height);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  if (bw < 8 || bh < 8) return null;
  const s = Math.min(3, width / bw);
  const c = document.createElement('canvas');
  c.width = Math.round(bw * s);
  c.height = Math.round(bh * s);
  const ctx = c.getContext('2d', { willReadFrequently: enhance })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, b.x0, b.y0, bw, bh, 0, 0, c.width, c.height);
  if (enhance) {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      d[i] = g;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = ((d[i] - lo) * 255) / range;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

/** A canvas as an object URL (JPEG), for showing crops in the review screen. */
export function toUrl(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.85));
}
