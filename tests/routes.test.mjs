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

test('le trajet 1 passe par les deux ascenseurs de la gare', () => {
  const it = itineraries.find((x) => x.id === 'belgique-gare');
  const res = router.route({ from: it.from, via: it.via, to: destinations[it.to], options: { date: MONDAY_10H } });
  const ids = res.elevators.map((e) => e.id);
  for (const v of it.via) assert.ok(ids.includes(v.elevator), `ascenseur ${v.elevator} absent`);
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
