// Calcul d'itinéraire PMR côté client (Dijkstra) sur le graphe produit par network-builder.js.
// Module ES sans dépendance, utilisé par l'application et par les tests Node.

import { FLAGS, haversine } from './network-builder.js?v=202611161156';
import { isOpen } from './hours.js?v=202611161156';

const DEFAULTS = {
  wheelchair: true,     // exclut escaliers, escalators, wheelchair=no, obstacles
  avoidSteep: true,     // exclut les pentes > 12 % et pénalise 6–12 %
  respectHours: true,   // exclut les ascenseurs fermés à l'heure demandée
  date: null,           // Date du trajet (défaut : maintenant)
  elevatorPenalty: 20,  // coût fixe d'un ascenseur, en mètres équivalents (attente)
};

const SNAP_RADIUS = 120; // m
// Seuls les nœuds à moins de (plus proche + SNAP_SLACK) sont candidats : sinon le trajet peut « sauter »
// d'un niveau à l'autre (ex. trottoir de l'avenue d'Ostende → quai du port, 10 m plus bas).
const SNAP_SLACK = 15; // m

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return [topK, topV];
  }
}

export class Router {
  constructor(network) {
    this.net = network;
    const n = network.nodes.length / 2;
    const m = network.edges.length / 5;
    this.nodeCount = n;
    // Adjacence au format CSR
    const deg = new Uint32Array(n + 1);
    for (let e = 0; e < m; e++) { deg[network.edges[5 * e]]++; deg[network.edges[5 * e + 1]]++; }
    this.adjStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjStart[i + 1] = this.adjStart[i] + deg[i];
    this.adj = new Uint32Array(this.adjStart[n]);
    const fill = this.adjStart.slice(0, n);
    for (let e = 0; e < m; e++) {
      this.adj[fill[network.edges[5 * e]]++] = e;
      this.adj[fill[network.edges[5 * e + 1]]++] = e;
    }
    // Index spatial en grille (~100 m)
    this.cell = 0.001;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = this._cellKey(network.nodes[2 * i], network.nodes[2 * i + 1]);
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    }
  }

  _cellKey(lat, lon) {
    return `${Math.floor(lat / this.cell)}:${Math.floor(lon / this.cell)}`;
  }

  lat(i) { return this.net.nodes[2 * i]; }
  lon(i) { return this.net.nodes[2 * i + 1]; }

  /** Coût d'un tronçon (Infinity = interdit). */
  edgeCost(e, opt) {
    const E = this.net.edges;
    const len = E[5 * e + 2] / 10;
    const f = E[5 * e + 3];
    if (opt.wheelchair) {
      if (f & (FLAGS.STEPS | FLAGS.ESCALATOR | FLAGS.WHEELCHAIR_NO)) return Infinity;
      if (opt.avoidSteep && (f & FLAGS.VERY_STEEP)) return Infinity;
    }
    let c = len;
    if (f & FLAGS.ELEVATOR) {
      if (opt.respectHours) {
        const info = this.net.elevators[`w${E[5 * e + 4]}`];
        if (info && isOpen(info.opening_hours, opt.date) === false) return Infinity;
      }
      return c + opt.elevatorPenalty;
    }
    if (opt.wheelchair) {
      if (opt.avoidSteep && (f & FLAGS.STEEP)) c *= 2.5;
      if (f & FLAGS.NO_SIDEWALK) c *= 3;
      else if (f & FLAGS.ROAD) c *= 1.15;
      if (f & FLAGS.ROUGH) c *= 2;
      if (f & FLAGS.WHEELCHAIR_LIMITED) c *= 1.3;
      if (f & FLAGS.WHEELCHAIR_YES) c *= 0.9;
    }
    return c;
  }

  /** Coût de passage par un nœud (Infinity = infranchissable). */
  nodeCost(i, opt) {
    const el = this.net.elevators[i];
    if (el) {
      if (opt.wheelchair && el.wheelchair === 'no') return Infinity;
      if (opt.respectHours && isOpen(el.opening_hours, opt.date) === false) return Infinity;
      return opt.elevatorPenalty;
    }
    if (opt.wheelchair && this.net.barriers[i]) return Infinity;
    return 0;
  }

  _usable(i, opt) {
    if (this.nodeCost(i, opt) === Infinity) return false;
    for (let k = this.adjStart[i]; k < this.adjStart[i + 1]; k++) {
      if (this.edgeCost(this.adj[k], opt) !== Infinity) return true;
    }
    return false;
  }

  /** Index de nœud de l'ascenseur OSM (nœud) d'identifiant donné, ou -1. */
  elevatorNode(osmId) {
    return this._findNode(this.net.elevators, osmId);
  }

  /** Index de nœud de l'entrée de gare OSM d'identifiant donné, ou -1. */
  entranceNode(osmId) {
    return this._findNode(this.net.entrances || {}, osmId);
  }

  _findNode(table, osmId) {
    for (const [k, v] of Object.entries(table)) {
      if (v.id === osmId && !v.way) return Number(k);
    }
    return -1;
  }

  /** Coordonnées d'un point {lat, lon}, {elevator: id} ou {entrance: id}. */
  resolve(point) {
    let i;
    if (point.elevator !== undefined) i = this.elevatorNode(point.elevator);
    else if (point.entrance !== undefined) i = this.entranceNode(point.entrance);
    else return point;
    if (i < 0) return null;
    return { ...point, lat: this.lat(i), lon: this.lon(i), node: i };
  }

  _pointCandidates(p, opt) {
    if (p.node !== undefined) return this.nodeCost(p.node, opt) === Infinity ? [] : [{ node: p.node, dist: 0 }];
    if (p.snapWays?.length) return this.wayCandidates(p, p.snapWays, opt);
    return this.candidates(p.lat, p.lon, opt);
  }

  /** Nœuds des voies OSM données (ex. le quai d'un bâtiment), les plus proches du point. */
  wayCandidates(p, wayIds, opt, max = 4) {
    const wanted = new Set(wayIds.map(Number));
    const E = this.net.edges;
    const seen = new Set();
    const out = [];
    for (let e = 0; e < E.length / 5; e++) {
      if (!wanted.has(this.net.ways[E[5 * e + 4]].id)) continue;
      for (const i of [E[5 * e], E[5 * e + 1]]) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (this._usable(i, opt)) out.push({ node: i, dist: haversine(p.lat, p.lon, this.lat(i), this.lon(i)) });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, max);
  }

  /** Nœuds candidats autour d'un point : [{ node, dist }] triés par distance. */
  candidates(lat, lon, opt, radius = SNAP_RADIUS, max = 12) {
    const out = [];
    const r = Math.ceil(radius / 111000 / this.cell) + 1;
    const ci = Math.floor(lat / this.cell), cj = Math.floor(lon / this.cell);
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const arr = this.grid.get(`${ci + di}:${cj + dj}`);
        if (!arr) continue;
        for (const i of arr) {
          const d = haversine(lat, lon, this.lat(i), this.lon(i));
          if (d <= radius && this._usable(i, opt)) out.push({ node: i, dist: d });
        }
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    if (!out.length && radius < 600) return this.candidates(lat, lon, opt, radius * 2.5, max);
    const limit = out.length ? out[0].dist + SNAP_SLACK : 0;
    return out.filter((c) => c.dist <= limit).slice(0, max);
  }

  _search(sources, targets, opt) {
    const n = this.nodeCount;
    const dist = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    for (const s of sources) {
      const c = s.dist * 1.5;
      if (c < dist[s.node]) { dist[s.node] = c; heap.push(c, s.node); }
    }
    const tgt = new Map(targets.map((t) => [t.node, t.dist * 1.5]));
    let best = Infinity, bestNode = -1;
    const E = this.net.edges;
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      if (d >= best) break;
      if (tgt.has(u)) {
        const total = d + tgt.get(u);
        if (total < best) { best = total; bestNode = u; }
      }
      for (let k = this.adjStart[u]; k < this.adjStart[u + 1]; k++) {
        const e = this.adj[k];
        const v = E[5 * e] === u ? E[5 * e + 1] : E[5 * e];
        const ec = this.edgeCost(e, opt);
        if (ec === Infinity) continue;
        const nc = this.nodeCost(v, opt);
        if (nc === Infinity) continue;
        const nd = d + ec + nc;
        if (nd < dist[v]) { dist[v] = nd; prevEdge[v] = e; heap.push(nd, v); }
      }
    }
    if (bestNode < 0) return null;
    const path = [bestNode];
    const pathEdges = [];
    let u = bestNode;
    while (prevEdge[u] >= 0) {
      const e = prevEdge[u];
      pathEdges.push(e);
      u = E[5 * e] === u ? E[5 * e + 1] : E[5 * e];
      path.push(u);
    }
    path.reverse();
    pathEdges.reverse();
    return { path, pathEdges, cost: best };
  }

  /**
   * Itinéraire de `from` à `to` en passant par `via` (points {lat, lon, label?}).
   * Renvoie { ok, coords, distance, elevators, warnings, steps, legs } ou { ok:false, reason, leg }.
   */
  route({ from, to, via = [], options = {} }) {
    const opt = { ...DEFAULTS, ...options };
    if (!opt.date) opt.date = new Date();
    const points = [from, ...via, to].map((p) => this.resolve(p));
    const missing = points.findIndex((p) => !p);
    if (missing >= 0) return { ok: false, reason: 'unknown-point', leg: Math.max(0, missing - 1) };
    const result = { ok: true, coords: [], distance: 0, elevators: [], warnings: new Set(), steps: [], legs: [], pathEdges: [] };
    for (let l = 0; l < points.length - 1; l++) {
      const a = points[l], b = points[l + 1];
      const src = this._pointCandidates(a, opt);
      const dst = this._pointCandidates(b, opt);
      if (a.node !== undefined && this.net.elevators[a.node]) this._noteViaElevator(a.node, opt, result);
      if (!src.length || !dst.length) return { ok: false, reason: 'no-network', leg: l };
      const found = this._search(src, dst, opt);
      if (!found) return { ok: false, reason: 'no-path', leg: l };
      const legCoords = [[a.lat, a.lon], ...found.path.map((i) => [this.lat(i), this.lon(i)]), [b.lat, b.lon]];
      if (result.coords.length) legCoords.shift();
      result.coords.push(...legCoords);
      const legDist = this._describe(found, opt, result);
      result.legs.push({ from: a, to: b, distance: legDist });
      result.distance += legDist;
    }
    result.warnings = [...result.warnings];
    result.distance = Math.round(result.distance);
    return result;
  }

  _addElevator(key, info, opt, result, node) {
    if (result.elevators.some((x) => x.key === key)) return;
    // Un même ascenseur est parfois cartographié par deux nœuds (rue et sous-sol) : on n'en compte qu'un
    const prev = result.elevators[result.elevators.length - 1];
    const last = result.steps[result.steps.length - 1];
    if (prev && info.name && prev.name === info.name && last &&
        (last.type === 'elevator' || (last.type === 'walk' && last.distance < 15))) return;
    const open = isOpen(info.opening_hours, opt.date);
    const lat = this.lat(node), lon = this.lon(node);
    const osm = `${info.way ? 'way' : 'node'}/${info.id}`;
    result.elevators.push({ key, osm, id: info.id, name: info.name, opening_hours: info.opening_hours, open, wheelchair: info.wheelchair, level: info.level, lat, lon });
    if (!info.opening_hours) result.warnings.add('elevator-hours-unknown');
    else if (open === null) result.warnings.add('elevator-hours-unparsed');
    result.steps.push({ type: 'elevator', osm, name: info.name, opening_hours: info.opening_hours, open, level: info.level, lat, lon });
  }

  _noteViaElevator(node, opt, result) {
    this._addElevator(`n${node}`, this.net.elevators[node], opt, result, node);
  }

  _describe(found, opt, result) {
    const E = this.net.edges;
    let dist = 0;
    const addElevator = (key, info, node) => this._addElevator(key, info, opt, result, node);
    const entrances = this.net.entrances || {};
    found.path.forEach((i, idx) => {
      if (this.net.elevators[i] && idx > 0 && idx < found.path.length - 1) addElevator(`n${i}`, this.net.elevators[i], i);
      if (entrances[i] && !result.steps.some((s) => s.key === `e${i}`)) {
        result.steps.push({ type: 'entrance', key: `e${i}`, osm: `node/${entrances[i].id}`, name: entrances[i].name, lat: this.lat(i), lon: this.lon(i) });
      }
      const e = found.pathEdges[idx];
      if (e === undefined) return;
      result.pathEdges.push(e);
      const len = E[5 * e + 2] / 10;
      const f = E[5 * e + 3];
      const way = this.net.ways[E[5 * e + 4]];
      dist += len;
      if (f & FLAGS.ELEVATOR) { addElevator(`w${E[5 * e + 4]}`, this.net.elevators[`w${E[5 * e + 4]}`] || { id: way.id, way: true }, i); return; }
      if (f & FLAGS.STEEP) result.warnings.add('steep');
      if (f & FLAGS.NO_SIDEWALK) result.warnings.add('no-sidewalk');
      if (f & FLAGS.ROUGH) result.warnings.add('rough');
      if (f & (FLAGS.STEPS | FLAGS.ESCALATOR)) result.warnings.add('steps');
      const name = way.name || null;
      const last = result.steps[result.steps.length - 1];
      if (last && last.type === 'walk' && last.name === name) last.distance += len;
      else result.steps.push({ type: 'walk', name, highway: way.highway, distance: len });
    });
    // fusion des petits tronçons sans nom dans le précédent pour une feuille de route lisible
    result.steps = result.steps.filter((s, k, arr) => {
      if (s.type === 'walk' && !s.name && s.distance < 25 && k > 0 && arr[k - 1].type === 'walk') { arr[k - 1].distance += s.distance; return false; }
      return true;
    });
    return dist;
  }
}
