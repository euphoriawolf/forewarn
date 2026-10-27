// The landing page, told as one story (design/story.html), with the search in the hero: search, pick
// a result, then drag the map so the pin sits on your door. One person's story moves readers more
// than numbers, and numbers in the same moment weaken it (Small, Loewenstein and Slovic, 2007), so
// the opening has none and each number comes later, on its own. Every number here has a source.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import * as I from './icons';
import type { Place } from './types';

// the satellite map (a large library) loads only when there is a pin to place
const Pin = lazy(() => import('./Pin').then((m) => ({ default: m.Pin })));

// The hero gallery: real floods in African cities, each shown no wider than it can hold sharply. The
// front photo changes every 6 seconds, the next one revealed by water rising up the frame; two cards
// float behind it with the photos to come. The Commons photos are linked from Wikimedia (free licences,
// credited below). public/hero-lagos.jpg is The Guardian Nigeria's, credited and linked, and kept out of
// the public repo (git-ignored); without the file the gallery starts at Kampala.
const W = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
const PHOTOS = [
  { src: '/hero-lagos.jpg', city: 'Lagos', where: 'Nigeria', credit: <>Lagos: <a href="https://guardian.ng/news/nigeria/metro/lagos-residents-lament-as-flooding-cripples-transport-businesses/">The Guardian Nigeria</a>.</> },
  { src: W + '5/59/Moment_of_a_life_saver_at_the_right_time.jpg/1280px-Moment_of_a_life_saver_at_the_right_time.jpg', city: 'Kampala', where: 'Uganda, 2018', credit: <>Kampala: <a href="https://commons.wikimedia.org/wiki/File:Moment_of_a_life_saver_at_the_right_time.jpg">Jameswasswa</a>, CC BY-SA 4.0.</> },
  { src: W + 'a/aa/Flooding_Accra_4.jpg/1280px-Flooding_Accra_4.jpg', city: 'Accra', where: 'Ghana, 2022', credit: <>Accra: <a href="https://commons.wikimedia.org/wiki/File:Flooding_Accra_4.jpg">Fquasie</a>, CC BY-SA 4.0.</> },
  { src: W + '5/55/Floods_in_Kibra_slums.jpg/1280px-Floods_in_Kibra_slums.jpg', city: 'Kibra, Nairobi', where: 'Kenya, 2026', credit: <>Kibra: <a href="https://commons.wikimedia.org/wiki/File:Floods_in_Kibra_slums.jpg">Queen Asali</a>, CC BY-SA 4.0.</> },
  { src: W + '8/8f/Maiduguri_flooding.jpg_07.jpg/1280px-Maiduguri_flooding.jpg_07.jpg', city: 'Maiduguri', where: 'Nigeria, 2024', credit: <>Maiduguri: <a href="https://commons.wikimedia.org/wiki/File:Maiduguri_flooding.jpg_07.jpg">Mr. Snatch</a>, CC0.</> },
  { src: W + '1/16/The_strong_and_brave_ones_will_always_try_to_pass_through.jpg/1280px-The_strong_and_brave_ones_will_always_try_to_pass_through.jpg', city: 'Kampala', where: 'Uganda, 2018', credit: <>Kampala street: <a href="https://commons.wikimedia.org/wiki/File:The_strong_and_brave_ones_will_always_try_to_pass_through.jpg">Jameswasswa</a>, CC BY-SA 4.0.</> },
];

function Gallery() {
  // start once we know whether the Lagos photo is there (it is git-ignored, so a fresh checkout has none)
  const [list, setList] = useState<typeof PHOTOS | null>(null);
  useEffect(() => {
    const im = new Image(), done = (ok: boolean) => setList((l) => l ?? (ok ? PHOTOS : PHOTOS.slice(1)));
    im.onload = () => done(true); im.onerror = () => done(false); im.src = PHOTOS[0].src;
    const t = setTimeout(() => done(false), 2500);
    return () => clearTimeout(t);
  }, []);
  const [k, setK] = useState(0);
  // each photo that has been shown stays under the next one, so the water reveals it over the last
  const [layers, setLayers] = useState<{ n: number; id: number }[]>([{ n: 0, id: 0 }]);
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => { for (const p of list ?? []) { const i = new Image(); i.src = p.src; } }, [list]); // load them all early
  useEffect(() => {
    if (!list) return;
    const t = setInterval(() => setK((x) => (x + 1) % list.length), 6000);
    return () => clearInterval(t);
  }, [list]);
  useEffect(() => { setLayers((l) => (l.at(-1)?.n === k ? l : [...l.slice(-1), { n: k, id: (l.at(-1)?.id ?? 0) + 1 }])); }, [k]);
  if (!list) return <div className="gallery" />;
  const at = (n: number) => list[n % list.length];
  const cur = at(k);
  return (
    <div className="gallery" aria-label="Photos of floods in African cities">
      <div className="card back1"><div className="img" style={{ backgroundImage: `url("${at(k + 1).src}")` }} /></div>
      <div className="card back2"><div className="img" style={{ backgroundImage: `url("${at(k + 2).src}")` }} /></div>
      <div className="card front">
        {layers.map((l, i) => <div key={l.id} className={`img ${i > 0 && !still ? 'in' : ''}`} style={{ backgroundImage: `url("${at(l.n).src}")` }} />)}
        {layers.length > 1 && !still && <div key={`line${layers.at(-1)!.id}`} className="line go" />}
        <div className="tag" key={`tag${k}`}>{cur.city}<span>{cur.where}</span></div>
      </div>
      <div className="dots">{list.map((_, i) => <i key={i === k ? `on${k}` : i} className={i === k ? 'on' : ''} />)}</div>
    </div>
  );
}

function Search({ onPick, id }: { onPick: (p: Place) => void; id?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Place[]>([]);
  const [error, setError] = useState('');
  // search as you type, after a short pause
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      try { setHits(await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json())); setError(''); }
      catch { setError('Search is not answering. Check your connection and try again.'); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => onPick({ name: 'Your location', where: '', lat: p.coords.latitude, lon: p.coords.longitude }),
    () => setError('Location is off. Search for your area instead.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
  return (
    <div className="find">
      <label className="lfield"><I.Search /><input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your area" aria-label="Find your area" /></label>
      {hits.length > 0 && (
        <div className="results">
          {hits.map((h, i) => <button key={i} type="button" onClick={() => onPick(h)}><b>{h.name}</b><small>{h.where}</small></button>)}
        </div>
      )}
      <button className="locate" type="button" onClick={locate}><I.Locate />Use my location</button>
      {error && <div className="error">{error}</div>}
      <small>Free. Anywhere in Africa. No account needed.</small>
    </div>
  );
}

export function Find({ onPlace }: { onPlace: (p: Place) => void }) {
  const [picked, setPicked] = useState<Place | null>(null);
  // the film plays only while it is on screen, and loads only when it comes near
  const film = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = film.current; if (!v) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause(); }, { rootMargin: '200px' });
    io.observe(v); return () => io.disconnect();
  }, [picked]);

  if (picked) return <Suspense fallback={<div className="screen"><div className="skeleton" style={{ flex: 1 }} /></div>}><Pin place={picked} onBack={() => setPicked(null)} onDone={onPlace} /></Suspense>;
  return (
    <div className="landing">
      <header className="hero"><div className="wrap">
        <div className="lbrand"><I.Logo />Forewarn</div>
        <div className="hero-grid">
          <div className="hero-text">
            <h1>For most people in Africa, the flood warning is the water itself.</h1>
            <p className="sub">Forewarn warns you days before a flood reaches your area: your street, your farm, your village.</p>
            <Search onPick={setPicked} id="find" />
          </div>
          <Gallery />
        </div>
      </div></header>

      <section className="night"><div className="wrap">
        <p className="wherewhen">Mathare, Nairobi. The night of Tuesday 23 April 2024.</p>
        <p className="shout">“Maji! Maji!”<small>Water! Water!</small></p>
        <p className="tell">People woke in the middle of the night to their neighbours shouting. The river that runs through the valley was already rising into their homes.</p>
        <p className="tell">That shout was the warning.</p>
      </div></section>

      <section><div className="wrap weeks">
        <div>
          <h2>The rain had been coming for a month.</h2>
          <p className="lead">In the 30 days before that night, Nairobi got 340 mm of rain. A normal year brings 161 mm. The ground was full, so the next rain went straight into the river.</p>
        </div>
        <figure className="barfig">
          <div className="bars" role="img" aria-label="Rain in the 30 days before 23 April: 340 mm in 2024, against a normal of 161 mm">
            <div className="now"><strong>340 mm</strong><b style={{ height: 200 }} /><span>April 2024</span></div>
            <div><strong>161 mm</strong><b style={{ height: 95 }} /><span>A normal year</span></div>
          </div>
          <figcaption>Only 1 year from 1991 to 2020 was wetter. CHIRPS rain records.</figcaption>
        </figure>
      </div></section>

      <section className="film"><div className="wrap">
        <h2>Nairobi's Industrial Area, filling up hour by hour.</h2>
        <video ref={film} src="/og-video.mp4" poster="/flood-poster.jpg" muted loop playsInline preload="none" aria-label="3D flood model: water rises over a Nairobi neighbourhood" />
        <p className="filmnote">The March 2026 storm, from the Flood Check model. Blue is water. Amber is a building with water at the door. Water is drawn 4 times deeper so it shows from above.</p>
      </div></section>

      <section className="gap"><div className="wrap">
        <h2>It happens all over Africa.</h2>
        <div className="nums">
          <div className="num"><b>Over half</b><p>of the people in Africa have no early warning system to tell them a flood is coming.</p><cite>WMO: 40% of Africans were covered in 2023, the lowest of any region. About 45% in 2024.</cite></div>
          <div className="num"><b>24 hours</b><p>of notice can cut the damage from a flood or storm by up to 30%.</p><cite>WMO, Early Warnings for All Action Plan for Africa.</cite></div>
        </div>
      </div></section>

      <section className="runs"><div className="wrap">
        <h2>How Forewarn warns you</h2>
        <p className="lead">Meta's Muse Spark and SAM models, and three public data sources. Code works out every number.</p>
        <div className="feats">
          <article className="feat wide">
            <div>
              <span className="model meta">Meta Muse Spark Open</span>
              <h3>Ask in plain words</h3>
              <p>It reads the data for your area, moves the map to show you, and every number it says is checked first.</p>
            </div>
            <figure className="phone mini">
              <div className="msg"><div className="psteps"><div>Read 51 forecasts for the next 14 days</div><div>Read the last 30 days of rain</div></div>
              <p><b>Flooding looks unlikely in Kibera for the next 14 days.</b> The ground is not soaked: the last 30 days brought 46 mm, close to the normal 43 mm for this time of year.</p></div>
            </figure>
          </article>
          <article className="feat wide">
            <div>
              <span className="model meta">Meta SAM 3.1 and Muse Spark</span>
              <h3>Send a photo of the water</h3>
              <p>SAM marks the water and the people. Muse Spark tells you what the water reaches and what to do. People are pixelated, so nobody can be recognised.</p>
            </div>
            <img className="wit" src="/witness-lagos.jpg" alt="A flooded Lagos street: the water marked in blue, the people pixelated" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </article>
          <article className="feat">
            <div className="viz dots51" role="img" aria-label="3 of 51 forecasts lit">{Array.from({ length: 51 }, (_, i) => <i key={i} className={i < 3 ? 'on' : ''} />)}<b>about 1 in 20</b></div>
            <span className="model">ECMWF forecast</span>
            <h3>14 days ahead</h3>
            <p>51 versions of the European forecast for your spot, counted for you.</p>
          </article>
          <article className="feat">
            <div className="viz minibars" role="img" aria-label="Last 30 days 46 mm, normal 43 mm"><div><b style={{ width: '92%' }} /><span>Last 30 days, 46 mm</span></div><div><b className="n" style={{ width: '86%' }} /><span>Normal, 43 mm</span></div></div>
            <span className="model">CHIRPS rain records</span>
            <h3>How wet the ground is</h3>
            <p>The last month against 30 years of records. On a farm, a low number means a dry season.</p>
          </article>
          <article className="feat">
            <div className="viz still" style={{ backgroundImage: 'url(/flood-poster.jpg)' }} role="img" aria-label="Floodwater in a 3D model of Nairobi" />
            <span className="model">Flood Check model</span>
            <h3>The last flood in 3D</h3>
            <p>Lagos and Nairobi, street by street, with the water at each door.</p>
          </article>
        </div>
      </div></section>

      <section className="trust"><div className="wrap">
        <h2>Every number has a source</h2>
        <div className="icons">
          <div><I.Shield /><p>A checker compares each number the agent says with the data.</p></div>
          <div><I.History /><p>We're testing it on 36 past African floods, and we'll show the misses too.</p></div>
          <div><I.Blur /><p>People in photos are pixelated before anyone sees them.</p></div>
          <div><I.Flag /><p>If your local officials say leave, leave.</p></div>
        </div>
      </div></section>

      <section className="closing"><div className="wrap">
        <h2>Check your area before the next rains.</h2>
        <button className="cta" type="button" onClick={() => { const f = document.getElementById('find'); f?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f?.focus(), 500); }}><I.Search />Find your area</button>
      </div></section>

      <footer><div className="wrap">
        <p>Sources: <a href="https://www.aljazeera.com/news/2024/5/1/blame-the-government-kenyans-bemoan-lack-of-support-amid-record-flooding">Al Jazeera, 1 May 2024</a> (Mathare, the night of 23 April). <a href="https://wmo.int/news/media-centre/early-warnings-all-action-plan-africa-launched">WMO, Early Warnings for All Action Plan for Africa, 2023</a>. <a href="https://news.un.org/en/story/2025/10/1166151">UN News, October 2025</a>. WMO at the EUMETSAT user forum, 2024 (about 45%).</p>
        <p>Photos at the top: {PHOTOS.map((p, i) => <span key={i}>{p.credit} </span>)}</p>
        <p>Data: CHIRPS daily rain (Climate Hazards Center, UC Santa Barbara), 1991 to 2024. ECMWF forecasts through Open-Meteo. Street water from Flood Check, a model estimate. Imagery: Esri, EOX Sentinel-2.</p>
      </div></footer>
    </div>
  );
}
