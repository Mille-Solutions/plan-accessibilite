# Carte PMR Monaco – Photos des ascenseurs

Mis à jour le 16 novembre 2026

Une commande rattache vos photos aux ascenseurs grâce à leur position GPS, et crée des versions allégées et nettoyées pour le web. Les photos apparaissent ensuite dans la fiche de l'ascenseur et en miniature dans la feuille de route, et s'agrandissent en plein écran au toucher. Seules les photos que vous avez validées sont visibles du public.

Le code est dans le dépôt [Mille-Solutions/plan-accessibilite](https://github.com/Mille-Solutions/plan-accessibilite) ; les commandes se lancent dans le Terminal d'un Mac, depuis le dossier `plan-accessibilite`. La mise en ligne est décrite dans [Mise en ligne HTTPS](mise-en-ligne-https.md).

## Prendre les photos

- Activer la localisation de l'appareil photo : Réglages → Confidentialité et sécurité → Service de localisation → Appareil photo.
- Prendre 2 ou 3 photos par ascenseur : l'accès vu de la rue avec un repère reconnaissable, la porte, éventuellement les boutons ou la signalétique.
- Éviter les personnes reconnaissables (droit à l'image).
- En sous-sol, il n'y a pas de signal GPS : prendre une photo dehors à l'entrée, ou renommer le fichier avec l'identifiant de l'ascenseur (voir l'étape 4 ci-dessous).

## Importer les photos

1. Copier les photos telles quelles (HEIC de l'iPhone, JPEG ou PNG) dans le dossier `photos/originaux/` du projet. Ce dossier n'est jamais publié : les originaux contiennent votre position et le modèle du téléphone.
2. Lancer l'import dans un terminal, depuis le dossier du projet :

   ```bash
   cd ~/git/plan-accessibilite
   node scripts/import-photos.mjs
   ```
3. Lire le rapport : une ligne par nouvelle photo.

   ```text
   OK          IMG_0001.jpg → Saint Dévote / Belgique [node/6509083173] (GPS, 1 m)
   À VÉRIFIER  IMG_0002.jpg → (sans nom) [way/1416847299] (GPS, 7 m) — « node/13019850360 » à 7 m aussi
   SANS-GPS    IMG_0004.jpg → —
   ```
   - **OK** : l'ascenseur le plus proche est à 30 m au plus, et aucun autre ascenseur ne se trouve à moins de 10 m près.
   - **À VÉRIFIER** : l'ascenseur proposé est à plus de 30 m, ou un autre est presque aussi proche. C'est fréquent autour de la gare, où 5 ascenseurs se trouvent dans un rayon d'environ 50 m.
   - **SANS-GPS** : la photo n'a pas de position ; il faut indiquer l'ascenseur à la main.
4. Pour forcer le rapprochement, mettre l'identifiant OpenStreetMap de l'ascenseur dans le nom du fichier, par exemple `1870233769-porte.jpg`. L'identifiant figure dans le lien « Voir / corriger sur OpenStreetMap » de la fiche de l'ascenseur. Il passe avant le GPS.

## Vérifier et valider

1. Démarrer la carte en local (voir l'aide-mémoire) et ouvrir http://localhost:8765/?verif=photos. Chaque photo apparaît à l'endroit où elle a été prise, reliée par un pointillé à l'ascenseur proposé : vert si validée, orange si à vérifier. Un clic montre la photo et l'ascenseur.
2. Ouvrir `data/photos.json` dans un éditeur de texte. Pour chaque photo à corriger, remplacer `"osm"` par le bon ascenseur (par exemple `"node/13019850360"`), puis passer `"status"` à `"ok"`.
3. Facultatif : ajouter une légende en français et en anglais, par exemple `"caption": {"fr": "Entrée côté boulevard de Belgique, à droite de la pharmacie", "en": "Entrance on Boulevard de Belgique, right of the pharmacy"}`.
4. Recharger la carte pour voir le résultat, puis publier (voir l'aide-mémoire).

## Bon à savoir

- Relancer l'import après une nouvelle séance photo est sans risque : le script ne touche jamais aux photos déjà importées, vos corrections sont conservées.
- Pour refaire le rapprochement d'une photo : supprimer son entrée dans `data/photos.json` et relancer l'import.
- Pour retirer une photo : la supprimer de `photos/originaux/` et relancer l'import ; elle disparaît de la carte et de `photos/web/`.
- Les versions web (1 600 px et miniature 600 px) sont redressées et ne contiennent plus de métadonnées : ni position, ni modèle de téléphone, ni date.
- Le script ne fonctionne que sur Mac : il utilise `sips`, l'outil d'images intégré à macOS.

## Aide-mémoire des commandes

Toutes les commandes se lancent depuis le dossier du projet, dans le Terminal du Mac.

| Pour… | Commande |
| --- | --- |
| Aller dans le dossier du projet | `cd ~/git/plan-accessibilite` |
| Démarrer la carte en local (ordinateur : http://localhost:8765 ; téléphone sur le même Wi-Fi : http://192.168.1.64:8765) | `python3 scripts/serve.py` |
| Arrêter le serveur local | Ctrl + C dans le terminal |
| Importer de nouvelles photos | `node scripts/import-photos.mjs` |
| Régénérer les images web de toutes les photos | `node scripts/import-photos.mjs --force` |
| Vérifier les rapprochements sur la carte | ouvrir http://localhost:8765/?verif=photos |
| Lancer les tests | `node --test tests/` |
| Publier les photos sur GitHub | `git add -A`, puis `git commit -m "Photos des ascenseurs"`, puis `git push` |

L'adresse 192.168.1.64 est celle de l'ordinateur sur le réseau local au 15 novembre 2026 ; elle peut changer. Pour la retrouver : `ipconfig getifaddr en0`.
