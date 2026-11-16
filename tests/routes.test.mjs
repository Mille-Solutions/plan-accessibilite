// Validation du calcul d'itinéraire sur les trajets de référence (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Router } from '../js/router.js';
import { FLAGS } from '../js/network-builder.js';
import { isOpen } from '../js/hours.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
const network = read('data/network.json');
const { itineraries, destinations } = read('data/itineraries.json');
const router = new Router(network);
const MONDAY_10H = new Date('2026-11-16T10:00:00');

for (const it of itineraries) {
  test(`trajet de référence « ${it.name.fr} »`, () => {
    const res = router.route({ from: it.from, via: it.via || [], to: destinations[it.to], options: { date: MONDAY_10H } });
    assert.ok(res.ok, `aucun itinéraire (${res.reason}, étape ${res.leg})`);
    for (const e of res.pathEdges) {
      const f = network.edges[5 * e + 3];
      assert.equal(f & (FLAGS.STEPS | FLAGS.ESCALATOR | FLAGS.WHEELCHAIR_NO), 0, 'le trajet emprunte des escaliers');
    }
    assert.ok(res.distance > 200 && res.distance < 4000, `distance inattendue : ${res.distance} m`);
    console.log(`  ${it.id}: ${res.distance} m, ${res.elevators.length} ascenseur(s)`);
  });
}

test('le trajet 1 traverse la gare par la galerie Sainte-Dévote, sans détour', () => {
  const it = itineraries.find((x) => x.id === 'belgique-gare');
  const res = router.route({ from: it.from, via: it.via, to: destinations[it.to], options: { date: MONDAY_10H } });
  assert.ok(res.ok);
  assert.ok(res.elevators.some((e) => e.name === 'Saint Dévote / Belgique'), 'ascenseur Sainte-Dévote / Belgique absent');
  assert.equal(res.elevators.length, 1, 'ascenseur compté en double');
  assert.ok(res.steps.some((s) => s.type === 'entrance' && s.name === 'Port Hercule'), 'sortie Port Hercule absente');
  assert.ok(res.steps.some((s) => s.name === 'Galerie Sainte-Dévote'), 'galerie Sainte-Dévote absente');
  // ~950 m depuis que l'arrivée se fait au niveau du quai (761 m quand elle aboutissait, à tort, sur le trottoir du boulevard)
  assert.ok(res.distance < 1100, `trajet trop long : ${res.distance} m`);
});

// Entrées de gare accessibles sans marches d'après OSM. « Place Sainte-Devote » (13019850394)
// n'est reliée qu'à des escaliers dans OSM : elle est volontairement absente de cette liste.
const STEP_FREE_ENTRANCES = {
  'Saint Dévote / Belgique': 6509083173,
  'Parvis Sainte-Devote': 1690189840,
  'Fontvielle / Le Rocher': 6865960165,
};

test('les entrées accessibles de la gare sont reliées à la sortie Port Hercule sans escaliers', () => {
  for (const [name, id] of Object.entries(STEP_FREE_ENTRANCES)) {
    const res = router.route({ from: { entrance: id }, to: { entrance: 4326086615 }, options: { respectHours: false } });
    assert.ok(res.ok, `entrée « ${name} » non reliée à la sortie Port Hercule`);
  }
});

test('sans contrainte fauteuil, le trajet peut être plus court (escaliers autorisés)', () => {
  const it = itineraries.find((x) => x.id === 'adagio');
  const pmr = router.route({ from: it.from, to: destinations.ycm });
  const walk = router.route({ from: it.from, to: destinations.ycm, options: { wheelchair: false, avoidSteep: false } });
  assert.ok(walk.ok && pmr.ok);
  assert.ok(walk.distance <= pmr.distance);
});

test('horaires des ascenseurs', () => {
  assert.equal(isOpen('24/7', MONDAY_10H), true);
  assert.equal(isOpen('Mo-Su 06:00-23:00', new Date('2026-11-16T23:30:00')), false);
  assert.equal(isOpen('Mo-Su 06:00-01:00', new Date('2026-11-17T00:30:00')), true);
  assert.equal(isOpen('Mo-Fr 07:00-21:00; Sa,Su off', new Date('2026-11-15T10:00:00')), false);
  assert.equal(isOpen('Mo-Fr 07:00-21:00; Sa,Su off', MONDAY_10H), true);
  assert.equal(isOpen('sunrise-sunset', MONDAY_10H), null);
  assert.equal(isOpen(null, MONDAY_10H), null);
});

test('l\'arrivée au Yacht Club se fait par le Quai Louis II (niveau du port)', () => {
  // Avant correction, l'arrivée se rattachait au trottoir du boulevard Louis II, une dizaine de mètres plus haut.
  const QUAI_LOUIS_II = 203711529;
  for (const from of [{ lat: 43.73705, lon: 7.4232 }, ...itineraries.map((it) => it.from)]) {
    const res = router.route({ from, to: destinations.ycm, options: { date: MONDAY_10H } });
    assert.ok(res.ok);
    const lastEdge = res.pathEdges[res.pathEdges.length - 1];
    assert.equal(network.ways[network.edges[5 * lastEdge + 4]].id, QUAI_LOUIS_II, `arrivée hors du quai depuis ${JSON.stringify(from)}`);
  }
});

test('rues superposées : avenue d\'Ostende au-dessus de l\'avenue J.-F. Kennedy', () => {
  const choices = router.levelChoices(43.73705, 7.4232);
  const names = choices.map((c) => c.name);
  assert.ok(names.includes('Avenue John F. Kennedy') && names.includes("Avenue d'Ostende"), `choix proposés : ${names.join(', ')}`);
  const ostende = choices.find((c) => c.name === "Avenue d'Ostende");
  const res = router.route({ from: { lat: 43.73705, lon: 7.4232, snapWays: ostende.ways }, to: destinations.ycm, options: { date: MONDAY_10H } });
  assert.ok(res.ok);
  // un point sans ambiguïté ne déclenche pas de question
  assert.deepEqual(router.levelChoices(43.74269, 7.42564), []);
});
