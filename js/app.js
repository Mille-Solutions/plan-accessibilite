// Application principale : carte Leaflet, couches PMR, itinéraires.
/* global L */
import { Router } from './router.js';
import { isOpen } from './hours.js';
import { t, loc, getLang, setLang, applyStatic } from './i18n.js';

const CENTER = [43.7395, 7.4235];
const WHEELCHAIR_SPEED = 55; // m/min (≈ 3,3 km/h, prudent en terrain urbain)
const ELEVATOR_TIME = 1.5;   // min par ascenseur (attente + trajet)

const CATEGORIES = [
  { id: 'elevator', color: 'var(--c-elevator)', hex: '#0b63ce', glyph: '⇅', on: true },
  { id: 'entrance', color: 'var(--c-entrance)', hex: '#334155', glyph: '🚉', on: true },
  { id: 'escalator', color: 'var(--c-escalator)', hex: '#6d28d9', glyph: '↗', on: true, line: true },
  { id: 'ramp', color: 'var(--c-ramp)', hex: '#146c2e', glyph: '⟋', on: true, line: true },
  { id: 'steps', color: 'var(--c-steps)', hex: '#c2261b', glyph: '⚠', on: true, line: true, dashed: true },
  { id: 'toilets', color: 'var(--c-toilets)', hex: '#0e7490', glyph: 'WC', on: true },
  { id: 'parking', color: 'var(--c-parking)', hex: '#1d4ed8', glyph: 'P', on: true },
  { id: 'kerb', color: 'var(--c-kerb)', hex: '#a16207', glyph: '', on: false, small: true },
];

const state = {
  router: null,
  network: null,
  pois: null,
  itineraries: null,
  layers: {},
  from: null,       // {lat, lon, label}
  to: null,
  via: [],
  activeTrip: null, // id du trajet de référence sélectionné
  picking: null,    // 'from' | 'to' | null
  lastResult: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function store(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } }
function recall(key) { try { return localStorage.getItem(key); } catch { return null; } }

// ---------------------------------------------------------------- Carte
const MAX_ZOOM = 21; // au-delà de 19, les tuiles OSM sont agrandies : utile pour séparer les marqueurs proches
const map = L.map('map', { zoomControl: true, minZoom: 13, maxZoom: MAX_ZOOM }).setView(CENTER, 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: MAX_ZOOM,
  maxNativeZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Garde les info-bulles dans la carte (elles débordaient de l'écran près des bords sur mobile)
function keepTooltipInside(tooltip) {
  const el = tooltip.getElement();
  if (!el) return;
  el.style.marginLeft = '';
  el.classList.remove('shifted');
  const box = map.getContainer().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let dx = 0;
  if (r.left < box.left + 8) dx = box.left + 8 - r.left;
  else if (r.right > box.right - 8) dx = box.right - 8 - r.right;
  if (dx) {
    el.style.marginLeft = `${dx}px`;
    el.classList.add('shifted');
  }
}
map.on('tooltipopen', (e) => requestAnimationFrame(() => keepTooltipInside(e.tooltip)));
map.on('zoomend moveend', () => {
  map.eachLayer((layer) => { const tt = layer.getTooltip?.(); if (tt && tt.isOpen()) keepTooltipInside(tt); });
});

const routeLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

// Les marqueurs ponctuels (toutes catégories) sont regroupés quand ils se chevauchent.
// Un clic sur un groupe zoome dessus ; au zoom maximal, le groupe s'ouvre en éventail.
const poiCluster = L.markerClusterGroup({
  maxClusterRadius: (z) => (z >= 19 ? 18 : z >= 17 ? 30 : 45),
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  spiderfyDistanceMultiplier: 1.6,
  iconCreateFunction(cluster) {
    const counts = {};
    for (const m of cluster.getAllChildMarkers()) counts[m.options.category] = (counts[m.options.category] || 0) + 1;
    const top = CATEGORIES.find((c) => counts[c.id]);
    const n = cluster.getChildCount();
    return L.divIcon({
      className: '',
      html: `<span class="poi-cluster"><span class="poi-icon" style="background:${top.hex}" aria-hidden="true">${top.glyph}</span><span class="poi-cluster-count">${n}</span></span>`,
      iconSize: [44, 32],
      iconAnchor: [15, 16],
    });
  },
}).addTo(map);

function pinIcon(cls, text) {
  return L.divIcon({ className: '', html: `<span class="pin ${cls}">${esc(text)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
}

function poiIcon(cat, dim) {
  return L.divIcon({
    className: '',
    html: `<span class="poi-icon${dim ? ' dim' : ''}" style="background:${cat.hex}" aria-hidden="true">${cat.glyph}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

// ---------------------------------------------------------------- Fiches (popups)
function wheelchairText(v) {
  if (v === 'yes' || v === 'designated') return t('wc_yes');
  if (v === 'limited') return t('wc_limited');
  if (v === 'no') return t('wc_no');
  return t('wc_unknown');
}

function hoursBadge(oh) {
  if (!oh) return `<span class="badge unknown">${esc(t('hoursUnknown'))}</span>`;
  const o = isOpen(oh, new Date());
  const cls = o === true ? 'open' : o === false ? 'closed' : 'unknown';
  const label = o === true ? t('open') : o === false ? t('closed') : t('hoursUnknown');
  return `${esc(oh)} <span class="badge ${cls}">${esc(label)}</span>`;
}

function photoUrl(p) {
  if (p.image && /^https?:\/\//.test(p.image)) {
    const m = p.image.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
    if (m) return `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].replace(/^File:/, '')}?width=320`;
    if (/\.(jpe?g|png|webp)$/i.test(p.image)) return p.image;
  }
  if (p.wikimedia_commons && p.wikimedia_commons.startsWith('File:')) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.wikimedia_commons.slice(5))}?width=320`;
  }
  return null;
}

function popupHtml(p) {
  const title = p.name || p.description || t(`cat_${p.category}`);
  const rows = [];
  if (p.category === 'elevator' || p.opening_hours) rows.push([t('hours'), hoursBadge(p.opening_hours)]);
  if (p.category === 'elevator') rows.push([t('status'), esc(t('statusNoLive'))]);
  const wc = p.category === 'toilets' ? (p.wheelchair || p['toilets:wheelchair']) : p.wheelchair;
  if (p.category !== 'steps' || wc) rows.push([t('wheelchair'), esc(wheelchairText(wc))]);
  if (p.level) rows.push([t('level'), esc(p.level)]);
  if (p.step_count) rows.push([t('stepCount'), esc(p.step_count)]);
  if (p.incline) rows.push([t('incline'), esc(p.incline)]);
  if (p['capacity:disabled']) rows.push([t('capacityDisabled'), esc(p['capacity:disabled'])]);
  if (p.category === 'elevator') rows.push([t('routable'), esc(p.routable ? t('yes') : t('no'))]);
  if (p.category === 'entrance') rows.push([t('stepFree'), esc(p.stepFree ? t('yes') : t('stepFreeNo'))]);
  const photo = photoUrl(p);
  return `<h4>${esc(title)}</h4>
    <div class="muted">${esc(t(`cat_${p.category}`))}</div>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    ${p.category === 'elevator' && !p.routable ? `<p class="muted">${esc(t('notRoutable'))}</p>` : ''}
    ${p['wheelchair:description'] ? `<p>${esc(p['wheelchair:description'])}</p>` : ''}
    ${photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : ''}
    <p><a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener">${esc(t('editOsm'))}</a></p>`;
}

// ---------------------------------------------------------------- Couches
function buildLayers() {
  for (const cat of CATEGORIES) {
    const group = L.layerGroup();
    const feats = state.pois.features.filter((f) => f.properties.category === cat.id);
    for (const f of feats) {
      const p = f.properties;
      let layer;
      if (f.geometry.type === 'LineString') {
        const latlngs = f.geometry.coordinates.map(([x, y]) => [y, x]);
        layer = L.polyline(latlngs, { color: cat.hex, weight: 4, opacity: 0.75, dashArray: cat.dashed ? '5 5' : null });
      } else {
        const [x, y] = f.geometry.coordinates;
        if (cat.small) layer = L.circleMarker([y, x], { radius: 5, color: '#fff', weight: 2, fillColor: cat.hex, fillOpacity: 1 });
        else {
          layer = L.marker([y, x], {
            category: cat.id,
            icon: poiIcon(cat, (cat.id === 'elevator' && !p.routable) || (cat.id === 'entrance' && !p.stepFree)),
            title: p.name || t(`cat_${cat.id}`),
            alt: p.name || t(`cat_${cat.id}`),
            keyboard: true,
            zIndexOffset: cat.id === 'entrance' ? 600 : cat.id === 'elevator' ? 500 : 0,
          });
        }
      }
      layer.bindPopup(() => popupHtml(p), { maxWidth: 300 });
      group.addLayer(layer);
    }
    const saved = recall(`layer:${cat.id}`);
    const on = saved === null ? cat.on : saved === '1';
    const clustered = !cat.line && !cat.small;
    state.layers[cat.id] = { group, count: feats.length, on, clustered };
    showLayer(state.layers[cat.id], on);
  }
  renderLayerList();
}

function showLayer(l, on) {
  if (l.clustered) {
    if (on) poiCluster.addLayers(l.group.getLayers()); else poiCluster.removeLayers(l.group.getLayers());
  } else if (on) l.group.addTo(map);
  else map.removeLayer(l.group);
}

function renderLayerList() {
  const list = $('layer-list');
  list.innerHTML = '';
  for (const cat of CATEGORIES) {
    const l = state.layers[cat.id];
    if (!l) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'layer-btn';
    btn.setAttribute('aria-pressed', String(l.on));
    const sym = cat.line
      ? `<span class="legend-line${cat.dashed ? ' dashed' : ''}" style="border-color:${cat.hex}"></span>`
      : `<span class="poi-icon legend-icon" style="background:${cat.hex}">${cat.glyph}</span>`;
    btn.innerHTML = `<span class="check-mark" aria-hidden="true">${l.on ? '✓' : ''}</span>${sym}<span>${esc(t(`cat_${cat.id}`))}</span><span class="count">${l.count}</span>`;
    btn.addEventListener('click', () => {
      l.on = !l.on;
      showLayer(l, l.on);
      store(`layer:${cat.id}`, l.on ? '1' : '0');
      renderLayerList();
      list.querySelectorAll('.layer-btn')[CATEGORIES.indexOf(cat)]?.focus();
    });
    list.appendChild(btn);
  }
}

// ---------------------------------------------------------------- Trajets de référence
function destinationPoint(key) {
  const d = state.itineraries.destinations[key];
  return d ? { lat: d.lat, lon: d.lon, label: d.name } : null;
}

function renderTrips() {
  const list = $('trip-list');
  list.innerHTML = '';
  if (!state.itineraries) return;
  state.itineraries.itineraries.forEach((it, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trip-btn';
    btn.setAttribute('aria-pressed', String(state.activeTrip === it.id));
    btn.innerHTML = `<span class="trip-num" aria-hidden="true">${i + 1}</span><span>${esc(loc(it.name))}</span>`;
    btn.addEventListener('click', () => selectTrip(it));
    list.appendChild(btn);
  });
}

function selectTrip(it) {
  state.activeTrip = it.id;
  state.from = { ...it.from };
  state.via = (it.via || []).map((v) => ({ ...v }));
  state.to = typeof it.to === 'string' ? destinationPoint(it.to) : { ...it.to };
  renderTrips();
  renderEndpoints();
  calculate();
}

// ---------------------------------------------------------------- Départ / arrivée
function pointLabel(p) {
  if (!p) return t('notSet');
  if (p.label) return loc(p.label);
  return `${t('mapPoint')} (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`;
}

function renderEndpoints() {
  $('from-value').textContent = pointLabel(state.from);
  $('to-value').textContent = pointLabel(state.to);
  markerLayer.clearLayers();
  if (state.from) {
    L.marker([state.from.lat, state.from.lon], { icon: pinIcon('pin-a', 'A'), draggable: true, title: t('startMarker'), zIndexOffset: 1000 })
      .on('dragend', (e) => { const ll = e.target.getLatLng(); setPoint('from', ll.lat, ll.lng); })
      .addTo(markerLayer);
  }
  if (state.to) {
    L.marker([state.to.lat, state.to.lon], { icon: pinIcon('pin-b', 'B'), draggable: true, title: t('endMarker'), zIndexOffset: 1000 })
      .on('dragend', (e) => { const ll = e.target.getLatLng(); setPoint('to', ll.lat, ll.lng); })
      .addTo(markerLayer);
  }
  state.via.forEach((v, i) => {
    // les passages par un ascenseur ou une entrée sont mis en évidence par drawRoute
    if (v.elevator !== undefined || v.entrance !== undefined) return;
    const r = state.router?.resolve(v);
    if (!r) return;
    L.marker([r.lat, r.lon], { icon: pinIcon('pin-v', String(i + 1)), title: `${t('viaMarker')} ${i + 1} – ${loc(v.label)}`, zIndexOffset: 900 })
      .bindTooltip(loc(v.label) || `${t('viaMarker')} ${i + 1}`)
      .addTo(markerLayer);
  });
}

function setPoint(which, lat, lon, label = null) {
  state[which] = { lat, lon, label };
  state.activeTrip = null;
  state.via = [];
  renderTrips();
  renderEndpoints();
  if (state.from && state.to) calculate();
}

function startPicking(which) {
  state.picking = state.picking === which ? null : which;
  document.body.classList.toggle('picking', !!state.picking);
  $('pick-from').setAttribute('aria-pressed', String(state.picking === 'from'));
  $('pick-to').setAttribute('aria-pressed', String(state.picking === 'to'));
  const hint = $('pick-hint');
  hint.hidden = !state.picking;
  hint.textContent = state.picking === 'from' ? t('pickFromHint') : state.picking === 'to' ? t('pickToHint') : '';
  if (state.picking && window.matchMedia('(max-width: 760px)').matches) setPanelCollapsed(true);
}

map.on('click', (e) => {
  if (!state.picking) return;
  const which = state.picking;
  startPicking(null);
  setPanelCollapsed(false);
  setPoint(which, e.latlng.lat, e.latlng.lng);
});

// ---------------------------------------------------------------- Calcul
function options(extra = {}) {
  const dateVal = $('opt-date').value;
  return {
    avoidSteep: $('opt-steep').checked,
    respectHours: $('opt-hours').checked,
    date: dateVal ? new Date(dateVal) : new Date(),
    ...extra,
  };
}

function fmtDist(m) {
  return m >= 1000 ? t('km', { n: (m / 1000).toLocaleString(getLang(), { maximumFractionDigits: 1 }) }) : t('meters', { n: Math.round(m) });
}

function calculate() {
  if (!state.router || !state.from || !state.to) return;
  const res = state.router.route({ from: state.from, via: state.via, to: state.to, options: options() });
  state.lastResult = res;
  let walk = null;
  if ($('opt-walk').checked) {
    walk = state.router.route({ from: state.from, via: [], to: state.to, options: options({ wheelchair: false, avoidSteep: false, respectHours: false }) });
  }
  drawRoute(res, walk);
  renderResult(res, walk);
}

/** Étapes remarquables du trajet (ascenseurs, entrées de gare), numérotées dans l'ordre. */
function routeStops(res) {
  return res.steps.filter((s) => (s.type === 'elevator' || s.type === 'entrance') && s.lat !== undefined);
}

/** Regroupe les étapes consécutives distantes de moins de 25 m (ex. entrée de gare + ascenseur). */
function groupStops(stops) {
  const groups = [];
  stops.forEach((s, k) => {
    const g = groups[groups.length - 1];
    const prev = g && g[g.length - 1].stop;
    if (prev && L.latLng(prev.lat, prev.lon).distanceTo([s.lat, s.lon]) < 25) g.push({ stop: s, n: k + 1 });
    else groups.push([{ stop: s, n: k + 1 }]);
  });
  return groups;
}

function stopIcon(group) {
  const html = group.map(({ stop, n }) => {
    const cat = CATEGORIES.find((c) => c.id === stop.type);
    return `<span class="route-stop"><span class="poi-icon" style="background:${cat.hex}" aria-hidden="true">${cat.glyph}</span><span class="route-stop-num">${n}</span></span>`;
  }).join('');
  const w = 44 * group.length;
  return L.divIcon({ className: '', html: `<span class="route-stops">${html}</span>`, iconSize: [w, 40], iconAnchor: [w / 2, 20] });
}

function drawRoute(res, walk) {
  routeLayer.clearLayers();
  document.getElementById('map').classList.toggle('has-route', !!res.ok);
  if (walk && walk.ok) {
    L.polyline(walk.coords, { color: '#6b7280', weight: 5, opacity: 0.8, dashArray: '2 10', lineCap: 'round', className: 'route-line' }).addTo(routeLayer);
  }
  if (!res.ok) return;
  L.polyline(res.coords, { color: '#ffffff', weight: 11, opacity: 0.9, className: 'route-line' }).addTo(routeLayer);
  const line = L.polyline(res.coords, { color: '#0b63ce', weight: 7, opacity: 0.95, className: 'route-line' }).addTo(routeLayer);
  for (const group of groupStops(routeStops(res))) {
    const label = group.map(({ stop, n }) => `${n}. ${stepText(stop)}`).join(' — ');
    const { lat, lon } = group[0].stop;
    L.marker([lat, lon], { icon: stopIcon(group), title: label, alt: label, zIndexOffset: 2000, keyboard: true })
      .bindTooltip(group.map(({ stop, n }) => `${n}. ${esc(stepText(stop))}`).join('<br>'), { direction: 'top', offset: [0, -18] })
      .addTo(routeLayer);
  }
  map.fitBounds(line.getBounds(), { padding: [40, 40], maxZoom: 18 });
}

function stepText(s) {
  if (s.type === 'entrance') return `${t('stationEntrance')}${s.name ? ` «\u00a0${s.name}\u00a0»` : ''}`;
  if (s.type === 'elevator') {
    const name = s.name ? ` «\u00a0${s.name}\u00a0»` : '';
    return `${t('takeElevator')}${name}`;
  }
  const isPath = ['footway', 'pedestrian', 'path', 'corridor', 'platform', 'crossing'].includes(s.highway);
  const name = s.name || (isPath ? t('unnamedPath') : t('unnamedRoad'));
  return `${t('walkOn')} ${name} – ${fmtDist(s.distance)}`;
}

function renderResult(res, walk) {
  const box = $('result');
  if (!res.ok) {
    const msg = res.reason === 'no-network' ? t('noNetwork') : res.reason === 'unknown-point' ? t('unknownPoint') : t('noPath');
    box.innerHTML = `<p class="error">${esc(msg)}</p>${res.reason === 'no-path' && $('opt-hours').checked ? `<p class="hint">${esc(t('noPathHours'))}</p>` : ''}`;
    return;
  }
  const minutes = Math.max(1, Math.round(res.distance / WHEELCHAIR_SPEED + res.elevators.length * ELEVATOR_TIME));
  const elev = res.elevators.length
    ? `<ul class="step-list">${res.elevators.map((e) => {
      const cls = e.open === true ? 'open' : e.open === false ? 'closed' : 'unknown';
      const lab = e.open === true ? t('open') : e.open === false ? t('closed') : t('hoursUnknown');
      const lvl = e.level ? ` (${t('level').toLowerCase()} ${e.level})` : '';
      return `<li>${esc((e.name || t('elevator')) + lvl)} <span class="badge ${cls}">${esc(lab)}</span>${e.opening_hours ? ` <span class="hint">${esc(e.opening_hours)}</span>` : ''}</li>`;
    }).join('')}</ul>`
    : `<p class="hint">${esc(t('noElevator'))}</p>`;
  const warns = [...res.warnings.map((w) => t(`warn_${w}`)), t('warnData')];
  const stops = routeStops(res);
  const steps = res.steps.map((s) => {
    const k = stops.indexOf(s);
    const num = k >= 0 ? `<span class="route-stop-num inline" aria-hidden="true">${k + 1}</span> ` : '';
    return `<li class="${s.type === 'elevator' ? 'elev' : s.type === 'entrance' ? 'entr' : ''}">${num}${esc(stepText(s))}</li>`;
  }).join('');
  box.innerHTML = `
    <div class="summary">
      <div><span class="k">${esc(t('distance'))}</span><span class="v">${esc(fmtDist(res.distance))}</span></div>
      <div><span class="k">${esc(t('duration'))}</span><span class="v">${esc(t('minutes', { n: minutes }))}</span></div>
    </div>
    ${walk && walk.ok ? `<p class="walk-compare">${esc(t('walkCompare', { d: fmtDist(walk.distance) }))}</p>` : ''}
    <h4>${esc(t('elevatorsUsed'))}</h4>${elev}
    <h4>${esc(t('warnings'))}</h4><ul class="warn-list">${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
    <details><summary><strong>${esc(t('steps'))}</strong></summary><ol class="step-list">${steps}</ol></details>
    ${state.activeTrip ? '' : `<p><button id="copy-json" class="btn btn-small" type="button">${esc(t('copyJson'))}</button></p>`}`;
  $('copy-json')?.addEventListener('click', copyItinerary);
}

function copyItinerary() {
  const round = (x) => +x.toFixed(5);
  const destKey = Object.entries(state.itineraries.destinations)
    .find(([, d]) => Math.abs(d.lat - state.to.lat) < 1e-6 && Math.abs(d.lon - state.to.lon) < 1e-6)?.[0];
  const block = {
    id: `trajet-${Date.now().toString(36)}`,
    name: { fr: 'Nouveau trajet → Yacht Club', en: 'New route → Yacht Club' },
    from: { lat: round(state.from.lat), lon: round(state.from.lon), label: { fr: 'Départ', en: 'Start' } },
    to: destKey || { lat: round(state.to.lat), lon: round(state.to.lon) },
  };
  const text = JSON.stringify(block, null, 2);
  const done = () => { $('status').textContent = t('copied'); setTimeout(() => { $('status').textContent = ''; }, 2500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => window.prompt('JSON', text));
  else window.prompt('JSON', text);
}

function clearRoute() {
  state.from = null; state.to = destinationPoint('ycm'); state.via = []; state.activeTrip = null;
  routeLayer.clearLayers();
  document.getElementById('map').classList.remove('has-route');
  $('result').innerHTML = '';
  $('ors-result').textContent = '';
  renderTrips();
  renderEndpoints();
}

// ---------------------------------------------------------------- OpenRouteService (optionnel)
async function compareOrs() {
  const key = $('ors-key').value.trim();
  const out = $('ors-result');
  if (!key || !state.from || !state.to) return;
  store('orsKey', key);
  out.textContent = t('computing');
  const coords = [state.from, ...state.via.map((v) => state.router.resolve(v)).filter(Boolean), state.to].map((p) => [p.lon, p.lat]);
  try {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/wheelchair/geojson', {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: coords }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    const feat = json.features[0];
    L.geoJSON(feat, { style: { color: '#d97706', weight: 5, opacity: 0.9, dashArray: '10 6', className: 'route-line' } }).addTo(routeLayer);
    out.textContent = t('orsResult', { d: fmtDist(feat.properties.summary.distance) });
  } catch (err) {
    out.textContent = t('orsError', { e: err.message });
  }
}

// ---------------------------------------------------------------- Panneau, onglets, langue
function setPanelCollapsed(collapsed) {
  const panel = $('panel');
  panel.classList.toggle('collapsed', collapsed);
  $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('panel-toggle').setAttribute('aria-label', t(collapsed ? 'showPanel' : 'hidePanel'));
  setTimeout(() => map.invalidateSize(), 50);
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((x) => {
      const on = x === tab;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      $(x.getAttribute('aria-controls')).hidden = !on;
    });
    setPanelCollapsed(false);
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
}

function refreshLanguage() {
  applyStatic();
  document.title = t('title');
  $('lang-btn').setAttribute('lang', getLang() === 'fr' ? 'en' : 'fr');
  renderTrips();
  renderEndpoints();
  if (state.pois) renderLayerList();
  if (state.network) $('data-date').textContent = t('dataDate', { d: new Date(state.network.generated).toLocaleDateString(getLang()) });
  if (state.lastResult) calculate();
  if (state.picking) $('pick-hint').textContent = t(state.picking === 'from' ? 'pickFromHint' : 'pickToHint');
}

function localDateTimeValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function bindUi() {
  setupTabs();
  $('lang-btn').addEventListener('click', () => { setLang(getLang() === 'fr' ? 'en' : 'fr'); refreshLanguage(); });
  $('panel-toggle').addEventListener('click', () => setPanelCollapsed(!$('panel').classList.contains('collapsed')));
  $('pick-from').addEventListener('click', () => startPicking('from'));
  $('pick-to').addEventListener('click', () => startPicking('to'));
  $('calc-btn').addEventListener('click', calculate);
  $('clear-btn').addEventListener('click', clearRoute);
  $('ors-btn').addEventListener('click', compareOrs);
  ['opt-steep', 'opt-hours', 'opt-date', 'opt-walk'].forEach((id) => $(id).addEventListener('change', () => { if (state.lastResult) calculate(); }));
  $('opt-date').value = localDateTimeValue(new Date());
  $('ors-key').value = recall('orsKey') || '';
  $('locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setPoint('from', pos.coords.latitude, pos.coords.longitude, { fr: 'Ma position', en: 'My location' }),
      (err) => { $('status').textContent = err.message; setTimeout(() => { $('status').textContent = ''; }, 3000); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.picking) startPicking(null); });
}

// ---------------------------------------------------------------- Démarrage
async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function init() {
  setLang(getLang());
  bindUi();
  refreshLanguage();
  $('status').textContent = t('loading');
  try {
    const [network, pois, itineraries] = await Promise.all([
      loadJson('data/network.json'), loadJson('data/pois.geojson'), loadJson('data/itineraries.json'),
    ]);
    state.network = network;
    state.pois = pois;
    state.itineraries = itineraries;
    state.router = new Router(network);
    state.to = destinationPoint('ycm');
    buildLayers();
    refreshLanguage();
    $('status').textContent = '';
  } catch (err) {
    console.error(err);
    $('status').textContent = t('loadError');
  }
}

init();
