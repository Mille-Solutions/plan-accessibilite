// Construit un graphe piéton compact à partir d'une réponse Overpass (ways + nodes).
// Module ES sans dépendance : utilisable dans Node (script de collecte) et le navigateur.
//
// Format produit :
//   nodes    : [lat0, lon0, lat1, lon1, …]   (index de nœud i → nodes[2i], nodes[2i+1])
//   edges    : [a, b, longueur_dm, flags, way, …]  (5 valeurs par tronçon, non orienté)
//   ways     : [{ id, name, highway }]         (référencés par edges[*].way)
//   elevators: { indexNœud: { id, name, opening_hours, wheelchair, level } }
//   barriers : { indexNœud: { id, kind } }     (obstacles infranchissables en fauteuil)
//   entrances: { indexNœud: { id, name, wheelchair, level } }  (entrées de gare)

export const FLAGS = {
  STEPS: 1,
  ESCALATOR: 2,
  ELEVATOR: 4,
  WHEELCHAIR_NO: 8,
  STEEP: 16,        // pente annoncée entre 6 et 12 % (ou « up/down » sans valeur)
  VERY_STEEP: 32,   // pente > 12 %
  ROAD: 64,         // chaussée partagée avec les voitures
  NO_SIDEWALK: 128, // chaussée sans trottoir connu
  WHEELCHAIR_YES: 256,
  ROUGH: 512,       // revêtement difficile (pavés, gravier…)
  WHEELCHAIR_LIMITED: 1024,
  EXCLUDED: 2048,   // fermé au public d'après data/corrections.json (appliqué au chargement)
};

const ROAD_TYPES = new Set([
  'residential', 'service', 'unclassified', 'tertiary', 'tertiary_link',
  'secondary', 'secondary_link', 'primary', 'primary_link', 'track',
]);
const ROUGH_SURFACES = new Set([
  'gravel', 'fine_gravel', 'pebblestone', 'sett', 'cobblestone', 'unhewn_cobblestone',
  'grass', 'dirt', 'earth', 'ground', 'sand', 'mud', 'rock', 'stepping_stones', 'wood_chips',
]);

/** Pente en % à partir du tag incline (null si absente / non numérique). */
export function parseIncline(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'up' || v === 'down' || v === 'yes') return NaN; // pente sans valeur
  const pct = v.match(/^(-?\d+(?:[.,]\d+)?)\s*%$/);
  if (pct) return Math.abs(parseFloat(pct[1].replace(',', '.')));
  const deg = v.match(/^(-?\d+(?:[.,]\d+)?)\s*°$/);
  if (deg) return Math.abs(Math.tan((parseFloat(deg[1].replace(',', '.')) * Math.PI) / 180) * 100);
  const num = v.match(/^-?\d+(?:[.,]\d+)?$/);
  if (num) return Math.abs(parseFloat(v.replace(',', '.')));
  return null;
}

/** Le tronçon est-il interdit aux piétons ? */
function isForbidden(t) {
  if (t.foot === 'no' || t.foot === 'use_sidepath') return true;
  if ((t.access === 'private' || t.access === 'no') && !['yes', 'designated', 'permissive'].includes(t.foot)) return true;
  if (t.highway === 'cycleway' && !['yes', 'designated', 'permissive'].includes(t.foot)) return true;
  if (t.area === 'yes' && t.highway !== 'pedestrian' && t.highway !== 'footway') return true;
  return false;
}

export function wayFlags(t) {
  let f = 0;
  if (t.highway === 'steps') f |= t.conveying ? FLAGS.ESCALATOR : FLAGS.STEPS;
  if (t.highway === 'elevator') f |= FLAGS.ELEVATOR;
  if (t.wheelchair === 'no') f |= FLAGS.WHEELCHAIR_NO;
  if (t.wheelchair === 'yes' || t.wheelchair === 'designated') f |= FLAGS.WHEELCHAIR_YES;
  if (t.wheelchair === 'limited') f |= FLAGS.WHEELCHAIR_LIMITED;
  const inc = parseIncline(t.incline);
  if (inc !== null) {
    if (Number.isNaN(inc)) f |= FLAGS.STEEP;
    else if (inc > 12) f |= FLAGS.VERY_STEEP;
    else if (inc >= 6) f |= FLAGS.STEEP;
  }
  if (ROAD_TYPES.has(t.highway)) {
    f |= FLAGS.ROAD;
    const sw = t.sidewalk || t['sidewalk:both'];
    const noSidewalk = sw === 'no' || sw === 'none' ||
      (!sw && !t['sidewalk:left'] && !t['sidewalk:right'] && (t.tunnel === 'yes' || /^(primary|secondary)/.test(t.highway)));
    if (noSidewalk) f |= FLAGS.NO_SIDEWALK;
  }
  if (ROUGH_SURFACES.has(t.surface) || ['bad', 'very_bad', 'horrible', 'very_horrible', 'impassable'].includes(t.smoothness)) {
    f |= FLAGS.ROUGH;
  }
  return f;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isBarrier(t) {
  if (t.wheelchair === 'no' && t.highway !== 'elevator') return 'wheelchair=no';
  if (t.kerb === 'raised' || t.kerb === 'rolled' && t.wheelchair === 'no') return 'kerb=raised';
  if (['stile', 'turnstile', 'full-height_turnstile', 'kissing_gate', 'step'].includes(t.barrier)) return `barrier=${t.barrier}`;
  return null;
}

export function buildNetwork(overpassJson) {
  const osmNodes = new Map();
  const osmWays = [];
  for (const el of overpassJson.elements) {
    if (el.type === 'node') osmNodes.set(el.id, el);
    else if (el.type === 'way' && el.tags && el.nodes) osmWays.push(el);
  }

  const nodes = [];
  const edges = [];
  const ways = [];
  const elevators = {};
  const barriers = {};
  const entrances = {};
  const index = new Map(); // id OSM → index de nœud

  const nodeIndex = (id) => {
    let i = index.get(id);
    if (i !== undefined) return i;
    const n = osmNodes.get(id);
    if (!n) return -1;
    i = nodes.length / 2;
    index.set(id, i);
    nodes.push(+n.lat.toFixed(6), +n.lon.toFixed(6));
    const t = n.tags || {};
    if (t.highway === 'elevator') {
      elevators[i] = {
        id: n.id,
        name: t.name || t.description || null,
        opening_hours: t.opening_hours || null,
        wheelchair: t.wheelchair || null,
        level: t.level || null,
      };
    } else if (t.railway === 'train_station_entrance' || t.railway === 'subway_entrance') {
      entrances[i] = { id: n.id, name: t.name || null, wheelchair: t.wheelchair || null, level: t.level || null };
    } else {
      const b = isBarrier(t);
      if (b) barriers[i] = { id: n.id, kind: b };
    }
    return i;
  };

  for (const w of osmWays) {
    const t = w.tags;
    if (isForbidden(t)) continue;
    if (!t.highway && t.railway !== 'platform') continue;
    const flags = wayFlags(t);
    const wayIdx = ways.length;
    ways.push({ id: w.id, name: t.name || t.ref || null, highway: t.highway || 'platform' });
    if (t.highway === 'elevator') {
      elevators[`w${wayIdx}`] = {
        id: w.id, way: true, name: t.name || null,
        opening_hours: t.opening_hours || null, wheelchair: t.wheelchair || null, level: t.level || null,
      };
    }
    for (let k = 1; k < w.nodes.length; k++) {
      const a = nodeIndex(w.nodes[k - 1]);
      const b = nodeIndex(w.nodes[k]);
      if (a < 0 || b < 0 || a === b) continue;
      let len = haversine(nodes[2 * a], nodes[2 * a + 1], nodes[2 * b], nodes[2 * b + 1]);
      // un ascenseur « way » a souvent une longueur au sol quasi nulle : on fixe un coût minimal
      if (flags & FLAGS.ELEVATOR) len = Math.max(len, 5);
      edges.push(a, b, Math.max(1, Math.round(len * 10)), flags, wayIdx);
    }
  }

  return { version: 1, nodes, edges, ways, elevators, barriers, entrances, osmIndex: index };
}
