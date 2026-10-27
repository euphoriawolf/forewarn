// What a phone photo says about itself (its EXIF): when it was taken and, if the phone kept it, where.
// Read from the original file, before the page shrinks it (shrinking drops all of this). Many phones
// strip the location when a photo goes to a website, so every field may be missing.
export interface PhotoFacts { takenAt?: string; lat?: number; lon?: number }

export async function photoFacts(file: File): Promise<PhotoFacts> {
  try {
    const b = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (b.getUint16(0) !== 0xffd8) return {}; // JPEG only (iPhones send HEIC photos to websites as JPEG)
    for (let o = 2; o + 4 < b.byteLength;) {
      const marker = b.getUint16(o), size = b.getUint16(o + 2);
      if (marker === 0xffe1 && b.getUint32(o + 4) === 0x45786966) return readTiff(b, o + 10); // "Exif"
      if ((marker & 0xff00) !== 0xff00) break;
      o += 2 + size;
    }
  } catch { /* a file we cannot read says nothing */ }
  return {};
}

function readTiff(b: DataView, t: number): PhotoFacts {
  const le = b.getUint16(t) === 0x4949, u16 = (o: number) => b.getUint16(o, le), u32 = (o: number) => b.getUint32(o, le);
  const entries = (dir: number) => Array.from({ length: u16(t + dir) }, (_, i) => t + dir + 2 + i * 12);
  const find = (dir: number, tag: number) => entries(dir).find((e) => u16(e) === tag);
  const ascii = (e: number) => { const n = u32(e + 4), at = n > 4 ? t + u32(e + 8) : e + 8; return String.fromCharCode(...Array.from({ length: n - 1 }, (_, i) => b.getUint8(at + i))); };
  const rationals = (e: number) => { const at = t + u32(e + 8); return [0, 1, 2].map((i) => u32(at + i * 8) / (u32(at + i * 8 + 4) || 1)); };
  const out: PhotoFacts = {};
  const ifd0 = u32(t + 4);
  // the date it was taken, "2026:10:27 14:05:33", in the camera's own clock (no time zone)
  const exifPtr = find(ifd0, 0x8769);
  const dt = exifPtr !== undefined ? find(u32(exifPtr + 8), 0x9003) : undefined;
  if (dt !== undefined) { const m = ascii(dt).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/); if (m) out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`; }
  // the place, if the phone kept it
  const gpsPtr = find(ifd0, 0x8825);
  if (gpsPtr !== undefined) {
    const g = u32(gpsPtr + 8), latRef = find(g, 1), lat = find(g, 2), lonRef = find(g, 3), lon = find(g, 4);
    if (lat !== undefined && lon !== undefined) {
      const deg = (e: number) => { const [d, m, s] = rationals(e); return d + m / 60 + s / 3600; };
      const la = deg(lat) * (latRef !== undefined && ascii(latRef) === 'S' ? -1 : 1), lo = deg(lon) * (lonRef !== undefined && ascii(lonRef) === 'W' ? -1 : 1);
      if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) { out.lat = +la.toFixed(5); out.lon = +lo.toFixed(5); }
    }
  }
  return out;
}
