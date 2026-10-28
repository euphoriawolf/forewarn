// The chat with the agent, beside the map. It loads on its own (see Answer.tsx). The agent opens
// with the answer: the page asks the opening question for the person, and that question is not
// shown. Each step the agent takes shows as it happens, its 3D actions go to the map, and the
// lines from the map buttons sit in the conversation where they happened.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import * as I from './icons';
import { record, transcribe, type Recording } from './voice';
import type { Place } from './types';

// the same words as OPENING in src/server/harness.ts, which tells the agent how to answer it
const OPENING = 'How does my place look for the next 14 days?';
// the same as FROM_PAGE in harness.ts: a message the page sends for the person, never shown as theirs
export const FROM_PAGE = '[from the page]';
const hidden = (t: string) => t === OPENING || t.startsWith(FROM_PAGE);

const STEP: Record<string, [string, string]> = {
  read_forecast: ['Reading 51 forecasts for the next 14 days', 'Read 51 forecasts for the next 14 days'],
  show_last_flood: ['Playing the last flood on your street', 'Played the last flood on your street'],
  light_roads: ['Checking the roads against the last flood', 'Lit the roads by the last flood'],
  show_street_view: ['Moving to your street', 'Moved to your street'],
  show_overview: ['Moving up to see the area', 'Moved up to see the area'],
  mark_day: ['Marking the day', 'Marked the day'],
  show_nearest_flood: ['Finding the nearest spot that flooded', 'Found the nearest spot that flooded'],
  last_flood: ['Checking the last flood here', 'Checked the last flood here'],
  read_last_30_days: ['Reading the last 30 days of rain', 'Read the last 30 days of rain'],
  flood_reports: ['Checking reports from people nearby', 'Checked reports from people nearby'],
  follow_area: ['Opening the alerts form', 'Opened the alerts form'],
  warn_family: ['Writing a message for your family', 'Wrote a message for your family'],
};
// a line in the chat from the page itself (a map button, a photo check), not from the agent
export interface Note { id: number; text: string; small?: string; img?: string; busy?: boolean; action?: { label: string; run: () => void }; extra?: ReactNode; follow?: boolean; share?: string }
// "What I checked": the sources behind an answer, read from the tool results the agent used (the same
// results the number checker holds the answer to), so a person can see where each number came from
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const at = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
function sources(parts: { type: string; state?: string; output?: unknown }[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const p of parts) {
    if (!p.type.startsWith('tool-') || p.state !== 'output-available' || !p.output || typeof p.output !== 'object') continue;
    const name = p.type.slice(5), o = p.output as Out;
    if (seen.has(name) || o.error) continue; seen.add(name);
    if (name === 'read_forecast' && o.days) out.push(`Rain forecast: 51 runs of the ECMWF ensemble through Open-Meteo${o.issued ? `, read ${at(o.issued)}` : ''}, blended from the ${o.squares?.length ?? 4} forecast squares (about 28 km) around the place. A day counts runs with ${o.floodLineMm} mm in the day or 50 mm over 3 days.${o.floodLine?.note ? ` ${o.floodLine.note}` : ''}`);
    if (name === 'read_last_30_days' && o.mm !== undefined) out.push(`Last 30 days: ${o.mm} mm from ${day(o.from)} to ${day(o.to)}, against a normal ${o.normalMm} mm. ${o.source ?? ''}`.trim());
    if (name === 'flood_reports' && Array.isArray(o.reports)) out.push(o.reports.length ? `Flood reports: ${o.reports.length} from people within 5 km in the last 48 hours, each checked by a person.` : 'Flood reports: none within 5 km in the last 48 hours.');
    if (['last_flood', 'show_last_flood', 'light_roads', 'show_nearest_flood'].includes(name) && !seen.has('flood check')) { seen.add('flood check'); out.push('Street water: the Flood Check model of the last big storm, a model estimate, not a measurement.'); }
  }
  return out;
}
// Read aloud: the phone's own voice (no server, free). The language is guessed from the words, so a
// Swahili or French answer is read with a Swahili or French voice when the phone has one.
const guessLang = (t: string) => {
  const w = t.toLowerCase().match(/[a-zàâçéèêëîïôûùü]+/g) ?? [], n = (list: string[]) => w.filter((x) => list.includes(x)).length;
  const sw = n(['na', 'ya', 'wa', 'kwa', 'mvua', 'mafuriko', 'siku', 'leo', 'kesho', 'hapa', 'ni', 'za', 'katika']);
  const fr = n(['le', 'la', 'les', 'des', 'pluie', 'inondation', 'jours', 'aujourd', 'est', 'une', 'pour', 'dans']);
  return sw > 3 && sw > fr ? 'sw' : fr > 3 ? 'fr' : 'en';
};
// false when the phone has no voice for the answer's language (an English voice reading Swahili is worse than none)
function speak(text: string, onEnd: () => void): boolean {
  const lang = guessLang(text), unit = { en: 'millimetres', fr: 'millimètres', sw: 'milimita' }[lang];
  // "30 mm" read as a word, not as "em em"
  const u = new SpeechSynthesisUtterance(text.replace(/(\d)\s*mm\b/g, `$1 ${unit}`));
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (!voice && lang !== 'en') return false;
  u.lang = voice?.lang ?? lang; if (voice) u.voice = voice;
  u.rate = 0.95; u.onend = onEnd; u.onerror = onEnd;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  return true;
}
const textOf = (m: { parts: { type: string; text?: string }[] }) => m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');

export function Chat({ place, onAction, notes, onPhoto, say, logging }: { place: Place; onAction: (a: Record<string, unknown>) => void; notes: Note[]; onPhoto: (f: File) => void; say?: { id: number; text: string } | null; logging: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  // one chat per visitor: a random id kept on this phone
  const session = useMemo(() => {
    try { let id = localStorage.getItem('fw-session'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('fw-session', id); } return id; }
    catch { return crypto.randomUUID(); }
  }, []);
  // the agent writes follow-up questions after each answer into its state; they arrive here
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const agent = useAgent<{ place: Place | null; suggestions?: string[] }>({ agent: 'AskAgent', name: session, onStateUpdate: (st) => setSuggestions(st?.suggestions ?? []) });
  // no old history: each visit starts fresh, and the page never waits on loading it
  const { messages, sendMessage, status, clearHistory, error } = useAgentChat({ agent, getInitialMessages: null });
  // a new place starts a new conversation, and the agent opens it (once per place, also in dev's double effects)
  const opened = useRef('');
  useEffect(() => {
    const k = `${place.lat},${place.lon}`;
    agent.setState({ place });
    if (opened.current === k) return;
    opened.current = k;
    clearHistory();
    sendMessage({ text: OPENING });
  }, [agent, place]);
  const [text, setText] = useState('');
  // voice in: 'rec' while recording, 'text' while the words are written down
  const [voice, setVoice] = useState<'' | 'rec' | 'text'>(''), [voiceError, setVoiceError] = useState('');
  const rec = useRef<Recording | null>(null), input = useRef<HTMLInputElement>(null), limit = useRef<number>(0);
  // the waveform while recording: the last 28 slices of sound, newest on the right
  const [levels, setLevels] = useState<number[]>([]);
  // read aloud: the id of the answer being read, if any
  const [reading, setReading] = useState('');
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => { if (canSpeak) speechSynthesis.cancel(); }, []);
  const listen = (id: string, text: string) => {
    if (reading === id) { speechSynthesis.cancel(); setReading(''); return; }
    setVoiceError('');
    if (speak(text, () => setReading((r) => (r === id ? '' : r)))) setReading(id);
    else setVoiceError(`This phone has no ${guessLang(text) === 'sw' ? 'Swahili' : 'French'} voice to read the answer aloud.`);
  };
  const stopVoice = async () => {
    const r = rec.current; rec.current = null; clearTimeout(limit.current);
    if (!r) return;
    setVoice('text');
    try { const words = await transcribe(await r.stop()); setText((t) => (t ? `${t} ${words}` : words)); input.current?.focus(); if (!words) setVoiceError('No words came through. Try again closer to the phone.'); }
    catch (e) { setVoiceError(e instanceof Error ? e.message : 'The voice check failed. Type your question instead.'); }
    setVoice('');
  };
  const startVoice = async () => {
    setVoiceError('');
    setLevels([]);
    try { rec.current = await record((l) => setLevels((v) => [...v.slice(-27), l])); setVoice('rec'); limit.current = window.setTimeout(stopVoice, 30000); }
    catch { setVoiceError('The microphone is off for this site. Allow it in the browser settings, or type your question.'); }
  };
  useEffect(() => () => { rec.current?.cancel(); clearTimeout(limit.current); }, []);

  // each map-button line is kept where it happened in the conversation
  const at = useRef<number[]>([]);
  if (at.current.length > notes.length) at.current = [];
  while (at.current.length < notes.length) at.current.push(messages.length);

  // follow the newest words down, inside the chat only (the map never moves)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = box.current; if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })); }, [messages, status, notes.length]);

  // the agent's 3D tools return actions: run each one once, when its result arrives
  const done = useRef(new Set<string>());
  useEffect(() => {
    for (const m of messages) for (const p of m.parts) {
      if (!p.type.startsWith('tool-') || !('state' in p) || p.state !== 'output-available') continue;
      const id = (p as { toolCallId: string }).toolCallId, out = (p as { output?: Record<string, unknown> }).output;
      if (done.current.has(id)) continue;
      done.current.add(id);
      if (out && typeof out.action === 'string') onAction(out);
    }
  }, [messages]);
  const busy = status === 'submitted' || status === 'streaming';
  const ask = (q: string) => { if (!q.trim() || busy) return; setSuggestions([]); sendMessage({ text: q.trim() }); setText(''); };
  // the page can speak for the person (after they add a photo); it waits for any answer in progress
  const said = useRef(0);
  useEffect(() => { if (say && say.id !== said.current && !busy) { said.current = say.id; setSuggestions([]); sendMessage({ text: say.text }); } }, [say, busy]);
  // a chip about a photo opens the camera instead of asking
  const tapChip = (q: string) => (/photo|picture/i.test(q) ? file.current?.click() : ask(q));
  const asked = messages.some((m) => m.role === 'user' && !hidden(textOf(m)));
  const noteAt = (k: number) => notes.map((n, i) => (at.current[i] === k ? (
    <div key={n.id} className={`note ${n.img ? 'photo' : n.extra || n.share ? 'col' : ''}`}>
      {n.img && <img src={n.img} alt="Your photo, with the floodwater in blue and people pixelated" />}
      <div>{n.busy ? <span className="spin" /> : n.img ? <I.Camera /> : n.follow ? <I.Bell /> : n.share ? <I.Send /> : <I.Play />}<span>{n.text}{n.small && <small>{n.small}</small>}</span></div>
      {n.extra}
      {n.action && <button type="button" className="report" onClick={n.action.run}>{n.action.label}</button>}
      {n.share && <a className="report wa" href={`https://wa.me/?text=${encodeURIComponent(n.share)}`} target="_blank" rel="noopener">Send on WhatsApp</a>}
    </div>
  ) : null));

  return (
    <div className="talk">
      <div className="chat" ref={box}>
        {/* before the chat has connected, and while the model thinks before its first step, say so */}
        {messages.length === 0 && <div className="steps"><div><span className="spin" />Checking {place.name}</div></div>}
        {messages.map((m, k) => (
          <div key={m.id} className="turn">
            {noteAt(k)}
            {m.role === 'user'
              ? (hidden(textOf(m)) ? null : <div className="me">{textOf(m)}</div>)
              : (
                <>
                  <div className="steps">
                    {m.parts.filter((p) => p.type.startsWith('tool-')).map((p, i) => {
                      const name = p.type.slice(5), ok = 'state' in p && p.state === 'output-available', [now, past] = STEP[name] ?? [name, name];
                      return <div key={i}>{ok ? <I.Tick /> : <span className="spin" />}{ok ? past : now}</div>;
                    })}
                  </div>
                  {busy && k === messages.length - 1 && !textOf(m) && !m.parts.some((p) => p.type.startsWith('tool-') && !('state' in p && p.state === 'output-available')) && (
                    <div className="steps"><div><span className="spin" />{m.parts.some((p) => p.type.startsWith('tool-')) ? 'Writing the answer' : asked ? 'Thinking' : `Checking ${place.name}`}</div></div>
                  )}
                  {textOf(m) && <p className="bot">{textOf(m)}</p>}
                  {textOf(m) && !(busy && k === messages.length - 1) && (() => {
                    const list = sources(m.parts as { type: string; state?: string; output?: unknown }[]);
                    const tools = <>{canSpeak && <button type="button" className={`listen ${reading === m.id ? 'on' : ''}`} onClick={() => listen(m.id, textOf(m))}>{reading === m.id ? <><I.Stop />Stop</> : <><I.Speaker />Listen</>}</button>}</>;
                    return list.length ? <div className="after">{tools}<details className="checked"><summary>What I checked</summary><ul>{list.map((x, i) => <li key={i}>{x}</li>)}</ul><p>A checker compares every number in the answer with these results before you see it.</p></details></div> : <div className="after">{tools}</div>;
                  })()}
                </>
              )}
          </div>
        ))}
        {noteAt(messages.length)}
        {status === 'error' && <div className="note"><div><span>{error?.message?.match(/time|abort/i) ? 'That answer took too long and was stopped. Ask again in a moment.' : 'Something went wrong with that answer. Ask again.'}</span></div></div>}
        {status === 'submitted' && <div className="steps"><div><span className="spin" />{asked ? 'Thinking' : `Checking ${place.name}`}</div></div>}
        {!busy && messages.at(-1)?.role === 'assistant' && !!textOf(messages.at(-1)!) && (
          <div className="suggest">
            {(suggestions.length ? suggestions : asked ? [] : ['What floods near me?', 'Which day is wettest?', 'Show me the last flood here']).map((q) => <button key={q} className="chip" type="button" onClick={() => tapChip(q)}>{q}</button>)}
          </div>
        )}
      </div>
      <div className="askbar">
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
        <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <button type="button" className="cam" aria-label="Add a photo of a flood" title="Add a photo of a flood" onClick={() => file.current?.click()}><I.Camera /></button>
          {voice === 'rec' && <div className="wave" aria-hidden="true">{levels.map((l, i) => <i key={i} style={{ height: `${Math.max(8, l * 100)}%` }} />)}</div>}
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={voice === 'rec' ? 'Listening' : voice === 'text' ? 'Writing down your words' : `Ask about ${place.name}`} aria-label={`Ask about ${place.name}`} disabled={busy || voice !== ''} />
          {voice === 'rec' ? <button type="button" className="rec" aria-label="Stop and write it down" onClick={stopVoice}><I.Stop /></button>
            : voice === 'text' ? <button type="button" disabled aria-label="Writing down your words"><span className="spin" /></button>
            : text.trim() ? <button type="submit" aria-label="Send" disabled={busy}><I.Send /></button>
            : <button type="button" aria-label="Ask by voice" title="Ask by voice" disabled={busy} onClick={startVoice}><I.Mic /></button>}
        </form>
        {voiceError && <p className="fine err">{voiceError}</p>}
        {logging && <p className="fine">Test version: chats are saved to improve Forewarn.</p>}
      </div>
    </div>
  );
}
