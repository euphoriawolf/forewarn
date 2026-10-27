// Witness: a person adds a photo of a flood where they are. Meta's SAM 3.1 (Segment Anything) marks the
// floodwater and finds every person in it; the page tints the water and blurs the people, so nobody in a
// report can be recognised. The share of the photo that is water is computed here, from SAM's masks.
// Nothing is kept: the photo goes to SAM and back, and the page holds the result.
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';
import type { Env } from './harness';

export interface Region { left: number; top: number; right: number; bottom: number; mask: { encoding: string; payload: string; width?: number; height?: number } }
export interface Witness { width: number; height: number; water: Region[]; people: Region[]; waterPct: number; ms: number }

const MAX_BYTES = 3_000_000; // a phone photo after the page shrinks it to 1280 px is far smaller

async function* events(env: Env, prompt: string, image: string) {
  const r = await fetch('https://api.meta.ai/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ model: 'sam-3.1', stream: true, metadata: { mask_encoding: 'one_bit' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: image }] }] }),
  });
  if (!r.ok || !r.body) throw new Error(`SAM answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('data: ') && line !== 'data: [DONE]') yield JSON.parse(line.slice(6));
    }
  }
}

// one concept per request (SAM's rule): the water and the people are two calls, run together
async function segment(env: Env, prompt: string, image: string): Promise<Region[]> {
  const res = await parseImageStream(events(env, prompt, image)).finalResult;
  return recordsOfKind(res.records, 'mask').map((m) => ({ ...m.bounds, mask: m.mask as Region['mask'] }));
}

export async function witness(env: Env, image: string, width: number, height: number): Promise<Witness> {
  if (!env.MODEL_API_KEY) throw new Error('The photo check is not set up yet.');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_BYTES) throw new Error('Send one photo, JPEG or PNG, under 2 MB.');
  const t0 = Date.now();
  const [water, people] = await Promise.all([segment(env, 'flood water', image), segment(env, 'person', image)]);
  // the share of the photo that is water: each mask covers its box at its own resolution; masks of the
  // same concept rarely overlap, and the total is capped at the whole photo
  let wet = 0;
  for (const w of water) {
    const r = decodeMaskToRaster(w.mask as never), mw = w.mask.width ?? w.right - w.left, mh = w.mask.height ?? w.bottom - w.top;
    let on = 0; for (const v of r) on += v;
    wet += (on / (mw * mh)) * (w.right - w.left) * (w.bottom - w.top);
  }
  return { width, height, water, people, waterPct: Math.min(100, Math.round((100 * wet) / (width * height))), ms: Date.now() - t0 };
}
