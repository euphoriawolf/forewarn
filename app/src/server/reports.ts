// Flood reports from Witness. A person sends a photo (people already pixelated by the page), with what
// Muse Spark read in it and where it was taken (their place pin). Every report waits as "pending" until a
// person approves it on the review page (Meta's acceptable use policy: a person checks what goes to others).
// Approved reports from the last 48 hours show on the map of anyone nearby, and the agent can mention them.
import { DurableObject } from 'cloudflare:workers';

export interface ReportIn { session: string; lat: number; lon: number; place: string; reaches: string; moving: string; meaning: string; waterPct: number; people: number; image: string }
export interface Report extends Omit<ReportIn, 'image' | 'session'> { id: string; at: string; status: 'pending' | 'approved' | 'rejected' }

const PER_DAY = 5; // reports one visitor can send in a day
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const kx = 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 110.574);
};

export class Reports extends DurableObject {
  private ready = false;
  private init() {
    if (this.ready) return;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, at TEXT, session TEXT, lat REAL, lon REAL, place TEXT,
      reaches TEXT, moving TEXT, meaning TEXT, water_pct INTEGER, people INTEGER, image TEXT, status TEXT)`);
    this.ready = true;
  }
  private row = (r: Record<string, SqlStorageValue>): Report => ({
    id: String(r.id), at: String(r.at), lat: Number(r.lat), lon: Number(r.lon), place: String(r.place), reaches: String(r.reaches),
    moving: String(r.moving), meaning: String(r.meaning), waterPct: Number(r.water_pct), people: Number(r.people), status: String(r.status) as Report['status'],
  });

  add(r: ReportIn): { id: string } | { error: string } {
    this.init();
    const since = new Date(Date.now() - 864e5).toISOString();
    const n = Number(this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM reports WHERE session = ? AND at > ?', r.session, since).one().n);
    if (n >= PER_DAY) return { error: `You have sent ${PER_DAY} reports today. Thank you: that is the most one person can send in a day.` };
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec('INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, new Date().toISOString(), r.session, r.lat, r.lon,
      r.place.slice(0, 120), r.reaches.slice(0, 120), r.moving.slice(0, 20), r.meaning.slice(0, 300), Math.round(r.waterPct), Math.round(r.people), r.image, 'pending');
    return { id };
  }
  pending(): Report[] { this.init(); return this.ctx.storage.sql.exec("SELECT * FROM reports WHERE status = 'pending' ORDER BY at DESC LIMIT 100").toArray().map(this.row); }
  decide(id: string, status: 'approved' | 'rejected') { this.init(); this.ctx.storage.sql.exec('UPDATE reports SET status = ? WHERE id = ?', status, id); }
  image(id: string, any = false): string | null {
    this.init();
    const r = this.ctx.storage.sql.exec(`SELECT image FROM reports WHERE id = ?${any ? '' : " AND status = 'approved'"}`, id).toArray()[0];
    return r ? String(r.image) : null;
  }
  // approved reports within `radius` km of a point, from the last 48 hours, nearest first
  near(lat: number, lon: number, radius = 5): (Report & { km: number })[] {
    this.init();
    const since = new Date(Date.now() - 48 * 3600e3).toISOString();
    return this.ctx.storage.sql.exec("SELECT * FROM reports WHERE status = 'approved' AND at > ?", since).toArray().map(this.row)
      .map((r) => ({ ...r, km: Math.round(km(r, { lat, lon }) * 10) / 10 })).filter((r) => r.km <= radius).sort((a, b) => a.km - b.km).slice(0, 20);
  }
}

export interface ReportsStub {
  add(r: ReportIn): Promise<{ id: string } | { error: string }>; pending(): Promise<Report[]>; decide(id: string, s: 'approved' | 'rejected'): Promise<void>;
  image(id: string, any?: boolean): Promise<string | null>; near(lat: number, lon: number, radius?: number): Promise<(Report & { km: number })[]>;
}
export const reportsOf = (ns: DurableObjectNamespace) => ns.get(ns.idFromName('main')) as unknown as ReportsStub;
