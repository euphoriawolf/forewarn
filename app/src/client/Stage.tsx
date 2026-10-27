// The place in 3D, on top of the answer. The agent drives it: each of its 3D tools returns an
// action, and run() does it here. The answer never waits for this: the 3D loads in stages after it.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { placeScene } from './scene/place3d.js';

import { tileSource, type PinInPack } from './scene/tiles';
export type PackPin = PinInPack;
export interface StageApi { run: (action: Record<string, unknown>) => void }
interface Scene {
  setWater(cm: ArrayLike<number> | null): void; lightRoads(names: string[] | null): void; hours: number; cmAt(h: number): number[]; peak: Float32Array;
  roads: { n: string; p: [number, number][] }[]; depthAt(cm: ArrayLike<number>, x: number, z: number): number;
  tag(text: string, x: number, z: number, cls?: string, lift?: number): HTMLElement; view(name: string, o?: Record<string, number>): void;
  onFrame(fn: ((t: number) => void) | null): void; dispose(): void;
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

export const Stage = forwardRef<StageApi, { pack: PackPin }>(function Stage({ pack }, ref) {
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), scene = useRef<Scene | null>(null), pin = useRef<HTMLElement | null>(null), roadTags = useRef<HTMLElement[]>([]);
  const queued = useRef<Record<string, unknown>[]>([]);
  const key = `${pack.region}:${pack.cx}:${pack.cz}:${pack.dx}:${pack.dz}`;
  const [load, setLoad] = useState({ f: 0, text: 'Loading the ground' });
  const [clock, setClock] = useState('');
  const [legend, setLegend] = useState<'' | 'water' | 'roads'>('');

  useEffect(() => {
    let gone = false;
    placeScene({ stage: box.current, canvas: canvas.current, source: tileSource(pack), view: 'overview', quality: lowEnd() ? 'low' : 'high', progress: (f: number, text: string) => !gone && setLoad({ f, text }) })
      .then((s: Scene) => {
        if (gone) return s.dispose();
        scene.current = s;
        s.view('overview', { tx: pack.dx, tz: pack.dz });
        pin.current = s.tag('Your place', pack.dx, pack.dz, 'green', 8);
        for (const a of queued.current.splice(0)) run(a);
      })
      .catch(() => setLoad({ f: 1, text: 'The 3D could not load. Your answer above is not affected.' }));
    return () => { gone = true; scene.current?.dispose(); scene.current = null; };
  }, [key]);

  const clear = () => {
    const s = scene.current!;
    s.onFrame(null); s.setWater(null); s.lightRoads(null); setClock(''); setLegend('');
    for (const t of roadTags.current.splice(0)) t.remove();
    if (pin.current) { pin.current.textContent = 'Your place'; pin.current.className = 'tag green'; }
  };

  function run(a: Record<string, unknown>) {
    const s = scene.current;
    if (!s) { queued.current.push(a); return; }
    if (a.action === 'overview') { clear(); s.view('overview', { tx: pack.dx, tz: pack.dz }); }
    if (a.action === 'street_view') s.view('street', { tx: pack.dx, tz: pack.dz });
    if (a.action === 'play_last_flood') {
      clear(); setLegend('water');
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

  return (
    <div className="stage" ref={box}>
      <canvas ref={canvas} />
      {clock && <div className="clock">{clock}<span>{pack.start.startsWith('2026-03') ? 'March 2026 storm' : 'June 2026 storm'}</span></div>}
      {legend === 'water' && <div className="legend"><i className="w" />Water from the model<i className="a" />Water at the door</div>}
      {legend === 'roads' && <div className="legend"><i className="r" />Water in the last storm<i className="g" />Stayed dry</div>}
      <div className={`load ${load.f >= 1 ? 'done' : ''}`}><span>{load.text}</span><i><b style={{ width: `${load.f * 100}%` }} /></i></div>
    </div>
  );
});
