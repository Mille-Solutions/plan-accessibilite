#!/usr/bin/env node
// Télécharge les données OpenStreetMap (API Overpass) pour Monaco + Beausoleil
// et produit deux fichiers statiques utilisés par l'application :
//   data/pois.geojson   – points d'intérêt PMR (ascenseurs, escaliers, toilettes…)
//   data/network.json   – graphe piéton compact pour le calcul d'itinéraire
//
// Usage : node scripts/fetch-osm.mjs [--from-cache]
//   --from-cache  réutilise data/raw/*.json au lieu d'interroger Overpass

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNetwork } from '../js/network-builder.js';
import { extractPois } from '../js/poi-extractor.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const RAW = join(DATA, 'raw');

// sud, ouest, nord, est
export const BBOX = [43.722, 7.405, 43.756, 7.447];
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const bbox = BBOX.join(',');

const NETWORK_QUERY = `[out:json][timeout:120];
(
  way["highway"~"^(footway|pedestrian|path|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|corridor|elevator|steps|track|cycleway|crossing|platform)$"](${bbox});
  way["railway"="platform"](${bbox});
  way["public_transport"="platform"]["highway"](${bbox});
);
(._;>;);
out body qt;`;

const POI_QUERY = `[out:json][timeout:120];
(
  nwr["highway"="elevator"](${bbox});
  way["highway"="steps"](${bbox});
  nwr["ramp"="yes"](${bbox});
  nwr["ramp:wheelchair"="yes"](${bbox});
  way["incline"]["highway"~"^(footway|pedestrian|path)$"](${bbox});
  node["kerb"~"^(lowered|flush)$"](${bbox});
  nwr["amenity"="toilets"](${bbox});
  nwr["toilets:wheelchair"~"^(yes|limited)$"](${bbox});
  nwr["amenity"="parking_space"]["parking_space"="disabled"](${bbox});
  nwr["amenity"="parking"]["capacity:disabled"](${bbox});
);
out body center qt;
(way["highway"="steps"](${bbox}); way["incline"]["highway"~"^(footway|pedestrian|path)$"](${bbox}););
(._;>;);
out skel qt;`;

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      console.log(`→ ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'plan-accessibilite/0.1' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`  échec : ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

async function getRaw(name, query, fromCache) {
  const file = join(RAW, `${name}.json`);
  if (fromCache) return JSON.parse(await readFile(file, 'utf8'));
  const json = await overpass(query);
  await mkdir(RAW, { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json;
}

const fromCache = process.argv.includes('--from-cache');

const rawNetwork = await getRaw('network', NETWORK_QUERY, fromCache);
const network = buildNetwork(rawNetwork);
const osmIndex = network.osmIndex;
delete network.osmIndex;
network.generated = new Date().toISOString();
network.bbox = BBOX;
await writeFile(join(DATA, 'network.json'), JSON.stringify(network));
console.log(`network.json : ${network.nodes.length / 2} nœuds, ${network.edges.length / 5} tronçons`);

const rawPois = await getRaw('pois', POI_QUERY, fromCache);
const pois = extractPois(rawPois);
pois.generated = network.generated;
// Un ascenseur est « routable » s'il est relié au réseau piéton (sinon il n'est qu'un point isolé)
const routableWays = new Set(network.ways.filter((w) => w.highway === 'elevator').map((w) => `way/${w.id}`));
for (const f of pois.features) {
  const p = f.properties;
  if (p.category !== 'elevator') continue;
  const [type, id] = p.osm.split('/');
  p.routable = type === 'node' ? osmIndex.has(Number(id)) : routableWays.has(p.osm);
}
await writeFile(join(DATA, 'pois.geojson'), JSON.stringify(pois));
const counts = {};
for (const f of pois.features) counts[f.properties.category] = (counts[f.properties.category] || 0) + 1;
console.log('pois.geojson :', counts);
