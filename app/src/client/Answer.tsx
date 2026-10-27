// A place: the map and the agent, nothing else. The map stays still and the chat scrolls beside it
// (under it on a phone). The agent opens with the answer; the buttons on the map run the same 3D
// actions as its tools and put one line in the chat. /api/place gives the 3D tiles and the nearest
// spot that flooded, computed in code.
import { useEffect, useRef, useState } from 'react';
import { lazy, Suspense } from 'react';
import type { StageApi } from './Stage';
// the 3D engine is large: it loads on its own, so a slow phone gets the chat first
const Stage = lazy(() => import('./Stage').then((m) => ({ default: m.Stage })));
// the chat library is large too
const Chat = lazy(() => import('./Chat').then((m) => ({ default: m.Chat })));
import { Safe } from './Safe';
import type { Answer as A, Place } from './types';

export function Answer({ place, onChange }: { place: Place; onChange: () => void }) {
  const [a, setA] = useState<A | null>(null);
  const [error, setError] = useState('');
  const stage = useRef<StageApi>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const act = (x: Record<string, unknown>) => stage.current?.run(x);
  // ?replay in the address plays the last flood straight away (for demos and recordings)
  useEffect(() => { if (a?.pack && new URLSearchParams(location.search).has('replay')) stage.current?.run({ action: 'play_last_flood' }); }, [a]);
  useEffect(() => {
    setA(null); setError(''); setNotes([]);
    fetch(`/api/place?lat=${place.lat}&lon=${place.lon}`).then((r) => r.json() as Promise<A>).then((d) => (d.error ? setError(d.error) : setA(d))).catch(() => setError('The forecast is not answering. Check your connection and try again.'));
  }, [place]);
  return (
    <div className="place">
      <div className="top"><div><b>{place.name}</b><small>{place.where || 'Your place'}</small></div><button className="chip" type="button" onClick={onChange}>Change</button></div>
      <div className="mapbox">
        {!a && !error && <div className="stage"><div className="load"><span>Loading your place</span></div></div>}
        {error && <div className="stage none"><p>{error}</p></div>}
        {a && !a.pack && <div className="stage none"><p>Street-level 3D covers Lagos and Nairobi for now. The agent can still read the forecast for your place.</p></div>}
        {a?.pack && <Safe note="The 3D view could not load on this connection. The chat still works."><Suspense fallback={<div className="stage"><div className="load"><span>Loading the 3D</span></div></div>}><Stage ref={stage} pack={a.pack} nearby={a.nearby} onNote={(t) => setNotes((n) => [...n, t])} /></Suspense></Safe>}
      </div>
      <Safe note="The chat could not connect. Check your connection and reload the page."><Suspense fallback={<div className="talk" />}><Chat place={place} onAction={act} notes={notes} logging={a?.logging ?? false} /></Suspense></Safe>
    </div>
  );
}
