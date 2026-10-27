// The chat with the agent, beside the map. It loads on its own (see Answer.tsx). The agent opens
// with the answer: the page asks the opening question for the person, and that question is not
// shown. Each step the agent takes shows as it happens, its 3D actions go to the map, and the
// lines from the map buttons sit in the conversation where they happened.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import * as I from './icons';
import type { Place } from './types';

// the same words as OPENING in src/server/harness.ts, which tells the agent how to answer it
const OPENING = 'How does my place look for the next 14 days?';

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
};
// a line in the chat from the page itself (a map button, a photo check), not from the agent
export interface Note { id: number; text: string; small?: string; img?: string; busy?: boolean; action?: { label: string; run: () => void } }
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
  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent, getInitialMessages: null });
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
  const asked = messages.some((m) => m.role === 'user' && textOf(m) !== OPENING);
  const noteAt = (k: number) => notes.map((n, i) => (at.current[i] === k ? (
    <div key={n.id} className={`note ${n.img ? 'photo' : ''}`}>
      {n.img && <img src={n.img} alt="Your photo, with the floodwater in blue and people pixelated" />}
      <div>{n.busy ? <span className="spin" /> : n.img ? <I.Camera /> : <I.Play />}<span>{n.text}{n.small && <small>{n.small}</small>}</span></div>
      {n.action && <button type="button" className="report" onClick={n.action.run}>{n.action.label}</button>}
    </div>
  ) : null));

  return (
    <div className="talk">
      <div className="chat" ref={box}>
        {messages.map((m, k) => (
          <div key={m.id} className="turn">
            {noteAt(k)}
            {m.role === 'user'
              ? (textOf(m) === OPENING ? null : <div className="me">{textOf(m)}</div>)
              : (
                <>
                  <div className="steps">
                    {m.parts.filter((p) => p.type.startsWith('tool-')).map((p, i) => {
                      const name = p.type.slice(5), ok = 'state' in p && p.state === 'output-available', [now, past] = STEP[name] ?? [name, name];
                      return <div key={i}>{ok ? <I.Tick /> : <span className="spin" />}{ok ? past : now}</div>;
                    })}
                  </div>
                  {textOf(m) && <p className="bot">{textOf(m)}</p>}
                </>
              )}
          </div>
        ))}
        {noteAt(messages.length)}
        {status === 'submitted' && <div className="steps"><div><span className="spin" />{asked ? 'Thinking' : 'Checking your place'}</div></div>}
        {!busy && messages.length > 1 && (
          <div className="suggest">
            {(suggestions.length ? suggestions : asked ? [] : ['What floods near me?', 'Which day is wettest?', 'Show me the last flood here']).map((q) => <button key={q} className="chip" type="button" onClick={() => tapChip(q)}>{q}</button>)}
          </div>
        )}
      </div>
      <div className="askbar">
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
        <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <button type="button" className="cam" aria-label="Add a photo of a flood" title="Add a photo of a flood" onClick={() => file.current?.click()}><I.Camera /></button>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your place" aria-label="Ask about your place" disabled={busy} />
          <button type="submit" aria-label="Send" disabled={busy}><I.Send /></button>
        </form>
        {logging && <p className="fine">Test version: chats are saved to improve Forewarn.</p>}
      </div>
    </div>
  );
}
