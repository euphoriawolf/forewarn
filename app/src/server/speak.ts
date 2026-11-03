// Read aloud in Swahili, Yoruba and Hausa: Meta's MMS voices on Modal (modal/tts.py). The voices cannot
// read digits or symbols, so Muse Spark Open first writes every number and unit as words in that
// language ("mm 48" becomes "milimita arobaini na nane"); the person also sees the text on screen, with
// its numbers checked. Nothing is kept. English and French stay on the phone's own voice.
import { generateText } from 'ai';
import { model, type Env } from './harness';
import { fetchIn } from './net';

const NAME: Record<string, string> = { sw: 'Swahili', yo: 'Yoruba', ha: 'Hausa' };

// The days of the week, Monday first. The model guessed them wrong once ("Wednesday" became Sunday in
// Yoruba), so the prompt carries them and the answer must keep each day the warning names.
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAYS: Record<string, string[]> = {
  sw: ['Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi', 'Jumapili'],
  yo: ['Ọjọ́ Ajé', 'Ọjọ́ Ìṣẹ́gun', 'Ọjọ́rú', 'Ọjọ́bọ̀', 'Ọjọ́ Ẹtì', 'Ọjọ́ Àbámẹ́ta', 'Ọjọ́ Àìkú'],
  ha: ['Litinin', 'Talata', 'Laraba', 'Alhamis', "Juma'a", 'Asabar', 'Lahadi'],
};
const bare = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// `translate`: the text is in another language (a warning to share): Muse Spark puts it into this one first.
// The words spoken come back too, so the person sees them before they share the voice note.
export async function speak(env: Env, lang: string, text: string, translate = false): Promise<{ audio: ArrayBuffer; said: string }> {
  if (!NAME[lang]) throw new Error('Read aloud covers Swahili, Yoruba and Hausa.');
  text = text.slice(0, 600);
  let said = text;
  if (translate || /[\d%°]|\bmm\b/.test(text)) {
    const named = translate ? WEEK.map((d, i) => (new RegExp(`\\b${d}\\b`, 'i').test(text) ? i : -1)).filter((i) => i >= 0) : [];
    const days = named.length ? ` Use these ${NAME[lang]} day names: ${named.map((i) => `${WEEK[i]} is "${DAYS[lang][i]}"`).join(', ')}.` : '';
    const keeps = (t: string) => named.every((i) => bare(t).includes(bare(DAYS[lang][i])));
    let ok = false;
    for (let i = 0; i < 2 && !ok; i++) {
      const out = await generateText({
        model: model(env), maxOutputTokens: 2000, providerOptions: { baseten: { reasoningEffort: 'low' } }, abortSignal: AbortSignal.timeout(30000),
        prompt: translate
          ? `Translate this flood warning into plain ${NAME[lang]} for reading aloud. Keep every fact, every day and every number's value exactly.${days} Write every number, unit, abbreviation and symbol as ${NAME[lang]} words. Leave out web addresses. Reply with the translation only.\n\n${text}`
          : `Rewrite this ${NAME[lang]} text so it can be read aloud. Write every number, unit, abbreviation and symbol as ${NAME[lang]} words (for example "mm" as the word for millimetres). Change nothing else. Reply with the text only.\n\n${text}`,
      });
      const t = out.text.trim();
      if (t && keeps(t)) { said = t; ok = true; }
    }
    if (!ok && translate) throw new Error('The translation did not keep the day right.');
  }
  const r = await fetchIn(env.TTS_URL, 60000, 'The voice service', { method: 'POST', headers: { Authorization: `Bearer ${env.TTS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, text: said }) });
  if (!r.ok) throw new Error(`The voice service answered ${r.status}.`);
  return { audio: await r.arrayBuffer(), said };
}
