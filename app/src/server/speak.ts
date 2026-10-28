// Read aloud in Swahili, Yoruba and Hausa: Meta's MMS voices on Modal (modal/tts.py). The voices cannot
// read digits or symbols, so Muse Spark Open first writes every number and unit as words in that
// language ("mm 48" becomes "milimita arobaini na nane"); the person also sees the text on screen, with
// its numbers checked. Nothing is kept. English and French stay on the phone's own voice.
import { generateText } from 'ai';
import { model, type Env } from './harness';
import { fetchIn } from './net';

const NAME: Record<string, string> = { sw: 'Swahili', yo: 'Yoruba', ha: 'Hausa' };

export async function speak(env: Env, lang: string, text: string): Promise<ArrayBuffer> {
  if (!NAME[lang]) throw new Error('Read aloud covers Swahili, Yoruba and Hausa.');
  text = text.slice(0, 600);
  let said = text;
  if (/[\d%°]|\bmm\b/.test(text)) {
    const out = await generateText({
      model: model(env), maxOutputTokens: 2000, providerOptions: { baseten: { reasoningEffort: 'low' } }, abortSignal: AbortSignal.timeout(30000),
      prompt: `Rewrite this ${NAME[lang]} text so it can be read aloud. Write every number, unit, abbreviation and symbol as ${NAME[lang]} words (for example "mm" as the word for millimetres). Change nothing else. Reply with the text only.\n\n${text}`,
    });
    if (out.text.trim()) said = out.text.trim();
  }
  const r = await fetchIn(env.TTS_URL, 60000, 'The voice service', { method: 'POST', headers: { Authorization: `Bearer ${env.TTS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, text: said }) });
  if (!r.ok) throw new Error(`The voice service answered ${r.status}.`);
  return r.arrayBuffer();
}
