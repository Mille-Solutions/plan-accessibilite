// Lecture / nettoyage minimal des métadonnées EXIF d'un JPEG, sans dépendance.
// Utilisé par scripts/import-photos.mjs (les HEIC sont d'abord convertis en JPEG par sips).

const GPS_IFD = 0x8825;
const EXIF_IFD = 0x8769;
const ORIENTATION = 0x0112;
const DATETIME_ORIGINAL = 0x9003;

/** Segments d'un JPEG jusqu'au début des données d'image : [{ marker, start, end, data }]. */
function segments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('pas un JPEG');
  const out = [];
  let i = 2;
  while (i < buf.length - 3) {
    if (buf[i] !== 0xff) throw new Error(`JPEG invalide à l'octet ${i}`);
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // octet de remplissage
    if (marker === 0xda || marker === 0xd9) { out.push({ marker, start: i, end: buf.length, sos: true }); break; }
    const len = buf.readUInt16BE(i + 2);
    out.push({ marker, start: i, end: i + 2 + len, data: buf.subarray(i + 4, i + 2 + len) });
    i += 2 + len;
  }
  return out;
}

function readIfd(tiff, offset, le) {
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const count = u16(offset);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    const e = offset + 2 + k * 12;
    const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
    const valOff = size * n > 4 ? u32(e + 8) : e + 8;
    let value;
    if (type === 2) value = tiff.toString('latin1', valOff, valOff + n).replace(/\0+$/, '');
    else if (type === 3) value = n === 1 ? u16(valOff) : Array.from({ length: n }, (_, j) => u16(valOff + 2 * j));
    else if (type === 4) value = n === 1 ? u32(valOff) : Array.from({ length: n }, (_, j) => u32(valOff + 4 * j));
    else if (type === 5) value = Array.from({ length: n }, (_, j) => u32(valOff + 8 * j) / (u32(valOff + 8 * j + 4) || 1));
    else value = tiff.subarray(valOff, valOff + size * n);
    entries.set(tag, value);
  }
  return entries;
}

/** { lat, lon, orientation, date } (champs absents → null). */
export function readExif(buf) {
  const app1 = segments(buf).find((s) => s.marker === 0xe1 && s.data && s.data.toString('latin1', 0, 6) === 'Exif\0\0');
  if (!app1) return { lat: null, lon: null, orientation: 1, date: null };
  const tiff = app1.data.subarray(6);
  const le = tiff.toString('latin1', 0, 2) === 'II';
  const ifd0Off = le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  const ifd0 = readIfd(tiff, ifd0Off, le);
  let lat = null, lon = null, date = null;
  if (ifd0.has(GPS_IFD)) {
    const gps = readIfd(tiff, ifd0.get(GPS_IFD), le);
    const dms = (v) => (Array.isArray(v) ? v[0] + v[1] / 60 + v[2] / 3600 : null);
    if (gps.has(2) && gps.has(4)) {
      lat = dms(gps.get(2)) * (gps.get(1) === 'S' ? -1 : 1);
      lon = dms(gps.get(4)) * (gps.get(3) === 'W' ? -1 : 1);
      if (!lat && !lon) lat = lon = null; // 0,0 = pas de position
    }
  }
  if (ifd0.has(EXIF_IFD)) {
    const exif = readIfd(tiff, ifd0.get(EXIF_IFD), le);
    if (exif.has(DATETIME_ORIGINAL)) date = exif.get(DATETIME_ORIGINAL);
  }
  return { lat, lon, orientation: ifd0.get(ORIENTATION) || 1, date };
}

/**
 * Retire toutes les métadonnées (EXIF dont la position GPS, XMP, IPTC, commentaires)
 * en gardant le profil de couleur ICC, indispensable aux photos d'iPhone (Display P3).
 */
export function stripMetadata(buf) {
  const parts = [buf.subarray(0, 2)];
  for (const s of segments(buf)) {
    const isIcc = s.marker === 0xe2 && s.data && s.data.toString('latin1', 0, 11) === 'ICC_PROFILE';
    const isApp = s.marker >= 0xe1 && s.marker <= 0xef;
    if ((isApp && !isIcc) || s.marker === 0xfe) continue;
    parts.push(buf.subarray(s.start, s.end));
  }
  return Buffer.concat(parts);
}

/** Construit un segment APP1 EXIF (utilisé par les tests pour fabriquer des photos d'essai). */
export function buildExifSegment({ lat, lon, orientation = 1 }) {
  const t = Buffer.alloc(200);
  t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  // IFD0 : Orientation + pointeur GPS
  t.writeUInt16LE(2, 8);
  t.writeUInt16LE(ORIENTATION, 10); t.writeUInt16LE(3, 12); t.writeUInt32LE(1, 14); t.writeUInt16LE(orientation, 18);
  t.writeUInt16LE(GPS_IFD, 22); t.writeUInt16LE(4, 24); t.writeUInt32LE(1, 26); t.writeUInt32LE(38, 30);
  t.writeUInt32LE(0, 34);
  // IFD GPS à l'offset 38 : 4 entrées, rationnels à partir de 92
  const ent = (o, tag, type, n, v) => { t.writeUInt16LE(tag, o); t.writeUInt16LE(type, o + 2); t.writeUInt32LE(n, o + 4); t.writeUInt32LE(v, o + 8); };
  t.writeUInt16LE(4, 38);
  ent(40, 1, 2, 2, (lat >= 0 ? 'N' : 'S').charCodeAt(0));
  ent(52, 2, 5, 3, 92);
  ent(64, 3, 2, 2, (lon >= 0 ? 'E' : 'W').charCodeAt(0));
  ent(76, 4, 5, 3, 116);
  t.writeUInt32LE(0, 88);
  const rat = (o, deg) => {
    const a = Math.abs(deg), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
    t.writeUInt32LE(d, o); t.writeUInt32LE(1, o + 4); t.writeUInt32LE(m, o + 8); t.writeUInt32LE(1, o + 12);
    t.writeUInt32LE(Math.round(s * 10000), o + 16); t.writeUInt32LE(10000, o + 20);
  };
  rat(92, lat); rat(116, lon);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t.subarray(0, 140)]);
  const head = Buffer.alloc(4); head[0] = 0xff; head[1] = 0xe1; head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Insère un segment juste après le SOI d'un JPEG. */
export function insertSegment(jpeg, segment) {
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}
