// "Where is this water?" Before a flood report is sent, the person says where the photo was taken: the
// place they are looking at, where they are now (GPS, named by /api/where), or another place they search.
import { useEffect, useState } from 'react';
import type { Place } from './types';

export interface Spot { lat: number; lon: number; label: string }
const label = (p: { name: string; where: string }) => [p.name, p.where].filter(Boolean).join(', ');

export function ReportPlace({ here, onSend }: { here: Place; onSend: (s: Spot) => void }) {
  const [pick, setPick] = useState<'here' | 'gps' | 'other'>('here');
  const [gps, setGps] = useState<Spot | null>(null);
  const [gpsNote, setGpsNote] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Place[]>([]);
  const [other, setOther] = useState<Spot | null>(null);

  const useGps = () => {
    setPick('gps'); if (gps) return;
    setGpsNote('Finding where you are');
    navigator.geolocation?.getCurrentPosition(async (p) => {
      const lat = p.coords.latitude, lon = p.coords.longitude;
      const n = await fetch(`/api/where?lat=${lat}&lon=${lon}`).then((r) => r.json() as Promise<{ name: string; where: string }>).catch(() => null);
      setGps({ lat, lon, label: n ? label(n) : 'Where you are now' }); setGpsNote('');
    }, () => setGpsNote('Location is off. Pick another option.'), { enableHighAccuracy: true, timeout: 10000 });
  };
  // search as you type, after a short pause
  useEffect(() => {
    if (pick !== 'other' || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json() as Promise<Place[]>).then(setHits).catch(() => setHits([])), 300);
    return () => clearTimeout(t);
  }, [q, pick]);

  const chosen: Spot | null = pick === 'here' ? { lat: here.lat, lon: here.lon, label: label(here) } : pick === 'gps' ? gps : other;
  return (
    <div className="where">
      <b>Where is this water?</b>
      <label><input type="radio" name="where" checked={pick === 'here'} onChange={() => setPick('here')} /><span>{label(here)}<small>The place on your map</small></span></label>
      <label><input type="radio" name="where" checked={pick === 'gps'} onChange={useGps} /><span>Where I am now<small>{gpsNote || (gps ? gps.label : 'Uses your phone’s location')}</small></span></label>
      <label><input type="radio" name="where" checked={pick === 'other'} onChange={() => setPick('other')} /><span>Somewhere else<small>{other ? other.label : 'Search for the place'}</small></span></label>
      {pick === 'other' && (
        <div className="where-find">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Street, area or village" aria-label="Where the water is" />
          {hits.length > 0 && <div className="results">{hits.map((h, i) => <button key={i} type="button" onClick={() => { setOther({ lat: h.lat, lon: h.lon, label: label(h) }); setHits([]); setQ(h.name); }}><b>{h.name}</b><small>{h.where}</small></button>)}</div>}
        </div>
      )}
      <button type="button" className="report" disabled={!chosen} onClick={() => chosen && onSend(chosen)}>Send report</button>
    </div>
  );
}
