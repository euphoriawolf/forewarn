// Witness on the page: shrink a phone photo, send it to /api/witness (Meta's SAM 3.1), then draw the
// result: floodwater tinted blue, every person pixelated so nobody can be recognised. Pixelating works
// in every browser (canvas blur filters do not, on older iPhones).
import { decodeMaskToRaster } from '@meta-sam/parser';

interface Region { left: number; top: number; right: number; bottom: number; mask: { encoding: string; payload: string; width?: number; height?: number } }
export interface WitnessResult { image: string; waterPct: number; people: number; found: boolean }

const MAX = 1280;

async function shrink(file: File) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  return { canvas: c, w, h, data: c.toDataURL('image/jpeg', 0.85) };
}

// one region's mask, drawn white on a canvas the size of the photo; `grow` widens it a little
function maskOf(regions: Region[], w: number, h: number, grow = 0) {
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d')!;
  for (const r of regions) {
    const mw = r.mask.width ?? r.right - r.left, mh = r.mask.height ?? r.bottom - r.top;
    const raster = decodeMaskToRaster(r.mask as never), small = document.createElement('canvas'); small.width = mw; small.height = mh;
    const img = new ImageData(mw, mh);
    for (let i = 0; i < raster.length; i++) if (raster[i]) { img.data[i * 4 + 3] = 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; }
    small.getContext('2d')!.putImageData(img, 0, 0);
    const bw = r.right - r.left, bh = r.bottom - r.top, gx = bw * grow, gy = bh * grow;
    ctx.drawImage(small, r.left - gx, r.top - gy, bw + 2 * gx, bh + 2 * gy);
  }
  return out;
}

// paint `layer` onto `onto`, only where `mask` is white
function through(onto: CanvasRenderingContext2D, layer: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const t = document.createElement('canvas'); t.width = layer.width; t.height = layer.height;
  const c = t.getContext('2d')!; c.drawImage(layer, 0, 0); c.globalCompositeOperation = 'destination-in'; c.drawImage(mask, 0, 0);
  onto.drawImage(t, 0, 0);
}

export async function checkPhoto(file: File): Promise<WitnessResult> {
  const { canvas, w, h, data } = await shrink(file);
  const r = await fetch('/api/witness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: data, width: w, height: h }) });
  const res = (await r.json()) as { error?: string; water: Region[]; people: Region[]; waterPct: number };
  if (!r.ok || res.error) throw new Error(res.error ?? 'The photo check failed. Try again.');
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
  // the water, tinted the app's water blue
  if (res.water.length) {
    const blue = document.createElement('canvas'); blue.width = w; blue.height = h;
    const b = blue.getContext('2d')!; b.fillStyle = 'rgba(29, 78, 216, 0.5)'; b.fillRect(0, 0, w, h);
    through(ctx, blue, maskOf(res.water, w, h));
  }
  // the people, pixelated: the photo drawn tiny, then back up without smoothing
  if (res.people.length) {
    const px = document.createElement('canvas'), s = Math.max(1, Math.round(Math.max(w, h) / 48));
    const tiny = document.createElement('canvas'); tiny.width = Math.ceil(w / s); tiny.height = Math.ceil(h / s);
    tiny.getContext('2d')!.drawImage(canvas, 0, 0, tiny.width, tiny.height);
    px.width = w; px.height = h; const p = px.getContext('2d')!; p.imageSmoothingEnabled = false; p.drawImage(tiny, 0, 0, w, h);
    through(ctx, px, maskOf(res.people, w, h, 0.08));
  }
  return { image: out.toDataURL('image/jpeg', 0.85), waterPct: res.waterPct, people: res.people.length, found: res.water.length > 0 };
}
