// Import des photos : lecture GPS, nettoyage des métadonnées, redressement, rapprochement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExifSegment, insertSegment, readExif, stripMetadata } from '../scripts/lib/exif.mjs';
import { loadTargets, matchPhoto, processPhoto } from '../scripts/import-photos.mjs';

const pois = JSON.parse(readFileSync(new URL('../data/pois.geojson', import.meta.url)));
const targets = loadTargets(pois);
const isMac = process.platform === 'darwin';

/** JPEG d'essai 40×20 (gauche rouge, droite bleue) avec position GPS et orientation. */
function fixture(dir, { lat, lon, orientation }) {
  const w = 40, h = 20, row = w * 3, size = 54 + row * h;
  const bmp = Buffer.alloc(size);
  bmp.write('BM'); bmp.writeUInt32LE(size, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(w, 18); bmp.writeInt32LE(h, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bmp[54 + y * row + x * 3 + (x < w / 2 ? 2 : 0)] = 255;
  writeFileSync(join(dir, 'f.bmp'), bmp);
  execFileSync('sips', ['-s', 'format', 'jpeg', join(dir, 'f.bmp'), '--out', join(dir, 'f.jpg')], { stdio: 'ignore' });
  const jpg = insertSegment(readFileSync(join(dir, 'f.jpg')), buildExifSegment({ lat, lon, orientation }));
  writeFileSync(join(dir, 'photo.jpg'), jpg);
  return join(dir, 'photo.jpg');
}

const dims = (file) => {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]).toString();
  return [Number(out.match(/pixelWidth: (\d+)/)[1]), Number(out.match(/pixelHeight: (\d+)/)[1])];
};

test('lecture de la position GPS et nettoyage des métadonnées', () => {
  const seg = buildExifSegment({ lat: 43.736985, lon: 7.41905, orientation: 6 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 0, 0xff, 0xd9]);
  const withExif = insertSegment(jpeg, seg);
  const e = readExif(withExif);
  assert.ok(Math.abs(e.lat - 43.736985) < 1e-5 && Math.abs(e.lon - 7.41905) < 1e-5);
  assert.equal(e.orientation, 6);
  const clean = stripMetadata(withExif);
  assert.equal(readExif(clean).lat, null);
  assert.ok(!clean.includes(Buffer.from('Exif')));
});

test('import : photo redressée, réduite et sans position GPS', { skip: !isMac && 'sips requis (macOS)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'photos-test-'));
  try {
    const src = fixture(dir, { lat: 43.737, lon: 7.4191, orientation: 6 });
    const exif = processPhoto(src, join(dir, 'out'), dir);
    assert.ok(Math.abs(exif.lat - 43.737) < 1e-4);
    for (const f of ['out.jpg', 'out-mini.jpg']) {
      const buf = readFileSync(join(dir, f));
      assert.equal(readExif(buf).lat, null, `${f} contient encore la position`);
      assert.ok(!buf.includes(Buffer.from('Exif\0\0')), `${f} contient encore de l'EXIF`);
    }
    // orientation 6 = rotation de 90° : l'image 40×20 devient verticale
    const [w, h] = dims(join(dir, 'out.jpg'));
    assert.ok(h > w, `image non redressée (${w}×${h})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rapprochement par identifiant OSM dans le nom du fichier', () => {
  const m = matchPhoto({ file: '1870233769-porte.jpg', lat: null, lon: null }, targets);
  assert.equal(m.osm, 'node/1870233769');
  assert.equal(m.status, 'ok');
  assert.equal(m.method, 'nom-fichier');
});

test('rapprochement GPS : ascenseur isolé → ok', () => {
  // ascenseur « Jardin Exotique - Parc Princesse Antoinette », décalage d'environ 8 m
  const m = matchPhoto({ file: 'IMG_1.jpg', lat: 43.73416, lon: 7.41500 }, targets);
  assert.equal(m.method, 'gps');
  assert.ok(m.distance <= 15, `distance ${m.distance}`);
  assert.equal(m.name, 'Jardin Exotique - Parc Princesse Antoinette');
});

test('rapprochement GPS : doublon de même nom (Belgique) → ok', () => {
  const m = matchPhoto({ file: 'IMG_2.jpg', lat: 43.73699, lon: 7.41904 }, targets);
  assert.equal(m.name, 'Saint Dévote / Belgique');
  assert.equal(m.status, 'ok');
});

test('rapprochement GPS : trop loin → à vérifier', () => {
  const m = matchPhoto({ file: 'IMG_3.jpg', lat: 43.7300, lon: 7.4100 }, targets);
  assert.equal(m.status, 'a-verifier');
});

test('photo sans position → sans-gps', () => {
  const m = matchPhoto({ file: 'IMG_4.jpg', lat: null, lon: null }, targets);
  assert.equal(m.status, 'sans-gps');
  assert.equal(m.osm, null);
});
