// The chat with the agent, below the answer. It loads on its own (see Answer.tsx), shows each step
// the agent takes as it happens, and passes the agent's 3D actions to the page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import * as I from './icons';
import type { Place } from './types';

const STEP: Record<string, [string, string]> = {
  read_forecast: ['Reading 51 forecasts for the next 7 days', 'Read 51 forecasts for the next 7 days'],
  show_last_flood: ['Playing the last flood on your street', 'Played the last flood on your street'],
  light_roads: ['Checking the roads against the last flood', 'Lit the roads by the last flood'],
  show_street_view: ['Moving to your street', 'Moved to your street'],
  show_overview: ['Moving up to see the area', 'Moved up to see the area'],
  mark_day: ['Marking the day', 'Marked the day'],
  show_nearest_flood: ['Finding the nearest spot that flooded', 'Found the nearest spot that flooded'],
  last_flood: ['Checking the last flood here', 'Checked the last flood here'],
};

export function Chat({ place, onAction }: { place: Place; onAction: (a: Record<string, unknown>) => void }) {
  // one chat per visitor: a random id kept on this phone
  const session = useMemo(() => {
    try { let id = localStorage.getItem('fw-session'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('fw-session', id); } return id; }
    catch { return crypto.randomUUID(); }
  }, []);
  const agent = useAgent<{ place: Place | null }>({ agent: 'AskAgent', name: session });
  useEffect(() => { agent.setState({ place }); }, [agent, place]);
  // no old history: each visit starts fresh, and the page never waits on loading it
  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent, getInitialMessages: null });
  useEffect(() => { clearHistory(); }, [place.lat, place.lon]); // a new place starts a new conversation
  const [text, setText] = useState('');
  // follow the newest words down, once the person has asked something
  // follow the newest words down while an answer is arriving (not when old history loads)
  useEffect(() => { if (status === 'submitted' || status === 'streaming') requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight)); }, [messages, status]);
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
  const ask = (q: string) => { if (!q.trim() || busy) return; sendMessage({ text: q.trim() }); setText(''); };
  return (
    <>
      <div className="chat">
        {messages.length === 0 && (
          <div className="suggest">
            {['Will my street flood this week?', 'Show me the last flood here', 'Which day is wettest?'].map((q) => <button key={q} className="chip" type="button" onClick={() => ask(q)}>{q}</button>)}
          </div>
        )}
        {messages.map((m) => m.role === 'user'
          ? <div key={m.id} className="me">{m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}</div>
          : (
            <div key={m.id}>
              <div className="steps">
                {m.parts.filter((p) => p.type.startsWith('tool-')).map((p, i) => {
                  const name = p.type.slice(5), done = 'state' in p && p.state === 'output-available', [now, past] = STEP[name] ?? [name, name];
                  return <div key={i}>{done ? <I.Tick /> : <span className="spin" />}{done ? past : now}</div>;
                })}
              </div>
              <p className="bot">{m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}</p>
            </div>
          ))}
        {status === 'submitted' && <div className="steps"><div><span className="spin" />Thinking</div></div>}
      </div>
      <div className="askbar"><form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your place" aria-label="Ask about your place" disabled={busy} />
        <button type="submit" aria-label="Send" disabled={busy}><I.Send /></button>
      </form></div>
    </>
  );
}

