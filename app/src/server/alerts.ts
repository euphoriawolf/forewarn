// Follow an area, and the alerts a person approves.
//
// A person follows an area with their email. Nothing is sent to them until they confirm by the link in
// the first email. Each followed area has its own Watch agent (src/server/watch.ts) that checks the
// forecast every 6 hours and may draft an alert. A draft waits here until a person approves it on the
// review page (Meta's acceptable use policy: a person checks what goes to others). Only then is it sent.
//
// The anti-spam rules (from Flood Check's alerts): confirmed addresses only; at most 1 confirmation email
// per address an hour and 3 a day; unconfirmed follows are deleted after 7 days; at most 2 alert emails
// per address a day; a stop link in every email.
import { DurableObject } from 'cloudflare:workers';

export interface Area { key: string; name: string; where: string; lat: number; lon: number }
export interface Draft { id: string; at: string; area: string; name: string; lat: number; lon: number; subject: string; body: string; why: string; reading: string; status: 'pending' | 'approved' | 'rejected'; sent: number; skipped: number }
export interface Follower { email: string; token: string; area: string; name: string }

// one Watch agent per area: about 1 km, so neighbours on the same street share one check
export const areaKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;
const PER_DAY = 2, CONFIRM_HOUR = 1, CONFIRM_DAY = 3;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export class Alerts extends DurableObject {
  private ready = false;
  private get sql() { return this.ctx.storage.sql; }
  private init() {
    if (this.ready) return;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS followers (token TEXT PRIMARY KEY, email TEXT, area TEXT, name TEXT, place_where TEXT, lat REAL, lon REAL, added_at TEXT, confirmed_at TEXT, stopped_at TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS confirm_sends (email TEXT, at TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, at TEXT, area TEXT, name TEXT, lat REAL, lon REAL, subject TEXT, body TEXT, why TEXT, reading TEXT, status TEXT, decided_at TEXT, sent INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sends (email TEXT, at TEXT, draft TEXT, result TEXT)`);
    this.ready = true;
  }

  // a follow, unconfirmed until the link in the email is opened. Returns the token for that link,
  // or `already` when this address follows this area already.
  follow(email: string, a: Area): { token: string; already: boolean } {
    this.init();
    this.sql.exec('DELETE FROM followers WHERE confirmed_at IS NULL AND added_at < ?', ago(7 * 864e5));
    const old = this.sql.exec('SELECT token, confirmed_at, stopped_at FROM followers WHERE email = ? AND area = ?', email, a.key).toArray()[0];
    if (old && old.confirmed_at && !old.stopped_at) return { token: String(old.token), already: true };
    if (old) { this.sql.exec('UPDATE followers SET confirmed_at = NULL, stopped_at = NULL, added_at = ? WHERE token = ?', new Date().toISOString(), old.token); return { token: String(old.token), already: false }; }
    const token = crypto.randomUUID().replace(/-/g, '');
    this.sql.exec('INSERT INTO followers (token, email, area, name, place_where, lat, lon, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', token, email, a.key, a.name.slice(0, 80), a.where.slice(0, 120), a.lat, a.lon, new Date().toISOString());
    return { token, already: false };
  }
  // true when a confirmation email may go to this address now (and counts it)
  mayConfirm(email: string): boolean {
    this.init();
    const n = (since: string) => Number(this.sql.exec('SELECT COUNT(*) AS n FROM confirm_sends WHERE email = ? AND at > ?', email, since).one().n);
    if (n(ago(3600e3)) >= CONFIRM_HOUR || n(ago(864e5)) >= CONFIRM_DAY) return false;
    this.sql.exec('INSERT INTO confirm_sends (email, at) VALUES (?, ?)', email, new Date().toISOString());
    return true;
  }
  // the link in the confirmation email confirms every area that address added
  confirm(token: string): Area[] {
    this.init();
    const row = this.sql.exec('SELECT email FROM followers WHERE token = ?', token).toArray()[0];
    if (!row) return [];
    const now = new Date().toISOString();
    this.sql.exec('UPDATE followers SET confirmed_at = ? WHERE email = ? AND confirmed_at IS NULL AND stopped_at IS NULL', now, row.email);
    return this.sql.exec('SELECT area, name, place_where, lat, lon FROM followers WHERE email = ? AND stopped_at IS NULL AND confirmed_at IS NOT NULL', row.email).toArray()
      .map((r) => ({ key: String(r.area), name: String(r.name), where: String(r.place_where ?? ''), lat: Number(r.lat), lon: Number(r.lon) }));
  }
  stop(token: string): { name: string; area: string } | null {
    this.init();
    const row = this.sql.exec('SELECT name, area FROM followers WHERE token = ?', token).toArray()[0];
    if (!row) return null;
    this.sql.exec('UPDATE followers SET stopped_at = ? WHERE token = ?', new Date().toISOString(), token);
    return { name: String(row.name), area: String(row.area) };
  }
  followersOf(area: string): Follower[] {
    this.init();
    return this.sql.exec('SELECT email, token, area, name FROM followers WHERE area = ? AND confirmed_at IS NOT NULL AND stopped_at IS NULL', area).toArray()
      .map((r) => ({ email: String(r.email), token: String(r.token), area: String(r.area), name: String(r.name) }));
  }

  addDraft(d: Omit<Draft, 'id' | 'at' | 'status' | 'sent' | 'skipped'>): string {
    this.init();
    const id = crypto.randomUUID();
    // a newer draft for the same area replaces one still waiting: the person approves the latest reading
    this.sql.exec("UPDATE drafts SET status = 'rejected', decided_at = ? WHERE area = ? AND status = 'pending'", new Date().toISOString(), d.area);
    this.sql.exec("INSERT INTO drafts (id, at, area, name, lat, lon, subject, body, why, reading, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')", id, new Date().toISOString(), d.area, d.name, d.lat, d.lon, d.subject, d.body, d.why, d.reading);
    return id;
  }
  private draft = (r: Record<string, SqlStorageValue>): Draft => ({ id: String(r.id), at: String(r.at), area: String(r.area), name: String(r.name), lat: Number(r.lat), lon: Number(r.lon), subject: String(r.subject), body: String(r.body), why: String(r.why), reading: String(r.reading), status: String(r.status) as Draft['status'], sent: Number(r.sent), skipped: Number(r.skipped) });
  pendingDrafts(): (Draft & { followers: number })[] {
    this.init();
    return this.sql.exec("SELECT * FROM drafts WHERE status = 'pending' ORDER BY at DESC LIMIT 50").toArray().map(this.draft).map((d) => ({ ...d, followers: this.followersOf(d.area).length }));
  }
  // approve (with the person's edits) or reject; an approved draft is returned once, for sending
  decide(id: string, status: 'approved' | 'rejected', subject?: string, body?: string): Draft | null {
    this.init();
    const r = this.sql.exec("SELECT * FROM drafts WHERE id = ? AND status = 'pending'", id).toArray()[0];
    if (!r) return null;
    this.sql.exec('UPDATE drafts SET status = ?, decided_at = ?, subject = COALESCE(?, subject), body = COALESCE(?, body) WHERE id = ?', status, new Date().toISOString(), subject || null, body || null, id);
    return status === 'approved' ? this.draft(this.sql.exec('SELECT * FROM drafts WHERE id = ?', id).one()) : null;
  }
  // at most PER_DAY alert emails to one address in 24 hours
  maySend(email: string): boolean {
    this.init();
    return Number(this.sql.exec("SELECT COUNT(*) AS n FROM sends WHERE email = ? AND at > ? AND result = 'ok'", email, ago(864e5)).one().n) < PER_DAY;
  }
  recordSend(email: string, draft: string, result: string) {
    this.init();
    this.sql.exec('INSERT INTO sends (email, at, draft, result) VALUES (?, ?, ?, ?)', email, new Date().toISOString(), draft, result);
    this.sql.exec(result === 'ok' ? 'UPDATE drafts SET sent = sent + 1 WHERE id = ?' : 'UPDATE drafts SET skipped = skipped + 1 WHERE id = ?', draft);
  }
}

export interface AlertsStub {
  follow(email: string, a: Area): Promise<{ token: string; already: boolean }>; mayConfirm(email: string): Promise<boolean>; confirm(token: string): Promise<Area[]>;
  stop(token: string): Promise<{ name: string; area: string } | null>; followersOf(area: string): Promise<Follower[]>;
  addDraft(d: Omit<Draft, 'id' | 'at' | 'status' | 'sent' | 'skipped'>): Promise<string>; pendingDrafts(): Promise<(Draft & { followers: number })[]>;
  decide(id: string, status: 'approved' | 'rejected', subject?: string, body?: string): Promise<Draft | null>; maySend(email: string): Promise<boolean>; recordSend(email: string, draft: string, result: string): Promise<void>;
}
export const alertsOf = (ns: DurableObjectNamespace) => ns.get(ns.idFromName('main')) as unknown as AlertsStub;

// ---- email

export interface MailEnv { EMAIL: SendEmail; EMAIL_FROM: string; ALERTS_REPLY_TO: string; SITE: string }
export const mapLink = (site: string, a: { name: string; lat: number; lon: number; where?: string }) => `${site}/?${new URLSearchParams({ lat: a.lat.toFixed(5), lon: a.lon.toFixed(5), name: a.name, where: a.where ?? '' })}`;

export async function mail(env: MailEnv, to: string, subject: string, text: string): Promise<string> {
  try { await env.EMAIL.send({ from: { name: 'Forewarn', email: env.EMAIL_FROM }, to, replyTo: env.ALERTS_REPLY_TO, subject, text }); return 'ok'; }
  catch (e) { return String(e instanceof Error ? e.message : e).slice(0, 160); }
}

export const confirmEmail = (site: string, a: Area, token: string) => `Hi,

Someone, probably you, asked Forewarn to send flood alerts for ${a.name}${a.where ? `, ${a.where}` : ''} to this address.

Open this link to start them:
${site}/api/follow/confirm?t=${token}

Forewarn checks the forecast for this area every 6 hours. When a flood looks possible in the next 7 days, it writes an alert, a person reads it, and only then is it sent. At most 2 alerts a day.

If you did not ask for this, ignore this email. Nothing more will come.

Forewarn
${site}`;

export const alertFooter = (site: string, d: { name: string; lat: number; lon: number }, token: string) => `

See the forecast and ask about your area:
${mapLink(site, d)}

A person at Forewarn read this alert before it was sent.
Stop alerts for ${d.name}: ${site}/api/follow/stop?t=${token}`;

// send an approved draft to every confirmed follower of its area, inside the daily cap
export async function sendDraft(env: MailEnv & { Alerts: DurableObjectNamespace }, d: Draft): Promise<{ sent: number; capped: number; failed: number }> {
  const store = alertsOf(env.Alerts), out = { sent: 0, capped: 0, failed: 0 };
  for (const f of await store.followersOf(d.area)) {
    if (!(await store.maySend(f.email))) { await store.recordSend(f.email, d.id, 'daily cap'); out.capped++; continue; }
    const r = await mail(env, f.email, d.subject, d.body + alertFooter(env.SITE, d, f.token));
    await store.recordSend(f.email, d.id, r);
    if (r === 'ok') out.sent++; else out.failed++;
  }
  return out;
}

// a small page for the links in the emails
export const notePage = (title: string, text: string, site: string) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f8f9f6;color:#16201b}main{max-width:520px;margin:12vh auto;padding:0 16px}h1{font-size:24px}a{color:#1d4ed8;font-weight:600}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><p><a href="${site}">Open Forewarn</a></p></main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
