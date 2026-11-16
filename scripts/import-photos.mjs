#!/usr/bin/env node
// Importe les photos d'ascenseurs et d'entrées de gare.
//
//   1. Déposer les photos (JPEG, HEIC, PNG) dans photos/originaux/ (non publié sur GitHub).
//   2. node scripts/import-photos.mjs
//   3. Vérifier les rapprochements signalés « à vérifier » dans data/photos.json, corriger
//      le champ "osm" si besoin, puis passer "status" à "ok".
//
// Pour chaque nouvelle photo, le script :
//   - lit la position GPS et l'orientation (les HEIC sont convertis par sips, outil intégré à macOS) ;
//   - cherche l'ascenseur ou l'entrée de gare correspondant : identifiant OSM présent dans le nom
//     du fichier (ex. 1870233769-porte.jpg) en priorité, sinon le plus proche de la position GPS ;
//   - produit deux versions web dans photos/web/ (1600 px et miniature 600 px), redressées et
//     SANS métadonnées (ni position, ni modèle de téléphone, ni date) ;
//   - ajoute une entrée dans data/photos.json.
// Les entrées existantes de data/photos.json ne sont jamais modifiées (vos corrections sont conservées).
// Pour refaire le rapprochement d'une photo, supprimez son entrée et relancez le script.
//
// Options : --force  régénère aussi les images web des photos déjà importées.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExif, stripMetadata } from './lib/exif.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'photos', 'originaux');
const WEB = join(ROOT, 'photos', 'web');
const DB = join(ROOT, 'data', 'photos.json');
const POIS = join(ROOT, 'data', 'pois.geojson');
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.png']);

export const MATCH = {
  maxDistance: 30,   // m : au-delà, la photo est « à vérifier »
  minGap: 10,        // m : écart minimal avec le 2e candidat (s'il porte un autre nom)
};

const R = 6371008.8;
export function distance(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ascenseurs et entrées de gare candidats : [{ osm, name, category, lat, lon }]. */
export function loadTargets(pois) {
  return pois.features
    .filter((f) => ['elevator', 'entrance'].includes(f.properties.category) && f.geometry.type === 'Point')
    .map((f) => ({
      osm: f.properties.osm,
      name: f.properties.name || null,
      category: f.properties.category,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
}

/** Rapproche une photo d'un ascenseur / d'une entrée. */
export function matchPhoto({ file, lat, lon }, targets) {
  const idInName = basename(file).match(/(\d{6,})/);
  if (idInName) {
    const t = targets.find((x) => x.osm.endsWith(`/${idInName[1]}`));
    if (t) return { osm: t.osm, name: t.name, method: 'nom-fichier', distance: null, status: 'ok' };
  }
  if (lat == null || lon == null) return { osm: null, name: null, method: 'aucune', distance: null, status: 'sans-gps' };
  const ranked = targets.map((t) => ({ ...t, d: distance({ lat, lon }, t) })).sort((a, b) => a.d - b.d);
  const [best, ...rest] = ranked;
  // 2e candidat le plus proche portant un AUTRE nom (un même ascenseur est parfois cartographié deux fois)
  const rival = rest.find((t) => !best.name || t.name !== best.name);
  const reasons = [];
  if (best.d > MATCH.maxDistance) reasons.push(`à ${Math.round(best.d)} m`);
  if (rival && rival.d - best.d < MATCH.minGap) reasons.push(`« ${rival.name || rival.osm} » à ${Math.round(rival.d)} m aussi`);
  return {
    osm: best.osm,
    name: best.name,
    method: 'gps',
    distance: Math.round(best.d),
    status: reasons.length ? 'a-verifier' : 'ok',
    note: reasons.join(', ') || undefined,
    alternative: reasons.length && rival ? rival.osm : undefined,
  };
}

/** sips -r : rotation horaire en degrés ; -f : miroir. Orientation EXIF → opérations. */
function orientationOps(o) {
  return {
    1: [], 2: ['-f', 'horizontal'], 3: ['-r', '180'], 4: ['-f', 'vertical'],
    5: ['-f', 'horizontal', '-r', '270'], 6: ['-r', '90'], 7: ['-f', 'horizontal', '-r', '90'], 8: ['-r', '270'],
  }[o] || [];
}

function sips(args) {
  execFileSync('sips', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** Convertit, lit les métadonnées, puis écrit les versions web nettoyées. */
export function processPhoto(src, outBase, tmp) {
  const full = join(tmp, 'full.jpg');
  sips(['-s', 'format', 'jpeg', src, '--out', full]);
  const exif = readExif(readFileSync(full));
  const ops = orientationOps(exif.orientation);
  if (ops.length) sips([...ops, full, '--out', full]);
  const outputs = { web: `${outBase}.jpg`, mini: `${outBase}-mini.jpg` };
  for (const [kind, size, quality] of [['web', 1600, 80], ['mini', 600, 72]]) {
    const out = join(tmp, `${kind}.jpg`);
    sips(['-Z', String(size), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), full, '--out', out]);
    writeFileSync(outputs[kind], stripMetadata(readFileSync(out)));
  }
  return exif;
}

function slug(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function main() {
  if (process.platform !== 'darwin') {
    console.error('Ce script utilise sips (macOS).');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  mkdirSync(SRC, { recursive: true });
  mkdirSync(WEB, { recursive: true });
  const db = existsSync(DB) ? JSON.parse(readFileSync(DB, 'utf8')) : { photos: [] };
  db._comment = 'Généré par scripts/import-photos.mjs puis vérifié à la main. "osm" : ascenseur ou entrée de gare (ex. node/1870233769). "status" : ok | a-verifier | sans-gps. "caption" : légende facultative {fr, en}. Pour refaire le rapprochement d\'une photo, supprimer son entrée et relancer le script.';
  const targets = loadTargets(JSON.parse(readFileSync(POIS, 'utf8')));
  const sources = readdirSync(SRC).filter((f) => EXTENSIONS.has(extname(f).toLowerCase()) && !f.startsWith('.')).sort();
  const known = new Map(db.photos.map((p) => [p.source, p]));
  const tmp = mkdtempSync(join(tmpdir(), 'photos-'));
  const report = [];
  try {
    for (const source of sources) {
      const existing = known.get(source);
      if (existing && !force) continue;
      let base = existing ? basename(existing.file, '.jpg') : slug(basename(source, extname(source)));
      // deux originaux de même nom (IMG_1234.HEIC et IMG_1234.JPG) : suffixe
      if (!existing) {
        const used = new Set(db.photos.map((p) => p.file));
        for (let k = 2; used.has(`photos/web/${base}.jpg`); k++) base = `${slug(basename(source, extname(source)))}-${k}`;
      }
      const exif = processPhoto(join(SRC, source), join(WEB, base), tmp);
      if (existing) { report.push({ source, status: 'images régénérées', osm: existing.osm }); continue; }
      const m = matchPhoto({ file: source, lat: exif.lat, lon: exif.lon }, targets);
      const entry = {
        source,
        file: `photos/web/${base}.jpg`,
        thumb: `photos/web/${base}-mini.jpg`,
        osm: m.osm,
        name: m.name,
        status: m.status,
        method: m.method,
        distance: m.distance,
        ...(m.note ? { note: m.note } : {}),
        ...(m.alternative ? { alternative: m.alternative } : {}),
        // position arrondie (~1 m), utile à la vérification sur la carte (?verif=photos)
        ...(exif.lat != null ? { gps: [+exif.lat.toFixed(5), +exif.lon.toFixed(5)] } : {}),
        caption: { fr: '', en: '' },
      };
      db.photos.push(entry);
      report.push({ source, ...m });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // Retire les entrées dont la photo d'origine a disparu
  const present = new Set(sources);
  const removed = db.photos.filter((p) => !present.has(p.source));
  for (const p of removed) for (const f of [p.file, p.thumb]) rmSync(join(ROOT, f), { force: true });
  db.photos = db.photos.filter((p) => present.has(p.source));
  const { _comment, ...rest } = db;
  writeFileSync(DB, `${JSON.stringify({ _comment, ...rest }, null, 2)}\n`);

  if (!report.length && !removed.length) console.log('Aucune nouvelle photo.');
  for (const r of report) {
    const where = r.osm ? `${r.name || '(sans nom)'} [${r.osm}]` : '—';
    const how = r.method === 'gps' ? `GPS, ${r.distance} m` : r.method || '';
    const flag = r.status === 'ok' ? 'OK ' : r.status === 'a-verifier' ? 'À VÉRIFIER' : r.status.toUpperCase();
    console.log(`${flag.padEnd(11)} ${r.source} → ${where} ${how ? `(${how})` : ''}${r.note ? ` — ${r.note}` : ''}`);
  }
  for (const p of removed) console.log(`RETIRÉE     ${p.source} (photo d'origine absente)`);
  const pending = db.photos.filter((p) => p.status !== 'ok').length;
  console.log(`\n${db.photos.length} photo(s) dans data/photos.json, dont ${pending} à vérifier.`);
  if (pending) console.log('Contrôle visuel : ouvrir la carte avec ?verif=photos (ex. http://localhost:8765/?verif=photos).');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
