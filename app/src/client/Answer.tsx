// A place: the map and the agent, nothing else. The map stays still and the chat scrolls beside it
// (under it on a phone). The agent opens with the answer; the buttons on the map run the same 3D
// actions as its tools and put one line in the chat. /api/place gives the 3D tiles and the nearest
// spot that flooded, computed in code.
import { useEffect, useRef, useState, type PointerEvent as PE } from 'react';
import { lazy, Suspense } from 'react';
import type { StageApi } from './Stage';
// the 3D engine is large: it loads on its own, so a slow phone gets the chat first
const Stage = lazy(() => import('./Stage').then((m) => ({ default: m.Stage })));
// the chat library is large too
const Chat = lazy(() => import('./Chat').then((m) => ({ default: m.Chat })));
import { Safe } from './Safe';
import type { Answer as A, Place } from './types';
import type { Note } from './Chat';

export function Answer({ place, onChange }: { place: Place; onChange: () => void }) {
  const [a, setA] = useState<A | null>(null);
  const [error, setError] = useState('');
  const stage = useRef<StageApi>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [say, setSay] = useState<{ id: number; text: string } | null>(null);
  // Witness: a photo through SAM 3.1, shown as a card in the chat and tagged on the map
  const photo = async (file: File) => {
    const id = Date.now();
    setNotes((n) => [...n, { id, text: 'Reading your photo with SAM 3.1 and Muse Spark', busy: true }]);
    const put = (x: Partial<Note>) => setNotes((n) => n.map((m) => (m.id === id ? { ...m, ...x, busy: false } : m)));
    try {
      const { checkPhoto } = await import('./witness');
      const r = await checkPhoto(file);
      // the words come from Muse Spark (what the water reaches, what it means), the numbers from SAM's masks
      const m = r.reading, flood = r.found && (m?.isFlood ?? true);
      const moving = m && m.moving !== 'unclear' && m.moving !== 'still' ? `, moving ${m.moving}` : '';
      const lines = flood
        ? [m?.reaches ? `The water reaches ${m.reaches}${moving}.` : '', m?.meaning ?? '', m?.advice ?? ''].filter(Boolean).map((x) => (/[.!?]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`)).join(' ')
        : r.found ? `This looks like standing water, not a flood${m?.reaches ? `: it reaches ${m.reaches}` : ''}.` : 'No floodwater in this photo.';
      const how = `SAM 3.1 marked the water${r.found ? ` (${r.waterPct}% of the photo)` : ''}${r.people ? ` and pixelated ${r.people === 1 ? '1 person' : `${r.people} people`}` : ''}. Only you can see this photo for now.`;
      // Report this flood: it waits for a person to check it, then shows on maps nearby
      const report = async () => {
        put({ action: undefined, small: 'Sending your report' });
        let session = ''; try { session = localStorage.getItem('fw-session') ?? ''; } catch { /* private window */ }
        const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: r.image, lat: place.lat, lon: place.lon, place: [place.name, place.where].filter(Boolean).join(', '), reaches: m?.reaches ?? '', moving: m?.moving ?? '', meaning: m?.meaning ?? '', waterPct: r.waterPct, people: r.people, session }) }).then((x) => x.json() as Promise<{ id?: string; error?: string }>).catch(() => ({ id: undefined, error: 'The report did not send. Check your connection and try again.' }));
        put(res.id ? { small: 'Reported. A person checks every report; once approved, people within 5 km see it on their map for 48 hours.' } : { small: res.error, action: { label: 'Try again', run: report } });
      };
      put({ img: r.image, text: lines, small: how, action: flood ? { label: 'Report this flood', run: report } : undefined });
      if (flood) stage.current?.run({ action: 'witness', text: m?.reaches ? `Your photo: water to ${m.reaches}` : 'Your photo: floodwater' });
      // the agent answers the photo with the forecast and the ground for this place
      if (flood) setSay({ id, text: `I added a photo of floodwater here.${m?.reaches ? ` The water reaches ${m.reaches}${moving}.` : ''}` });
    } catch (e) { put({ text: e instanceof Error ? e.message : 'The photo check failed. Try again.' }); }
  };
  // Phone: the chat is a sheet over the map with three stops (peek, half, full), dragged by its handle.
  // The map never resizes; only the sheet's height moves, and the camera eases the place into view above it.
  const body = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  const later = useRef<ReturnType<typeof setTimeout>>(undefined);
  const phone = () => matchMedia('(max-width: 899px)').matches;
  const stops = () => { const h = body.current?.clientHeight ?? 600; return [Math.min(190, h * 0.3), Math.round(h * 0.55), h - 120]; };
  const snapTo = (px: number, animate = true) => {
    const el = sheet.current; if (!el) return;
    el.style.transition = animate ? 'height .38s cubic-bezier(.2, .8, .2, 1)' : 'none';
    el.style.height = `${px}px`;
    // the camera eases after the sheet lands, so the two never share frames
    clearTimeout(later.current); later.current = setTimeout(() => setInset(px), animate ? 380 : 0);
  };
  useEffect(() => {
    const fit = () => { if (phone()) snapTo(stops()[1], false); else { if (sheet.current) sheet.current.style.height = ''; setInset(0); } };
    fit(); addEventListener('resize', fit); return () => removeEventListener('resize', fit);
  }, []);
  // Scrolling the chat or typing opens the sheet fully, the way a map app's sheet does; at full, pulling
  // down from the top of the chat brings it back to half.
  useEffect(() => {
    const el = sheet.current; if (!el) return;
    const full = () => (sheet.current?.clientHeight ?? 0) >= stops()[2] - 4;
    const inChat = (t: EventTarget | null) => t instanceof Element && !!t.closest('.chat');
    let y0 = 0, done = false;
    const wheel = (e: WheelEvent) => { if (phone() && inChat(e.target) && !full()) snapTo(stops()[2]); };
    const start = (e: TouchEvent) => { y0 = e.touches[0].clientY; done = false; };
    const move = (e: TouchEvent) => {
      if (!phone() || done || !inChat(e.target)) return;
      const dy = e.touches[0].clientY - y0, chat = el.querySelector<HTMLElement>('.chat');
      if (!full() && Math.abs(dy) > 8) { done = true; snapTo(stops()[2]); }
      else if (full() && chat && chat.scrollTop <= 0 && dy > 40) { done = true; snapTo(stops()[1]); }
    };
    const focus = (e: FocusEvent) => { if (phone() && e.target instanceof HTMLInputElement && !full()) snapTo(stops()[2]); };
    el.addEventListener('wheel', wheel, { passive: true }); el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true }); el.addEventListener('focusin', focus);
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('focusin', focus); };
  }, []);
  const drag = useRef<{ y: number; h: number; t: number; v: number; chat: HTMLElement | null; pinned: boolean } | null>(null);
  const down = (e: PE) => {
    if (!phone() || !sheet.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const chat = sheet.current.querySelector<HTMLElement>('.chat');
    drag.current = { y: e.clientY, h: sheet.current.clientHeight, t: performance.now(), v: 0, chat, pinned: !!chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40 };
    sheet.current.style.transition = 'none';
  };
  const move = (e: PE) => {
    const d = drag.current, el = sheet.current; if (!d || !el) return;
    const [lo, , hi] = stops(), now = performance.now();
    const h = Math.max(lo - 40, Math.min(hi + 20, d.h + d.y - e.clientY));
    d.v = (el.clientHeight - h) / Math.max(1, now - d.t); d.t = now; // positive: moving down
    el.style.height = `${h}px`;
    if (d.pinned && d.chat) d.chat.scrollTop = d.chat.scrollHeight; // the newest words stay in view
  };
  const up = () => {
    const d = drag.current, el = sheet.current; drag.current = null; if (!d || !el) return;
    const all = stops(), h = el.clientHeight;
    // a flick goes one stop in its direction; otherwise the nearest stop
    let i = all.reduce((b, x, k) => (Math.abs(x - h) < Math.abs(all[b] - h) ? k : b), 0);
    if (Math.abs(d.v) > 0.5) { const above = all.findIndex((x) => x > h); i = d.v > 0 ? Math.max(0, (above < 0 ? all.length : above) - 1) : (above < 0 ? all.length - 1 : above); }
    if (Math.abs(h - d.h) < 4) i = all.indexOf(all.reduce((b, x) => (Math.abs(x - d.h) < Math.abs(b - d.h) ? x : b))) === 1 ? 0 : 1; // a tap on the handle: half and peek
    snapTo(all[i]);
    if (d.pinned && d.chat) { const c = d.chat; setTimeout(() => { c.scrollTop = c.scrollHeight; }, 400); }
  };
  // when the agent moves the map while the chat covers most of it, bring the map back into view
  const act = (x: Record<string, unknown>) => {
    if (phone() && sheet.current && sheet.current.clientHeight > stops()[1] + 10) snapTo(stops()[1]);
    stage.current?.run(x);
  };
  // ?replay in the address plays the last flood straight away (for demos and recordings)
  useEffect(() => { if (a?.pack && new URLSearchParams(location.search).has('replay')) stage.current?.run({ action: 'play_last_flood' }); }, [a]);
  useEffect(() => {
    if (!a?.pack) return;
    const pk = a.pack, kx = 111320 * Math.cos((place.lat * Math.PI) / 180), ky = 110574;
    fetch(`/api/reports?lat=${place.lat}&lon=${place.lon}`).then((r) => r.json() as Promise<{ lat: number; lon: number; reaches: string; at: string }[]>).then((list) => {
      if (!Array.isArray(list) || !list.length) return;
      const ago = (at: string) => { const h = Math.round((Date.now() - Date.parse(at)) / 3600e3); return h < 1 ? 'just now' : h === 1 ? '1 hour ago' : `${h} hours ago`; };
      stage.current?.run({ action: 'reports', list: list.map((r) => ({ x: pk.dx + (r.lon - place.lon) * kx, z: pk.dz + (place.lat - r.lat) * ky, text: `Report, ${ago(r.at)}: water to ${r.reaches}` })) });
    }).catch(() => {});
  }, [a]);
  useEffect(() => {
    setA(null); setError(''); setNotes([]);
    fetch(`/api/place?lat=${place.lat}&lon=${place.lon}`).then((r) => r.json() as Promise<A>).then((d) => (d.error ? setError(d.error) : setA(d))).catch(() => setError('The forecast is not answering. Check your connection and try again.'));
  }, [place]);
  return (
    <div className="place">
      <div className="top"><div><b>{place.name}</b><small>{place.where || 'Your place'}</small></div><button className="chip" type="button" onClick={onChange}>Change</button></div>
      <div className="body" ref={body}>
        <div className="mapbox">
          {!a && !error && <div className="stage"><div className="load"><span>Loading your place</span></div></div>}
          {error && <div className="stage none"><p>{error}</p></div>}
          {a && !a.pack && <div className="stage none"><p>Street-level 3D covers Lagos and Nairobi for now. The agent can still read the forecast for your place.</p></div>}
          {a?.pack && <Safe note="The 3D view could not load on this connection. The chat still works."><Suspense fallback={<div className="stage"><div className="load"><span>Loading the 3D</span></div></div>}><Stage ref={stage} pack={a.pack} nearby={a.nearby} inset={inset} onNote={(t) => setNotes((n) => [...n, { id: Date.now(), text: t }])} /></Suspense></Safe>}
        </div>
        <div className="sheet" ref={sheet}>
          <div className="grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="separator" aria-label="Drag to show more map or more chat"><i /></div>
          <Safe note="The chat could not connect. Check your connection and reload the page."><Suspense fallback={<div className="talk" />}><Chat place={place} onAction={act} notes={notes} onPhoto={photo} say={say} logging={a?.logging ?? false} /></Suspense></Safe>
        </div>
      </div>
    </div>
  );
}
