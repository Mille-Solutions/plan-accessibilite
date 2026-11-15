# Carte d'accessibilité PMR – Monaco

Web app statique qui affiche les ascenseurs publics, les accès et cheminements accessibles
de Monaco et Beausoleil, et calcule des itinéraires **sans escaliers** vers le Yacht Club de Monaco.

Première version, construite à partir du plan « Carte d'accessibilité PMR – Monaco ».

## Lancer l'application

Les données sont chargées en `fetch`, il faut donc un petit serveur web (pas de `file://`) :

```bash
python3 -m http.server 8765
```

puis ouvrir <http://localhost:8765>.

## Ce que fait la v1

- **Carte Leaflet** sur fond OpenStreetMap, interface en français et en anglais.
- **Couches activables** : ascenseurs, escaliers mécaniques, rampes et pentes, escaliers (à éviter),
  toilettes PMR, stationnement PMR, trottoirs abaissés.
- **Fiche au clic** : nom, horaires (avec ouvert/fermé maintenant), accès fauteuil, niveaux, photo si
  renseignée dans OSM, lien pour corriger la donnée sur OpenStreetMap. Un ascenseur en pointillés
  n'est pas relié au réseau piéton dans OSM et n'est donc pas utilisé par le calcul d'itinéraire.
- **Itinéraire sans escaliers**, calculé dans le navigateur (Dijkstra sur le réseau piéton OSM) :
  - exclut escaliers, escalators, passages `wheelchair=no` et obstacles ;
  - exclut les pentes > 12 % et pénalise les pentes de 6 à 12 % (quand elles sont renseignées) ;
  - pénalise les chaussées sans trottoir et les revêtements irréguliers ;
  - tient compte des horaires d'ouverture des ascenseurs à l'heure de départ choisie ;
  - affiche distance, durée estimée, ascenseurs empruntés, points d'attention et feuille de route ;
  - peut afficher en comparaison le trajet piéton le plus court (avec escaliers).
- **Trajets de référence** (cas de test) : Bd de Belgique par les ascenseurs de la gare, Adagio Beausoleil,
  Odalys Beausoleil, Beausoleil près de la Tour Odéon → Yacht Club.
- **Mon trajet** : départ / arrivée posés sur la carte (ou « Ma position »), marqueurs déplaçables.
- **OpenRouteService (optionnel)** : avec une clé API gratuite, comparaison avec leur profil « wheelchair ».

Reporté à plus tard (cf. plan) : signalement d'ascenseur en panne, PWA hors ligne, italien.

## Ajouter un itinéraire vers le Yacht Club

Éditer [`data/itineraries.json`](data/itineraries.json) et ajouter un bloc dans `itineraries` :

```json
{
  "id": "mon-trajet",
  "name": { "fr": "Mon départ → Yacht Club", "en": "My start → Yacht Club" },
  "from": { "lat": 43.7400, "lon": 7.4200, "label": { "fr": "Mon départ", "en": "My start" } },
  "via": [ { "elevator": 1870233769, "label": { "fr": "Ascenseur X", "en": "Lift X" } } ],
  "to": "ycm"
}
```

`via` est facultatif : un point de passage est soit des coordonnées `{lat, lon}`, soit un ascenseur OSM
`{elevator: <id du nœud>}` (l'id figure dans le lien OSM de la fiche). Plus simple : tracer le trajet
dans l'application avec « Mon trajet », puis cliquer sur **Copier pour itineraries.json**.

Pour une autre destination, l'ajouter dans `destinations` et y faire référence par sa clé dans `to`.

## Mettre à jour les données OpenStreetMap

```bash
node scripts/fetch-osm.mjs
```

Le script interroge l'API Overpass sur la zone Monaco + Beausoleil et régénère :

- `data/network.json` : graphe piéton compact (nœuds, tronçons avec drapeaux escalier/pente/ascenseur…) ;
- `data/pois.geojson` : points d'intérêt PMR des couches.

`--from-cache` reconstruit ces fichiers à partir de la dernière réponse brute (`data/raw/`, non versionné).
Après une correction dans OpenStreetMap, relancer le script pour en profiter.

## Tests

```bash
node --test tests/
```

Vérifie que les trajets de référence existent, n'empruntent aucun escalier, que le trajet 1 passe bien
par les deux ascenseurs de la gare, et l'interprétation des horaires d'ouverture.

## Limites connues

- Les **pentes** ne sont prises en compte que si le tag `incline` est renseigné dans OSM : une rue en
  pente non taguée est considérée comme plate. À vérifier sur le terrain (étape 1 du plan).
- La plupart des ascenseurs n'ont **pas d'horaires** dans OSM : ils sont considérés comme ouverts et
  signalés « horaires inconnus ». Compléter `opening_hours` dans OSM depuis les sources officielles.
- Les **horaires** sont interprétés de façon simplifiée (jours, plages, passage de minuit ; pas de jours fériés).
- Pas d'information en temps réel sur les pannes.

## Structure

```
index.html            page unique
css/style.css         styles (mobile d'abord, contraste élevé, mode sombre)
js/app.js             carte, couches, interface
js/router.js          calcul d'itinéraire PMR (partagé navigateur / Node)
js/network-builder.js construction du graphe piéton depuis Overpass
js/poi-extractor.js   extraction des points d'intérêt
js/hours.js           interprétation des horaires opening_hours
js/i18n.js            textes FR / EN
data/                 données générées + itinéraires
scripts/fetch-osm.mjs collecte OSM
tests/                tests Node
```

Données © contributeurs OpenStreetMap, licence ODbL.
