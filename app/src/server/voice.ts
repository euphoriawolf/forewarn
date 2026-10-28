// Voice in: a spoken question, recorded on the page as 16 kHz mono WAV, goes to Meta's Muse Voice
// Transcribe (`muse-voice-transcribe-1.0` on the Meta Model API, $0.18 an hour of audio) and comes back
// as text. The page shows the words so the person can fix them before they send. Nothing is kept.
import { fetchIn } from './net';
import type { Env } from './harness';

export const MAX_SECONDS = 30;

export async function transcribe(env: Env, wav: ArrayBuffer): Promise<{ text: string; ms: number }> {
  // a WAV of 16 kHz, 16-bit mono is 32,000 bytes a second, plus its 44-byte header
  if (wav.byteLength < 44 + 3200) throw new Error('The recording is too short. Tap the microphone and speak.');
  if (wav.byteLength > 44 + 32000 * MAX_SECONDS) throw new Error(`Keep the question under ${MAX_SECONDS} seconds.`);
  if (new TextDecoder().decode(wav.slice(0, 4)) !== 'RIFF') throw new Error('The recording is not a WAV file.');
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], { type: 'application/json' }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'question.wav');
  const t0 = Date.now();
  const r = await fetchIn('https://api.meta.ai/v1/asr/transcribe', 20000, 'The voice service', { method: 'POST', headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, Accept: 'application/json' }, body: form });
  if (!r.ok) throw new Error(`The voice service answered ${r.status}. Type your question instead.`);
  const d = (await r.json()) as { transcript?: string };
  // it sometimes ends a question with "?."
  return { text: (d.transcript ?? '').trim().replace(/([?!])\.$/, '$1'), ms: Date.now() - t0 };
}
