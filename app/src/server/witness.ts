// Witness: a person adds a photo of a flood where they are. Two Meta models read it at the same time:
// SAM 3.1 (Segment Anything) marks the floodwater and finds every person, so the page can tint the water
// and pixelate the people; Muse Spark 1.3 says in words what the water reaches, how it moves, what it
// means and what to do. Muse Spark gives no numbers (any field with a digit is dropped); the share of the
// photo that is water is computed here, from SAM's masks. Nothing is kept: the photo goes out and back.
import { fetchIn } from './net';
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';
import type { Env } from './harness';

export interface Region { left: number; top: number; right: number; bottom: number; mask: { encoding: string; payload: string; width?: number; height?: number } }
export interface Reading { isFlood: boolean; reaches: string; moving: 'fast' | 'slow' | 'still' | 'unclear'; meaning: string; advice: string }
export interface Witness { width: number; height: number; water: Region[]; people: Region[]; waterPct: number; reading: Reading | null; ms: number }

const SCHEMA = { type: 'object', additionalProperties: false, required: ['isFlood', 'reaches', 'moving', 'meaning', 'advice'], properties: {
  isFlood: { type: 'boolean' }, reaches: { type: 'string' }, moving: { type: 'string', enum: ['fast', 'slow', 'still', 'unclear'] }, meaning: { type: 'string' }, advice: { type: 'string' } } };

// Muse Spark 1.3 (standard mode: Meta does not train on it) reads the water in words
async function read(env: Env, image: string): Promise<Reading | null> {
  const r = await fetchIn('https://api.meta.ai/v1/chat/completions', 30000, 'Muse Spark', {
    method: 'POST', headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'muse-spark-1.3', reasoning_effort: 'low', max_completion_tokens: 1500,
      response_format: { type: 'json_schema', json_schema: { name: 'flood_photo', strict: true, schema: SCHEMA } },
      messages: [
        { role: 'system', content: 'You look at a photo sent to a flood warning app in Africa and describe only the water, for the person who sent it. Plain English, short. Never give a number, a depth in cm or a distance: name what the water reaches instead.' },
        { role: 'user', content: [
          { type: 'text', text: 'isFlood: is there floodwater (not a river in its banks, not a puddle)? reaches: the highest everyday thing the water reaches, as a short phrase, like "car wheels", "a person\'s knees", "doorsteps", or "only the road surface". moving: how the water moves. meaning: one sentence on what this water means for someone there. advice: one short instruction for them.' },
          { type: 'image_url', image_url: { url: image } }] }],
    }),
  });
  if (!r.ok) return null;
  const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  try {
    const x = JSON.parse(d.choices?.[0]?.message?.content ?? '') as Reading;
    // the model never makes the numbers: a field with a digit in it is dropped
    for (const k of ['reaches', 'meaning', 'advice'] as const) if (/\d/.test(x[k])) x[k] = '';
    return x;
  } catch { return null; }
}

const MAX_BYTES = 3_000_000; // a phone photo after the page shrinks it to 1280 px is far smaller

async function* events(env: Env, prompt: string, image: string) {
  const r = await fetchIn('https://api.meta.ai/v1/responses', 30000, 'SAM 3.1', {
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
  const [water, people, reading] = await Promise.all([segment(env, 'flood water', image), segment(env, 'person', image), read(env, image).catch(() => null)]);
  // the share of the photo that is water: each mask covers its box at its own resolution; masks of the
  // same concept rarely overlap, and the total is capped at the whole photo
  let wet = 0;
  for (const w of water) {
    const r = decodeMaskToRaster(w.mask as never), mw = w.mask.width ?? w.right - w.left, mh = w.mask.height ?? w.bottom - w.top;
    let on = 0; for (const v of r) on += v;
    wet += (on / (mw * mh)) * (w.right - w.left) * (w.bottom - w.top);
  }
  return { width, height, water, people, waterPct: Math.min(100, Math.round((100 * wet) / (width * height))), reading, ms: Date.now() - t0 };
}
