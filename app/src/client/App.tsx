// Two screens: find your place, then its answer. The place is kept in the address (?lat&lon&name),
// so a link to an answer can be shared.
import { useEffect, useState } from 'react';
import { lazy, Suspense } from 'react';
// the map library is large: load it only on the find screen
const Find = lazy(() => import('./Find').then((m) => ({ default: m.Find })));
import { Answer } from './Answer';
const Film = lazy(() => import('./Film').then((m) => ({ default: m.Film })));
const Past = lazy(() => import('./Past').then((m) => ({ default: m.Past })));
import type { Place } from './types';

function fromUrl(): Place | null {
  const q = new URLSearchParams(location.search), lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  return q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) ? { name: q.get('name') ?? 'Your place', where: q.get('where') ?? '', lat, lon } : null;
}

// the time machine: ?past for the list, ?past=<n> for one flood
const pastFromUrl = () => { const q = new URLSearchParams(location.search); return q.has('past') ? (q.get('past') ? Number(q.get('past')) : null) : undefined; };

export function App() {
  const [place, setPlace] = useState<Place | null>(fromUrl);
  const [past, setPast] = useState<number | null | undefined>(pastFromUrl);
  useEffect(() => { const back = () => { setPlace(fromUrl()); setPast(pastFromUrl()); }; addEventListener('popstate', back); return () => removeEventListener('popstate', back); }, []);
  const pick = (id: number | null) => { setPast(id); history.pushState(null, '', id === null ? '?past' : `?past=${id}`); };
  const go = (p: Place | null) => {
    setPlace(p);
    history.pushState(null, '', p ? `?${new URLSearchParams({ lat: String(p.lat), lon: String(p.lon), name: p.name, where: p.where })}` : '/');
  };
  // the time machine has its own title and address for search engines and shares
  useEffect(() => {
    const canon = document.querySelector('link[rel=canonical]');
    document.title = past === undefined ? 'Forewarn: flood and disaster early warning for your area in Africa' : 'The time machine: 36 past African floods replayed | Forewarn';
    canon?.setAttribute('href', `https://forewarn.dawnstackai.com/${past === undefined ? '' : past === null ? '?past' : `?past=${past}`}`);
  }, [past]);
  if (past !== undefined) return <Suspense fallback={null}><Past id={past} onPick={pick} onHome={() => { setPast(undefined); go(null); }} /></Suspense>;
  if (place && new URLSearchParams(location.search).has('film')) return <Suspense fallback={null}><Film lat={place.lat} lon={place.lon} /></Suspense>;
  return place ? <Answer place={place} onChange={() => go(null)} /> : <Suspense fallback={null}><Find onPlace={go} /></Suspense>;
}
