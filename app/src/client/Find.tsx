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
          <h2>The water came at night. The rain had been coming for a month.</h2>
          <p className="lead">In the 30 days before that night, Nairobi had more than twice its normal rain. The ground was full. New rain had nowhere to go but the river.</p>
          <p className="lead">From 1991 to 2020, only one year was wetter at that time of year. The signs were in the data for weeks. They did not reach the people in the valley.</p>
        </div>
        <div className="bars" role="img" aria-label="Rain in the 30 days before 23 April: 340 mm in 2024, against a normal of 161 mm">
          <div className="now"><strong>340 mm</strong><b style={{ height: 200 }} /><span>2024</span></div>
          <div><strong>161 mm</strong><b style={{ height: 95 }} /><span>A normal year</span></div>
        </div>
      </div></section>

      <section className="film"><div className="wrap">
        <h2>Watch a flood fill a neighbourhood, hour by hour.</h2>
        <p className="lead">This is the March 2026 storm in Nairobi’s Industrial Area, by the Ngong River, from a flood model. Blue is water. Amber marks buildings with water at the door.</p>
        <video ref={film} src="/og-video.mp4" poster="/flood-poster.jpg" muted loop playsInline preload="none" aria-label="3D flood model: water rises over a Nairobi neighbourhood" />
        <p className="filmnote">Model estimate from Flood Check, drawn 4 times deeper than real so shallow water shows from above.</p>
      </div></section>

      <section className="gap"><div className="wrap">
        <h2>This is not one city’s story.</h2>
        <div className="nums">
          <div className="num"><b>Over half</b><p>of the people in Africa have no early warning system to tell them a flood is coming.</p><cite>WMO: 40% of Africans were covered in 2023, the lowest of any region. About 45% in 2024.</cite></div>
          <div className="num"><b>24 hours</b><p>of notice can cut the damage from a flood or storm by up to 30%.</p><cite>WMO, Early Warnings for All Action Plan for Africa.</cite></div>
        </div>
      </div></section>

      <section><div className="wrap">
        <div>
          <h2>A disaster warning for every area, not only every country.</h2>
          <p className="lead">Forecasts and warnings exist. Most go to governments and cover whole regions. Forewarn starts at the other end: the area where you live, down to your own street.</p>
        </div>
      </div></section>

      <section className="runs"><div className="wrap">
        <h2>What Forewarn does, and what runs it</h2>
        <p className="lead">Each part is built on public data or an open model you can check. Meta’s models do the reading and the seeing; code does the maths.</p>
        <div className="feats">
          <article className="feat wide">
            <div>
              <span className="model meta">Meta Muse Spark Open</span>
              <h3>An agent you can ask</h3>
              <p>Ask about your area in plain words. The agent reads the forecasts and the rain, moves the 3D map to show you, and answers in a few short sentences. A checker compares every number in its answer with the data before you see it.</p>
              <p className="how">Runs on Baseten, with the Cloudflare Agents SDK and the Vercel AI SDK.</p>
            </div>
            <figure className="phone mini">
              <div className="msg"><div className="psteps"><div>Read 51 forecasts for the next 14 days</div><div>Read the last 30 days of rain</div></div>
              <p><b>Flooding looks unlikely in Kibera for the next 14 days.</b> The ground is not soaked: the last 30 days brought 46 mm, close to the normal 43 mm for this time of year.</p></div>
            </figure>
          </article>
          <article className="feat wide">
            <div>
              <span className="model meta">Meta SAM 3.1</span>
              <h3>Witness: your photo, read for water</h3>
              <p>Add a photo of a flood where you are. Segment Anything finds the floodwater and marks it in blue, and finds every person in the frame so the page can pixelate them. Nobody in a report can be recognised.</p>
              <p className="how">One photo takes about 3 seconds.</p>
            </div>
            <img className="wit" src="/witness-lagos.jpg" alt="A flooded Lagos street: the water marked in blue, the people pixelated" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </article>
          <article className="feat">
            <span className="model">ECMWF ensemble</span>
            <h3>The next 14 days</h3>
            <p>51 runs of the European forecast, blended for your spot from the four nearest 28 km squares. The chance comes out in words, like “about 1 in 4”.</p>
          </article>
          <article className="feat">
            <span className="model">CHIRPS, 1991 to 2020</span>
            <h3>How wet the ground is</h3>
            <p>The last 30 days of rain against 30 years of normal for the time of year. Soaked ground floods sooner; on a farm, a low number shows a dry season.</p>
          </article>
          <article className="feat">
            <span className="model">Flood Check model</span>
            <h3>Your street in 3D</h3>
            <p>In Lagos and Nairobi, the last big storm comes back hour by hour: real buildings, trees and roads, and the water the model shows at each door.</p>
          </article>
        </div>
      </div></section>

      <section className="trust"><div className="wrap">
        <h2>Built to be trusted</h2>
        <div className="cards">
          <div><b>Every number is real</b><p>Code computes each chance, depth and date from public data. The agent explains them, and a checker compares every number with the data before you see it.</p></div>
          <div><b>Tested on past disasters</b><p>We run Forewarn on 36 floods across Africa from 2024 to 2026 and publish what it would have said, hits and misses side by side.</p></div>
          <div><b>Works with official warnings</b><p>Forewarn adds detail for your area. If your local authorities tell you to move, follow them.</p></div>
          <div><b>Growing city by city</b><p>Forecasts and rain readings cover all of Africa today. Street-level 3D covers Lagos and Nairobi, with more cities next.</p></div>
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
