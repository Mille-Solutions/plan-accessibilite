# Carte d'accessibilité PMR – Monaco

Web app statique qui affiche les ascenseurs publics, les accès et cheminements accessibles
de Monaco et Beausoleil, et calcule des itinéraires **sans escaliers** vers le Yacht Club de Monaco.

Première version, construite à partir du plan « Carte d'accessibilité PMR – Monaco ».

**Version en ligne (HTTPS) : https://mille-solutions.github.io/plan-accessibilite/** — mise à jour
automatiquement par GitHub Pages à chaque push sur `main`.

## Guides

- [Mise en ligne HTTPS](docs/mise-en-ligne-https.md) : modes d'intégration au site du Yacht Club, géolocalisation, réglages iPhone.
- [Photos des ascenseurs](docs/photos-ascenseurs.md) : prise de vue, import, vérification et validation des photos.

## Lancer l'application

Les données sont chargées en `fetch`, il faut donc un petit serveur web (pas de `file://`) :

```bash
python3 scripts/serve.py 8765
```

puis ouvrir <http://localhost:8765>.

Après une modification de `css/` ou `js/`, changer le numéro `?v=` (dans `index.html`, `js/app.js` et
`js/router.js`) pour que les navigateurs, Safari notamment, téléchargent la nouvelle version.

## Charte graphique

L'interface reprend la charte du site du Navicap Challenge (Yacht Club de Monaco) : marine `#0a1f3c` /
`#022e5f`, bleu club `#134469`, cuivre `#a65b2a` en accent, titres en Outfit capitales, texte en Poppins.
Les couleurs sont définies en variables CSS en haut de [`css/style.css`](css/style.css) (thèmes clair et sombre),
avec des contrastes d'au moins 4,5:1.

## Ce que fait la v1

- **Carte Leaflet** sur fond OpenStreetMap, interface en français et en anglais.
- **Couches activables** : ascenseurs, entrées de la gare, escaliers mécaniques, rampes et pentes, escaliers (à éviter),
  toilettes PMR, stationnement PMR, trottoirs abaissés.
- **Fiche au clic** : nom, horaires (avec ouvert/fermé maintenant), accès fauteuil, niveaux, photo si
  renseignée dans OSM, lien pour corriger la donnée sur OpenStreetMap. Un ascenseur en pointillés
  n'est pas relié au réseau piéton dans OSM et n'est donc pas utilisé par le calcul d'itinéraire.
  Une entrée de gare en pointillés n'est accessible que par des escaliers d'après OSM
  (c'est le cas de « Place Sainte-Dévote »).
- **Itinéraire sans escaliers**, calculé dans le navigateur (Dijkstra sur le réseau piéton OSM) :
  - exclut escaliers, escalators, passages `wheelchair=no` et obstacles ;
  - exclut les pentes > 12 % et pénalise les pentes de 6 à 12 % (quand elles sont renseignées) ;
  - pénalise les chaussées sans trottoir et les revêtements irréguliers ;
  - tient compte des horaires d'ouverture des ascenseurs à l'heure de départ choisie ;
  - affiche distance, durée estimée, ascenseurs empruntés, points d'attention et feuille de route ;
  - peut afficher en comparaison le trajet piéton le plus court (avec escaliers).
- **Trajets de référence** (cas de test) : Bd de Belgique par la gare (ascenseur Sainte-Dévote / Belgique,
  galerie Sainte-Dévote, sortie Port Hercule), Adagio Beausoleil,
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
`{elevator: <id du nœud>}`, soit une entrée de gare OSM `{entrance: <id du nœud>}` (l'id figure dans le
lien OSM de la fiche). Entrées de la gare Monaco-Monte-Carlo : Saint Dévote / Belgique `6509083173`,
Port Hercule `4326086615`, Parvis Sainte-Dévote `1690189840`, Fontvieille / Le Rocher `6865960165`. Plus simple : tracer le trajet
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

## Imprimer un itinéraire / export PDF

Sous le résultat d'un itinéraire, le bouton **Imprimer / PDF** produit une fiche A4 d'une page : trajet,
distance, durée, heure de départ, carte du trajet avec les étapes numérotées, feuille de route (avec horaires
et photos des ascenseurs), points d'attention, et un QR code qui rouvre le trajet en ligne. Pour obtenir un
PDF, choisir « Enregistrer au format PDF » comme imprimante (sur iPhone : Partager → Imprimer, puis
Partager → Enregistrer dans Fichiers). Le menu Imprimer du navigateur (Cmd/Ctrl + P) donne la même fiche.

Liens directs (utilisés par le QR code) : `?trajet=<id>` ouvre un trajet de référence
(ex. `?trajet=belgique-gare`), `?de=lat,lon&a=lat,lon` un trajet libre, `&lang=en` force l'anglais.
Le QR code pointe vers l'adresse où la carte est ouverte : imprimer depuis la version en ligne (HTTPS),
pas depuis `localhost`, pour qu'il soit utile.

## Photos des ascenseurs et des entrées

Les photos aident à repérer un ascenseur depuis la rue. Elles s'affichent dans la fiche de l'ascenseur
et, en miniature, dans la feuille de route (touchez une photo pour l'agrandir).

1. Déposer les photos (JPEG, HEIC de l'iPhone, PNG) dans `photos/originaux/`. Ce dossier n'est **pas**
   publié : les originaux contiennent la position GPS et le modèle du téléphone.
2. Lancer l'import (macOS, utilise `sips`) :
   ```bash
   node scripts/import-photos.mjs
   ```
   Pour chaque nouvelle photo, le script lit la position GPS, propose l'ascenseur ou l'entrée de gare
   le plus proche, crée dans `photos/web/` une version 1600 px et une miniature 600 px **redressées et
   sans métadonnées**, et ajoute une entrée dans [`data/photos.json`](data/photos.json).
3. Vérifier les cas signalés `a-verifier` (plus de 30 m d'écart, ou un autre ascenseur à moins de 10 m
   près) ou `sans-gps` : ouvrir la carte avec `?verif=photos`
   (<http://localhost:8765/?verif=photos>) pour voir chaque photo reliée à l'ascenseur proposé, corriger
   `"osm"` dans `data/photos.json` si besoin, puis passer `"status"` à `"ok"`. **Seules les photos `ok`
   sont affichées au public.**
4. Facultatif : ajouter une légende (`"caption": {"fr": "…", "en": "…"}`), par exemple
   « Entrée côté boulevard de Belgique, à droite de la pharmacie ».

Le GPS d'un téléphone est souvent décalé de 10 à 30 m entre les immeubles, et il n'y a pas de signal en
sous-sol. Pour forcer le rapprochement, mettez l'identifiant OSM dans le nom du fichier
(`1870233769-porte.jpg`) : il figure dans le lien « Voir / corriger sur OpenStreetMap » de la fiche.

Le script ne modifie jamais une entrée existante (vos corrections sont conservées). Pour refaire le
rapprochement d'une photo, supprimez son entrée et relancez. Une photo retirée de `photos/originaux/`
est retirée de `data/photos.json` et de `photos/web/`.

Conseils de prise de vue : 2 ou 3 photos par ascenseur (l'accès vu de la rue avec un repère, la porte,
éventuellement les boutons), localisation activée pour l'appareil photo, et pas de personnes
reconnaissables.

## Tests

```bash
node --test tests/
```

Vérifie l'import des photos (lecture GPS, nettoyage des métadonnées, redressement, rapprochement), que les trajets de référence existent, n'empruntent aucun escalier, que le trajet 1 passe bien
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
