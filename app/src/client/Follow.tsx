// "Get flood alerts": the person gives an email for this area. The first email holds a link to
// confirm; nothing else is sent before that. Every alert after it is read by a person first.
import { useState } from 'react';
import type { Place } from './types';

const SAID: Record<string, string> = {
  sent: 'Check your inbox. Open the link in the email from Forewarn to start the alerts.',
  already: 'This address already gets alerts for this area.',
  wait: 'We sent you a link a short time ago. Open it from your inbox, or try again in an hour.',
};

export function Follow({ place, onDone }: { place: Place; onDone: (text: string) => void }) {
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError('');
    const r = await fetch('/api/follow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, lat: place.lat, lon: place.lon, name: place.name, where: place.where }) })
      .then((x) => x.json() as Promise<{ status?: string; error?: string }>).catch(() => ({ status: undefined, error: 'The form did not send. Check your connection and try again.' }));
    setBusy(false);
    if (r.status) onDone(SAID[r.status] ?? SAID.sent); else setError(r.error ?? 'Something went wrong. Try again.');
  };
  return (
    <form className="where follow" onSubmit={(e) => { e.preventDefault(); if (!busy) send(); }}>
      <small>Forewarn checks the forecast here every 6 hours. When a flood looks possible in the next 7 days, a person reads the alert, then it comes to you. At most 2 a day, and a stop link in every email.</small>
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" aria-label="Your email" autoComplete="email" />
      {error && <small className="err">{error}</small>}
      <button type="submit" className="report" disabled={busy}>{busy ? 'Sending' : 'Send me the link'}</button>
    </form>
  );
}
