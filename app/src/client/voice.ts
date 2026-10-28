// Voice in: record from the microphone as raw samples, make a 16 kHz mono WAV (the format Meta's
// transcribe endpoint takes, and every browser can make it, unlike MediaRecorder's formats), send it
// to /api/voice and get the words back. Nothing is kept on the server.
export interface Recording { stop: () => Promise<Blob>; cancel: () => void }

const RATE = 16000;

export async function record(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but works in every browser, older iPhones too, without a worklet file
  const node = ctx.createScriptProcessor(4096, 1, 1), parts: Float32Array[] = [];
  node.onaudioprocess = (e) => parts.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(node); node.connect(ctx.destination);
  const close = () => { node.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close(); };
  return {
    cancel: close,
    stop: async () => { const rate = ctx.sampleRate; close(); return wav(down(join(parts), rate)); },
  };
}

export async function transcribe(audio: Blob): Promise<string> {
  const r = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio });
  const d = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!r.ok || d.error) throw new Error(d.error ?? 'The voice check failed. Type your question instead.');
  return d.text ?? '';
}

// for tests: the WAV the page would send for these samples
export const toWav = (x: Float32Array, rate: number) => wav(down(x, rate));

const join = (parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// average the samples that fall in each 16 kHz step (a simple low-pass, enough for speech)
function down(x: Float32Array, rate: number) {
  if (rate === RATE) return x;
  const step = rate / RATE, out = new Float32Array(Math.floor(x.length / step));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * step), b = Math.min(x.length, Math.floor((i + 1) * step));
    let s = 0; for (let k = a; k < b; k++) s += x[k];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function wav(x: Float32Array) {
  const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}
