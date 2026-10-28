// What is near a place: the points that matter around the pin, nearest first, with distance and direction,
// so there is always somewhere to look even when the pin stayed dry. A tap shows the point on the map,
// or opens the time machine for a past flood the map cannot reach.
import { useState } from 'react';
import * as I from './icons';
import { pinLabel } from './types';

export interface NearPoint { kind: 'flood' | 'report' | 'past'; id?: number; title: string; detail: string; lat?: number; lon?: number; m: number; direction: string; x?: number; z?: number }

export const distance = (m: number) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : m < 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`);
export const where = (p: NearPoint) => (p.m < 60 ? 'at the pin' : `${distance(p.m)} ${p.direction}`);

// `room`: the height of map that shows above the chat sheet, so the list never goes under it
export function Near({ points, onPick, room, name }: { points: NearPoint[] | null; onPick: (p: NearPoint) => void; room?: number; name: string }) {
  const [open, setOpen] = useState(false);
  if (!points) return null;
  return (
    <div className={`near ${open ? 'open' : ''}`}>
      <button type="button" className="head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <I.Locate />{points.length ? `${points.length} near ${pinLabel(name)}` : 'Nothing reported near here'}
      </button>
      {open && (
        <div className="list" style={room ? { maxHeight: Math.max(140, room - 70) } : undefined}>
          {points.length ? points.map((p, i) => (
            <button key={i} type="button" onClick={() => { onPick(p); setOpen(false); }}>
              <i className={p.kind}>{p.kind === 'past' ? <I.History /> : p.kind === 'report' ? <I.Camera /> : <I.Drop />}</i>
              <span><b>{p.title}</b><small>{p.detail}</small></span>
              <em>{where(p)}</em>
            </button>
          )) : <p>No flood reports in the last 48 hours within 5 km, and none of the past floods in the time machine within 200 km.</p>}
        </div>
      )}
    </div>
  );
}
