// Share a warning the way people already pass news on: WhatsApp text, an image card, or a voice note in
// Swahili, Yoruba or Hausa (Meta's MMS voices, /api/speak). One chief, teacher or imam can warn a street.
// The person sends everything from their own phone, and sees the words of a voice note first.
import { useState } from 'react';
import { guessLang } from './lang';
import type { Place } from './types';

const LANGS: [string, string][] = [['sw', 'Swahili'], ['yo', 'Yoruba'], ['ha', 'Hausa']];

// the phone's share sheet when it takes files, a download when it does not
async function giveFile(blob: Blob, name: string, title: string) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// a square card for WhatsApp: the place, the message, where to check
async function card(place: Place, message: string): Promise<Blob> {
  const S = 1080, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!, pad = 84, display = "'Bricolage Grotesque Variable', system-ui, sans-serif", body = "'Public Sans', system-ui, sans-serif";
  g.fillStyle = '#16201b'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#1d4ed8'; g.fillRect(0, S - 28, S, 28);
  g.fillStyle = '#e3eafc'; g.font = `800 40px ${display}`; g.fillText('Forewarn', pad, 124);
  g.fillStyle = '#ffffff'; g.font = `800 76px ${display}`; g.fillText(place.name.slice(0, 22), pad, 240);
  // the biggest text size that fits the message above the footer
  const wrap = (size: number) => {
    g.font = `500 ${size}px ${body}`; const lines: string[] = []; let line = '';
    for (const w of message.replace(/\s+/g, ' ').split(' ')) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > S - pad * 2 && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  let size = 52, lines = wrap(size);
  while (lines.length * size * 1.34 > 620 && size > 26) { size -= 2; lines = wrap(size); }
  g.fillStyle = '#eef1ec'; lines.forEach((l, i) => g.fillText(l, pad, 330 + i * size * 1.34));
  g.fillStyle = '#a9b3ad'; g.font = `500 32px ${body}`; g.fillText('Check your area: forewarn.dawnstackai.com', pad, S - 76);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('The card did not draw.'))), 'image/png'));
}

export function ShareTools({ message, link, place }: { message: string; link: string; place: Place }) {
  const [busy, setBusy] = useState(''), [said, setSaid] = useState(''), [error, setError] = useState('');
  const voice = async (lang: string, name: string) => {
    setBusy(lang); setError(''); setSaid('');
    try {
      const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, text: message, translate: guessLang(message) !== lang }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'The voice note did not load.');
      setSaid(decodeURIComponent(r.headers.get('X-Said') ?? ''));
      await giveFile(await r.blob(), `forewarn-${place.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${lang}.wav`, `Flood warning for ${place.name}, ${name}`);
    } catch (e) { setError(`${e instanceof Error ? e.message : 'The voice note did not load.'} Try again in a moment.`); }
    setBusy('');
  };
  const image = async () => {
    setBusy('card'); setError('');
    try { await document.fonts?.ready; await giveFile(await card(place, message), 'forewarn-warning.png', `Flood warning for ${place.name}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'The card did not draw.'); }
    setBusy('');
  };
  return (
    <div className="sharetools">
      <div>
        <a className="report wa" href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noopener">Send on WhatsApp</a>
        <button type="button" className="report" disabled={!!busy} onClick={image}>{busy === 'card' ? 'Drawing' : 'Image card'}</button>
      </div>
      <small>Voice note</small>
      <div>{LANGS.map(([k, name]) => <button key={k} type="button" className="chip" disabled={!!busy} onClick={() => voice(k, name)}>{busy === k ? 'Making it' : name}</button>)}</div>
      {said && <small><b>The voice note says:</b> {said}<br />Check the words before you share it.</small>}
      {error && <small className="err">{error}</small>}
    </div>
  );
}
