# Carte PMR Monaco – Mise en ligne HTTPS

Mis à jour le 16 novembre 2026

Ce guide explique comment mettre en ligne la carte PMR du Navicap Challenge en HTTPS pour que le bouton « Ma position » fonctionne. Le code est dans le dépôt [Mille-Solutions/plan-accessibilite](https://github.com/Mille-Solutions/plan-accessibilite) ; l'ajout des photos d'ascenseurs fait l'objet d'un guide séparé, [Photos des ascenseurs](photos-ascenseurs.md).

## Mise en ligne en HTTPS et géolocalisation

En HTTPS, la géolocalisation fonctionne sans rien modifier dans la carte. Les navigateurs ne donnent la position qu'aux sites sécurisés : sur le réseau local (http://192.168.1.64:8765), le bouton « Ma position » ne marche donc pas, mais tout le reste fonctionne. Au premier clic, le téléphone demande à la personne d'autoriser sa localisation.

Les en-têtes de sécurité du site du Yacht Club (vérifiés le 15 novembre 2026) ne bloquent ni la géolocalisation ni l'affichage de la carte dans une de leurs pages. Ce qu'il faut configurer dépend du mode d'intégration :

| Mode d'intégration | Ce qu'il faut faire | Géolocalisation |
| --- | --- | --- |
| Carte copiée sur le serveur du Yacht Club (ex. `/navicap/carte/`) | Copier tout le dossier, y compris `data/` et `photos/web/`. Recommandé : compression activée sur le serveur (`network.json` pèse 1 Mo). | Fonctionne telle quelle |
| Carte hébergée ailleurs (ex. GitHub Pages) et affichée dans une page du club via une iframe | Le club ajoute `allow="geolocation"` à l'iframe (code ci-dessous). | Bloquée sans cet attribut |
| Simple lien vers la carte hébergée ailleurs en HTTPS | Rien | Fonctionne telle quelle |

Code d'intégration en iframe, à coller dans la page du Yacht Club :

```html
<iframe src="https://…/plan-accessibilite/" allow="geolocation" style="width:100%;height:80vh;border:0"></iframe>
```

Le lien simple est le plus robuste sur mobile : la carte s'ouvre en plein écran.

**Côté iPhone.** La localisation doit être autorisée pour Safari : Réglages → Confidentialité et sécurité → Service de localisation → Sites web de Safari → « Lorsque l'app est active » (réglage par défaut). Si quelqu'un a refusé une première fois : bouton « aA » de la barre d'adresse → Réglages du site web → Position → Autoriser.

**Ressources externes.** La carte charge le fond de carte OpenStreetMap (tile.openstreetmap.org), les polices Outfit et Poppins (Google Fonts), et Leaflet (unpkg.com). Si le Yacht Club ajoute un jour une politique de sécurité du contenu (en-tête Content-Security-Policy) plus stricte, ces trois domaines devront y être autorisés, ainsi qu'api.openrouteservice.org si la comparaison OpenRouteService est utilisée.

**Après chaque mise à jour du code.** Changer le numéro `?v=` dans `index.html`, `js/app.js` et `js/router.js`, sinon Safari peut continuer d'afficher l'ancienne version.

## Aide-mémoire des commandes

Toutes les commandes se lancent depuis le dossier du projet, dans le Terminal du Mac.

| Pour… | Commande |
| --- | --- |
| Aller dans le dossier du projet | `cd ~/git/plan-accessibilite` |
| Démarrer la carte en local (ordinateur : http://localhost:8765 ; téléphone sur le même Wi-Fi : http://192.168.1.64:8765, sans géolocalisation) | `python3 scripts/serve.py` |
| Arrêter le serveur local | Ctrl + C dans le terminal |
| Mettre à jour les données OpenStreetMap | `node scripts/fetch-osm.mjs` |
| Lancer les tests | `node --test tests/` |
| Publier les changements sur GitHub | `git add -A`, puis `git commit -m "…"`, puis `git push` |

L'adresse 192.168.1.64 est celle de l'ordinateur sur le réseau local au 15 novembre 2026 ; elle peut changer. Pour la retrouver : `ipconfig getifaddr en0`.

Si Safari affiche une ancienne version après une mise à jour : recharger la page ; sinon l'ouvrir dans un onglet de navigation privée ; en dernier recours, Réglages → Apps → Safari → Avancé → Données des sites web, rechercher l'adresse du site et supprimer ses données.
