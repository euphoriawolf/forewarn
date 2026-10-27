// Two screens: find your place, then its answer. The place is kept in the address (?lat&lon&name),
// so a link to an answer can be shared.
import { useState } from 'react';
import { lazy, Suspense } from 'react';
// the map library is large: load it only on the find screen
const Find = lazy(() => import('./Find').then((m) => ({ default: m.Find })));
import { Answer } from './Answer';
const Film = lazy(() => import('./Film').then((m) => ({ default: m.Film })));
import type { Place } from './types';

function fromUrl(): Place | null {
  const q = new URLSearchParams(location.search), lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  return q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) ? { name: q.get('name') ?? 'Your place', where: q.get('where') ?? '', lat, lon } : null;
}

export function App() {
  const [place, setPlace] = useState<Place | null>(fromUrl);
  const go = (p: Place | null) => {
    setPlace(p);
    history.pushState(null, '', p ? `?${new URLSearchParams({ lat: String(p.lat), lon: String(p.lon), name: p.name, where: p.where })}` : '/');
  };
  if (place && new URLSearchParams(location.search).has('film')) return <Suspense fallback={null}><Film lat={place.lat} lon={place.lon} /></Suspense>;
  return place ? <Answer place={place} onChange={() => go(null)} /> : <Suspense fallback={null}><Find onPlace={go} /></Suspense>;
}
