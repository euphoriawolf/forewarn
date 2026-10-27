// The place in 3D, beside the chat. The agent drives it: each of its 3D tools returns an action,
// and run() does it here. The buttons on the map run the same actions and put one line in the chat.
// The chat never waits for this: the 3D loads in stages.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { placeScene } from './scene/place3d.js';
import * as I from './icons';
import type { Nearby } from './types';

import { tileSource, type PinInPack } from './scene/tiles';
export type PackPin = PinInPack;
export interface StageApi { run: (action: Record<string, unknown>) => void }
// the buttons on the map, and the action each one runs
const ACTS = [['Last flood', 'play_last_flood', I.Play], ['Nearest flood', 'show_spot', I.Drop], ['My street', 'street_view', I.Eye], ['Overview', 'overview', I.Up]] as const;
interface Scene {
  setWater(cm: ArrayLike<number> | null): void; lightRoads(names: string[] | null): void; hours: number; cmAt(h: number): number[]; peak: Float32Array;
  roads: { n: string; p: [number, number][] }[]; depthAt(cm: ArrayLike<number>, x: number, z: number): number;
  tag(text: string, x: number, z: number, cls?: string, lift?: number): HTMLElement; view(name: string, o?: Record<string, number>): void; camera(): Record<string, number>;
  onFrame(fn: ((t: number) => void) | null): void; zoom(f: number): void; north(): void; dispose(): void;
}

// slow phones get the light version: no ambient occlusion, small shadows, 1x pixels
const lowEnd = () => {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (n.deviceMemory ?? 8) <= 4 || (n.hardwareConcurrency ?? 8) <= 4 || !!n.connection?.saveData;
};
const when = (start: string, h: number) => {
  const t = new Date(Date.parse(start + ':00Z') + h * 3600e3);
  return `${t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${String(t.getUTCHours()).padStart(2, '0')}:00`;
};

export const Stage = forwardRef<StageApi, { pack: PackPin; nearby?: Nearby | null; onNote?: (text: string) => void }>(function Stage({ pack: start, nearby, onNote }, ref) {
  // the area on screen: starts around the pin, moves when the person pans more than 1 km away
  const [pack, setPack] = useState(start);
  useEffect(() => setPack(start), [`${start.region}:${start.cx}:${start.cz}:${start.dx}:${start.dz}`]);
  const nextCamera = useRef<Record<string, number> | null>(null);
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), scene = useRef<Scene | null>(null), pin = useRef<HTMLElement | null>(null), roadTags = useRef<HTMLElement[]>([]);
  const queued = useRef<Record<string, unknown>[]>([]);
  const key = `${pack.region}:${pack.cx}:${pack.cz}:${pack.dx}:${pack.dz}`;
  const [load, setLoad] = useState({ f: 0, text: 'Loading the ground' });
  const [clock, setClock] = useState('');
  const [legend, setLegend] = useState<'' | 'water' | 'roads'>('');
  const [on, setOn] = useState('');
  const needle = useRef<HTMLSpanElement>(null);
  const storm = pack.start.startsWith('2026-03') ? 'March 2026 storm' : 'June 2026 storm';

  useEffect(() => {
    let gone = false;
    placeScene({ stage: box.current, canvas: canvas.current, source: tileSource(pack), view: 'overview', quality: lowEnd() ? 'low' : 'high', progress: (f: number, text: string) => !gone && setLoad({ f, text }), start: nextCamera.current ?? undefined, onSettle: (x: number, z: number) => !gone && moveTo(x, z), onView: (yaw: number) => { if (needle.current) needle.current.style.transform = `rotate(${yaw}rad)`; } })
      .then((s: Scene) => {
        if (gone) return s.dispose();
        scene.current = s;
        if (!nextCamera.current) s.view('overview', { tx: pack.dx, tz: pack.dz });
        nextCamera.current = null;
        pin.current = s.tag('Your place', pack.dx, pack.dz, 'green', 8);
        for (const a of queued.current.splice(0)) run(a);
      })
      .catch(() => setLoad({ f: 1, text: 'The 3D could not load on this connection. The chat still works.' }));
    return () => { gone = true; scene.current?.dispose(); scene.current = null; };
  }, [key]);

  // panned far from the centre: load the four tiles around the new spot, keep the camera where it is
  const index = useRef<Promise<{ tile: number; tiles: number[][] }> | null>(null);
  async function moveTo(x: number, z: number) {
    if (Math.max(Math.abs(x), Math.abs(z)) < 1000) return;
    index.current ??= fetch(`/tiles/${pack.region}/index.json`).then((r) => r.json());
    const ix = await index.current, T = ix.tile, X = pack.cx + x, Z = pack.cz + z;
    const i0 = Math.round(X / T) - 1, j0 = Math.round(Z / T) - 1, have = new Set(ix.tiles.map(([i, j]) => `${i}_${j}`));
    const tiles = ([[i0, j0], [i0 + 1, j0], [i0, j0 + 1], [i0 + 1, j0 + 1]] as [number, number][]).filter(([i, j]) => have.has(`${i}_${j}`));
    if (!tiles.length) return;
    const cx = (i0 + 1) * T, cz = (j0 + 1) * T, cam = scene.current?.camera();
    nextCamera.current = cam ? { ...cam, tx: cam.tx + pack.cx - cx, tz: cam.tz + pack.cz - cz } : null;
    setPack({ ...pack, tiles, cx, cz, dx: pack.dx + pack.cx - cx, dz: pack.dz + pack.cz - cz });
  }

  const clear = () => {
    const s = scene.current!;
    s.onFrame(null); s.setWater(null); s.lightRoads(null); setClock(''); setLegend(''); setOn('');
    for (const t of roadTags.current.splice(0)) t.remove();
    if (pin.current) { pin.current.textContent = 'Your place'; pin.current.className = 'tag green'; }
  };

  function run(a: Record<string, unknown>) {
    const s = scene.current;
    if (!s) { queued.current.push(a); return; }
    if (a.action === 'overview') { clear(); s.view('overview', { tx: pack.dx, tz: pack.dz }); setOn('overview'); }
    if (a.action === 'street_view') { s.view('street', { tx: pack.dx, tz: pack.dz }); setOn('street_view'); }
    if (a.action === 'play_last_flood') {
      clear(); setLegend('water'); setOn('play_last_flood');
      s.view('street', { tx: pack.dx, tz: pack.dz, dist: 420, pitch: 0.28 });
      // the storm from the first wet hour to a little after its peak at the pin, then hold the peak
      const atPin = Array.from({ length: s.hours }, (_, h) => s.depthAt(s.cmAt(h), pack.dx, pack.dz));
      const wetArea = Array.from({ length: s.hours }, (_, h) => s.cmAt(h).filter((d) => d >= 10).length);
      const top = wetArea.indexOf(Math.max(...wetArea)), pinTop = atPin.indexOf(Math.max(...atPin));
      const start = Math.max(0, wetArea.findIndex((n) => n > 0) - 2), end = Math.min(s.hours - 1, Math.max(top, pinTop) + 3); // run to the later of the area's worst hour and the pin's
      let h = start, last = 0;
      const show = (k: number) => {
        s.setWater(s.cmAt(k)); setClock(when(pack.start, k));
        if (pin.current) { pin.current.textContent = atPin[k] >= 4 ? `${atPin[k]} cm here` : 'Your place'; pin.current.className = 'tag ' + (atPin[k] >= 4 ? 'blue' : 'green'); }
      };
      s.onFrame((t) => { if (t - last < 350) return; last = t; show(h); if (h >= end) s.onFrame(null); else h++; });
    }
    if (a.action === 'show_spot') {
      clear(); setLegend('water'); setOn('show_spot');
      const x = Number(a.x), z = Number(a.z);
      s.setWater(s.peak);
      roadTags.current.push(s.tag(`${a.peakCm} cm in the last storm`, x, z, 'blue', 6));
      s.view('street', { tx: x, tz: z, dist: 380, pitch: 0.5 });
    }
    if (a.action === 'light_roads') {
      clear(); setLegend('roads');
      const found = ((a.roads as { found: boolean; name?: string }[]) ?? []).filter((r) => r.found).map((r) => r.name!);
      s.lightRoads(found); s.setWater(s.peak);
      const all: [number, number][] = [];
      for (const n of found) {
        const pts = s.roads.filter((r) => r.n === n).flatMap((r) => r.p); if (!pts.length) continue;
        const wet = pts.filter(([x, z]) => s.depthAt(s.peak, x, z) >= 10), p = (wet.length ? wet : pts)[Math.floor((wet.length ? wet : pts).length / 2)];
        roadTags.current.push(s.tag(n, p[0], p[1], wet.length ? 'red' : 'green', 12)); all.push(...pts);
      }
      if (all.length) {
        const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
        s.view('roads', { tx: cx, tz: cz, dist: Math.min(1300, Math.max(600, span * 0.9)), pitch: 1.05 }); // close enough to read the roads, never past the edge of the model
      }
    }
  }
  useImperativeHandle(ref, () => ({ run }), [key]);

  // a button on the map: the same action the agent's tool runs, plus one line for the chat, from real numbers
  function tap(action: string) {
    const s = scene.current;
    const month = storm.split(' ')[0];
    const near = nearby && !nearby.here ? ` The nearest spot that flooded is ${nearby.distanceM} m ${nearby.direction}, where the model shows ${nearby.peakCm} cm.` : '';
    if (action === 'play_last_flood') {
      run({ action });
      if (s) {
        const top = Math.max(...Array.from({ length: s.hours }, (_, h) => s.depthAt(s.cmAt(h), pack.dx, pack.dz)));
        onNote?.(`Playing the ${storm}, hour by hour. ${top >= 4 ? `The model shows water reached ${top} cm at your spot.` : 'The model shows your spot stayed dry.'}${near}`);
      }
    } else if (action === 'show_spot') {
      if (!nearby) { onNote?.(`No spot in the 4 km around you flooded in the ${storm}, in the model.`); return; }
      run({ action, ...nearby });
      onNote?.(nearby.here ? `Your spot flooded in the ${storm}: the model shows ${nearby.peakCm} cm.` : `The nearest spot that flooded in the ${month} storm is ${nearby.distanceM} m ${nearby.direction}. The model shows ${nearby.peakCm} cm there.`);
    } else run({ action });
  }

  return (
    <div className="stage">
      <div className="scene" ref={box}><canvas ref={canvas} /></div>
      {clock && <div className="clock">{clock}<span>{storm}</span></div>}
      <div className="acts">{ACTS.map(([label, action, Icon]) => <button key={action} type="button" className={on === action ? 'on' : ''} onClick={() => tap(action)}><Icon />{label}</button>)}</div>
      <div className="nav">
        <button type="button" aria-label="Point north" title="Point north" onClick={() => scene.current?.north()}><span ref={needle}><I.North /></span></button>
        <button type="button" className="desk" aria-label="Zoom in" onClick={() => scene.current?.zoom(0.6)}><I.Plus /></button>
        <button type="button" className="desk" aria-label="Zoom out" onClick={() => scene.current?.zoom(1 / 0.6)}><I.Minus /></button>
      </div>
      {legend === 'water' && <div className="legend"><i className="w" />Water (drawn 4x deeper)<i className="a" />Water at the door</div>}
      {legend === 'roads' && <div className="legend"><i className="r" />Water in the last storm<i className="g" />Stayed dry</div>}
      <div className={`load ${load.f >= 1 ? 'done' : ''}`}><span>{load.text}</span><i><b style={{ width: `${load.f * 100}%` }} /></i></div>
    </div>
  );
});
