// A private log of every chat turn, for testing: the question, the place, each step the model
// took (its reasoning, the tools it called and what they returned) and the final answer with the
// checker's verdict. On while LOG_CHATS is "1"; the page tells people their questions are saved.
// Read it with GET /api/logs and the LOGS_TOKEN secret. Turn it off before launch.
import { DurableObject } from 'cloudflare:workers';

export interface Turn {
  at: string; session: string; place: unknown; question: string; answer: string; ms: number;
  checked: boolean; badNumbers: string[];
  steps: { reasoning: string; tools: { name: string; input: unknown; output: unknown }[]; text: string; finish: string }[];
}

export class Logbook extends DurableObject {
  private ready = false;
  private init() {
    if (this.ready) return;
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, session TEXT, body TEXT)');
    this.ready = true;
  }
  add(t: Turn) {
    this.init();
    this.ctx.storage.sql.exec('INSERT INTO turns (at, session, body) VALUES (?, ?, ?)', t.at, t.session, JSON.stringify(t));
  }
  list(limit = 50, session?: string) {
    this.init();
    const rows = session
      ? this.ctx.storage.sql.exec('SELECT body FROM turns WHERE session = ? ORDER BY id DESC LIMIT ?', session, limit).toArray()
      : this.ctx.storage.sql.exec('SELECT body FROM turns ORDER BY id DESC LIMIT ?', limit).toArray();
    return rows.map((r) => JSON.parse(String(r.body)) as Turn);
  }
}

// What a call to the Logbook looks like from the Worker (every call over RPC is async).
export interface BookStub { add(t: Turn): Promise<void>; list(limit?: number, session?: string): Promise<Turn[]> }
export const bookOf = (ns: DurableObjectNamespace) => ns.get(ns.idFromName('main')) as unknown as BookStub;

// The steps of a finished stream, trimmed so one turn stays small.
export function stepsOf(steps: { reasoningText?: string; toolCalls: { toolCallId: string; toolName: string; input: unknown }[]; toolResults: { toolCallId: string; output?: unknown; result?: unknown }[]; text: string; finishReason: string }[]) {
  const cut = (x: unknown) => { const s = JSON.stringify(x) ?? 'null'; return s.length > 4000 ? `${s.slice(0, 4000)}… (cut)` : x; };
  return steps.map((s) => ({
    reasoning: s.reasoningText ?? '',
    tools: s.toolCalls.map((c) => { const r = s.toolResults.find((x) => x.toolCallId === c.toolCallId); return { name: c.toolName, input: c.input, output: cut(r?.output ?? r?.result ?? null) }; }),
    text: s.text, finish: s.finishReason,
  }));
}
