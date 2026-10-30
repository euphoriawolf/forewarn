// The Watch agent: one per followed area (about 1 km, see areaKey). Every 6 hours it wakes on its own
// (Agents SDK schedule), reads the forecast and the ground, compares with what it saw last time, and
// decides in code: no change, an update (kept in its memory only), or an alert. An alert is written by
// Muse Spark Open from the reading, checked number by number, and sent to the review queue. Nothing
// reaches a follower until a person approves it (src/server/alerts.ts).
import { Agent, getAgentByName } from 'agents';
import { generateText } from 'ai';
import { readForecast, alertRiskiest, THREE_DAY_MM, type Level } from './forecast';
import { floodLine } from './place';
import { rainLast30 } from './rain30';
import { model, checkNumbers, type Env } from './harness';
import { alertsOf, type Area } from './alerts';

export interface Reading { at: string; day: string; when: string; level: Level; runsOverLine: number; runsOver3Days: number; why: 'one day' | '3 days'; runs: number; chance: string; middleMm: number; wettestMm: number; floodLineMm: number; lineNote: string; ground: { mm: number; normalMm: number; word: string; groundSoaked: boolean } | null }
export interface Decision { at: string; kind: 'no change' | 'update' | 'alert'; why: string; reading: Reading; draft?: string }
interface State { area: Area | null; last: Reading | null; lastAlert: { day: string; level: Level; at: string } | null; log: Decision[] }

const EVERY = 6 * 3600, RANK: Record<Level, number> = { green: 0, amber: 1, red: 2 };
const WORD: Record<Level, string> = { green: 'unlikely', amber: 'possible', red: 'likely' };

export class Watch extends Agent<Env, State> {
  initialState: State = { area: null, last: null, lastAlert: null, log: [] };

  // called when someone confirms a follow; safe to call again (scheduleEvery is idempotent)
  async watch(area: Area) {
    if (!this.state.area) this.setState({ ...this.state, area });
    await this.scheduleEvery(EVERY, 'check');
    // the first reading now, so the next check has something to compare with
    if (!this.state.last) await this.check();
    return { area: this.state.area, last: this.state.last };
  }

  // the 6-hourly check. `test.lineMm` lowers the flood line to force a warning (the test route only).
  async check(test?: { lineMm?: number }): Promise<Decision | { stopped: true }> {
    const area = this.state.area;
    if (!area) return { stopped: true };
    // nobody follows this area any more: stop waking up
    if (!test && (await alertsOf(this.env.Alerts).followersOf(area.key)).length === 0) {
      for (const s of this.getSchedules()) await this.cancelSchedule(s.id);
      return { stopped: true };
    }
    const line = test?.lineMm ? { mm: test.lineMm, note: `A test flood line of ${test.lineMm} mm, set by hand.` } : await floodLine(this.env.FLOOD_CHECK_API, area.lat, area.lon);
    const [f, ground] = await Promise.all([readForecast(area.lat, area.lon, line.mm), rainLast30(this.env.ASSETS, area.lat, area.lon).catch(() => null)]);
    // alerts look 7 days ahead: further out, a flood chance changes too much between runs to warn on
    // email alerts use the stricter rule (forecast.ts: ALERT), so people keep trusting them
    const week = f.days.slice(0, 7), worst = alertRiskiest(week);
    const reading: Reading = { at: new Date().toISOString(), day: worst.day, when: worst.when, level: worst.alertLevel, runsOverLine: worst.runsOverLine, runsOver3Days: worst.runsOver3Days, why: worst.alertWhy, runs: worst.runs, chance: worst.alertChance, middleMm: worst.middleMm, wettestMm: worst.wettestMm, floodLineMm: line.mm, lineNote: line.note,
      ground: ground ? { mm: ground.mm, normalMm: ground.normalMm, word: ground.word, groundSoaked: ground.groundSoaked } : null };
    const decision = this.decide(reading, this.state.last, this.state.lastAlert, !!test);
    if (decision.kind === 'alert') {
      decision.draft = await this.draft(area, reading, decision.why, !!test);
      if (!test) this.setState({ ...this.state, lastAlert: { day: reading.day, level: reading.level, at: reading.at } });
    }
    // memory: the last reading (not from a test) and the last 20 decisions
    this.setState({ ...this.state, last: test ? this.state.last : reading, log: [decision, ...this.state.log].slice(0, 20) });
    return decision;
  }

  // the rule, in code: warn when the riskiest day of the next 7 is possible or likely, unless that
  // same day was already warned at that level (or higher) in the last 3 days
  decide(r: Reading, last: Reading | null, lastAlert: State['lastAlert'], test: boolean): Decision {
    const base = { at: r.at, reading: r };
    if (RANK[r.level] >= 1) {
      const warned = lastAlert && lastAlert.day === r.day && RANK[lastAlert.level] >= RANK[r.level] && Date.parse(r.at) - Date.parse(lastAlert.at) < 3 * 864e5;
      if (warned && !test) return { ...base, kind: 'no change', why: `Still ${WORD[r.level]} ${on(r.when)}, and followers were already warned about that day.` };
      return { ...base, kind: 'alert', why: lastAlert && lastAlert.day === r.day ? `Rose to ${WORD[r.level]} ${on(r.when)}.` : `Flooding ${WORD[r.level]} ${on(r.when)}: ${counted(r)}.` };
    }
    if (!last) return { ...base, kind: 'update', why: 'First reading for this area.' };
    if (RANK[last.level] >= 1) return { ...base, kind: 'update', why: `The risk ${on(last.when)} has passed: now unlikely.` };
    if (Math.abs(n(r) - n(last)) >= 3) return { ...base, kind: 'update', why: `Still unlikely, but ${n(r)} forecasts reach a warning line now against ${n(last)} last time.` };
    return { ...base, kind: 'no change', why: 'Still unlikely for the next 7 days.' };
  }

  // the alert words: Muse Spark Open writes them from the reading; the checker holds every number
  // to the reading, and a fixed text written in code takes over if the model's words do not pass
  async draft(area: Area, r: Reading, why: string, test: boolean): Promise<string> {
    const word = WORD[r.level];
    const plain = [
      r.why === '3 days'
        ? `Flooding looks ${word} in ${area.name} ${on(r.when)}. ${cap(r.chance)} forecasts bring ${THREE_DAY_MM} mm of rain or more over the 3 days to then, enough to flood many places.`
        : `Flooding looks ${word} in ${area.name} ${on(r.when)}. ${cap(r.chance)} forecasts bring more than ${r.floodLineMm} mm of rain that day, the amount that floods here.`,
      r.ground ? (r.ground.groundSoaked ? `The ground is already soaked: ${r.ground.mm} mm fell in the last 30 days, against a normal ${r.ground.normalMm} mm, so water rises sooner.` : `The ground is ${r.ground.word}: ${r.ground.mm} mm in the last 30 days.`) : '',
      'Move valuables off the floor, keep your phone charged, and agree with your family where to meet if water comes in.',
    ].filter(Boolean).join(' ');
    let body = plain;
    try {
      const out = await generateText({
        model: model(this.env), maxOutputTokens: 2000, providerOptions: { baseten: { reasoningEffort: 'low' } }, abortSignal: AbortSignal.timeout(60000),
        prompt: `Write a flood alert email for people who follow ${area.name}${area.where ? `, ${area.where}` : ''} in Forewarn.
The reading, from code: ${JSON.stringify(r)}
Write 3 or 4 short sentences, at most 80 words, plain English, no greeting, no sign-off, no em dashes:
1. Flooding looks ${word} ${on(r.when)}, and the chance in words ("${r.chance} forecasts") with ${r.why === '3 days' ? `the ${THREE_DAY_MM} mm over 3 days that the chance counts` : 'the flood line in mm for that day'}.
2. What the ground adds (soaked ground floods sooner), only if the reading has it.
3. Two or three things to do now to get ready, for a home in a city or a farm.
Use only numbers that are in the reading. Do not invent a depth.`,
      });
      const text = out.text.replace(/\s*—\s*/g, ', ').replace(/ [-–] /g, ', ').trim();
      if (text && checkNumbers(text, [r], '').length === 0 && text.split(/\s+/).length <= 110) body = text;
    } catch (e) { console.error('alert draft:', e instanceof Error ? e.message : e); }
    const subject = `${test ? '[Test] ' : ''}Flooding ${word} in ${area.name} ${on(r.when)}`;
    return alertsOf(this.env.Alerts).addDraft({ area: area.key, name: area.name, lat: area.lat, lon: area.lon, subject, body, why: (test ? 'Test run with a lowered flood line. ' : '') + why, reading: JSON.stringify(r) });
  }

  // what the agent remembers, for the test route
  memory() { return this.state; }
}
// the runs that count, in words (older readings, from before the 3-day rule, have no 3-day count)
const n = (r: Reading) => Math.max(r.runsOverLine, r.runsOver3Days ?? 0);
const counted = (r: Reading) => (r.why === '3 days' ? `${r.runsOver3Days} of ${r.runs} forecasts bring ${THREE_DAY_MM} mm or more over 3 days` : `${r.runsOverLine} of ${r.runs} forecasts reach the flood line`);
// "on Thursday", but "today" and "tomorrow" alone
const on = (when: string) => (/^(today|tomorrow)$/.test(when) ? when : `on ${when}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// the Watch agent of one area, for calls from the Worker
export const watchOf = (env: Env, key: string) => getAgentByName(env.Watch as unknown as DurableObjectNamespace<Watch>, key);
