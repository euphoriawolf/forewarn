// ?film&lat&lon: the place in 3D on the whole screen, with no buttons, playing its last flood while
// the camera turns slowly. Used to record the landing page video (tools/record-film.mjs).
import { useEffect, useRef, useState } from 'react';
import { Stage, type StageApi } from './Stage';
import type { Answer as A } from './types';

export function Film({ lat, lon }: { lat: number; lon: number }) {
  const [a, setA] = useState<A | null>(null);
  const stage = useRef<StageApi>(null);
  useEffect(() => { fetch(`/api/place?lat=${lat}&lon=${lon}`).then((r) => r.json() as Promise<A>).then(setA); }, [lat, lon]);
  // the recorder calls window.play() once the scene is in, so the film starts from dry streets
  useEffect(() => { (window as unknown as { play: () => void }).play = () => stage.current?.run({ action: 'play_last_flood', dist: 700, pitch: 0.55 }); }, []);
  useEffect(() => { if (a?.pack && !new URLSearchParams(location.search).has('wait')) stage.current?.run({ action: 'play_last_flood', dist: 700, pitch: 0.55 }); }, [a]);
  return <div className="film-page">{a?.pack && <Stage ref={stage} pack={a.pack} film />}</div>;
}
