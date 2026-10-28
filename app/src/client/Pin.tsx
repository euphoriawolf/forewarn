// Put the pin on your door: a sharp satellite map you drag under a fixed pin.
import { useEffect, useRef } from 'react';
import { pinLabel, type Place } from './types';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// Vite moves MapLibre's files, so tell it where its background worker is.
maplibregl.setWorkerUrl(workerUrl);

// Esri World Imagery: sharp enough to find your own roof (about 0.5 m in Lagos and Nairobi).
// Free for non-commercial use with the credit shown; a paid launch needs an Esri account or
// another source. (Sentinel-2 from EOX, used in the 3D, is 10 m: too soft for placing a pin.)
const SATELLITE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { img: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
  layers: [{ id: 'img', type: 'raster', source: 'img' }],
};

export function Pin({ place, onBack, onDone }: { place: Place; onBack: () => void; onDone: (p: Place) => void }) {
  const box = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null);
  useEffect(() => {
    map.current = new maplibregl.Map({ container: box.current!, style: SATELLITE, center: [place.lon, place.lat], zoom: 16.5, maxZoom: 19, attributionControl: { compact: true } });
    return () => map.current?.remove();
  }, [place]);
  const done = () => { const c = map.current!.getCenter(); onDone({ ...place, lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5) }); };
  return (
    <div className="screen">
      <div className="top"><div><b>{place.name}</b><small>{place.where}</small></div><button className="chip" type="button" onClick={onBack}>Change</button></div>
      <div className="map"><div className="ml" ref={box} /><div className="pin"><i>{pinLabel(place.name)}</i></div><div className="hint">Drag the map to put the pin on your door</div></div>
      <button className="btn dark" type="button" onClick={done}>This is my place</button>
    </div>
  );
}
