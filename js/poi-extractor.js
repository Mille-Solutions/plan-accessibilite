// Transforme une réponse Overpass en GeoJSON de points d'intérêt PMR, classés par catégorie.
// Catégories : elevator, escalator, ramp, steps, toilets, parking, kerb

const KEEP_TAGS = [
  'name', 'description', 'opening_hours', 'wheelchair', 'wheelchair:description', 'level',
  'image', 'wikimedia_commons', 'operator', 'incline', 'step_count', 'handrail', 'ramp',
  'ramp:wheelchair', 'kerb', 'capacity:disabled', 'fee', 'toilets:wheelchair', 'access',
  'conveying', 'width', 'surface', 'check_date', 'note',
];

export function categorize(t) {
  if (t.highway === 'elevator') return 'elevator';
  if (t.highway === 'steps') {
    if (t.conveying) return 'escalator';
    if (t['ramp:wheelchair'] === 'yes') return 'ramp';
    return 'steps';
  }
  if (t['ramp:wheelchair'] === 'yes' || t.ramp === 'yes') return 'ramp';
  if (t.incline && /^(footway|pedestrian|path)$/.test(t.highway || '')) return 'ramp';
  if (t.amenity === 'toilets' || t['toilets:wheelchair']) {
    const w = t.amenity === 'toilets' ? t.wheelchair : t['toilets:wheelchair'];
    return w === 'yes' || w === 'limited' || w === 'designated' || t['toilets:wheelchair'] === 'yes' ? 'toilets' : null;
  }
  if (t.amenity === 'parking_space' && t.parking_space === 'disabled') return 'parking';
  if (t.amenity === 'parking' && parseInt(t['capacity:disabled'], 10) > 0) return 'parking';
  if (t.kerb === 'lowered' || t.kerb === 'flush') return 'kerb';
  return null;
}

export function extractPois(overpassJson) {
  const nodes = new Map();
  const wayGeom = new Map();
  for (const el of overpassJson.elements) {
    if (el.type === 'node') nodes.set(el.id, el);
  }
  for (const el of overpassJson.elements) {
    if (el.type === 'way' && el.nodes) {
      const coords = el.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => [n.lon, n.lat]);
      if (coords.length >= 2) wayGeom.set(el.id, coords);
    }
  }

  const features = [];
  const seen = new Set();
  for (const el of overpassJson.elements) {
    if (!el.tags) continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    const category = categorize(el.tags);
    if (!category) continue;
    seen.add(key);

    let geometry = null;
    if (el.type === 'node') geometry = { type: 'Point', coordinates: [el.lon, el.lat] };
    else if (el.type === 'way' && (category === 'steps' || category === 'escalator' || category === 'ramp') && wayGeom.has(el.id)) {
      geometry = { type: 'LineString', coordinates: wayGeom.get(el.id) };
    } else if (el.center) geometry = { type: 'Point', coordinates: [el.center.lon, el.center.lat] };
    if (!geometry) continue;

    const props = { category, osm: key };
    for (const k of KEEP_TAGS) if (el.tags[k] !== undefined) props[k] = el.tags[k];
    features.push({ type: 'Feature', geometry, properties: props });
  }
  return { type: 'FeatureCollection', features };
}
