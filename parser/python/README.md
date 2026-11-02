# Parseur de cartes Python

Parseur sans dependances externes pour les projets JSON `faille-map` exportes
par Tilemap Studio. Il decode les images integrees en Data URL et expose les
assets, niveaux, calques, tuiles, objets, entites configurables et cellules de
collision sous forme de dataclasses Python. Les comportements de deplacement
reutilisables sont exposes dans `TilemapProject.behaviors`; chaque instance
d'entite les reference via `MapObject.behavior_id`. `EntityType.image_asset_id`
et `EntityType.image_region` indiquent l'image partagee du type et sa decoupe
facultative dans l'image source.

Python 3.10 ou plus recent est requis.

## Utilisation comme module

```python
from tilemap_parser import load_project

project = load_project("test/map-mondes.json")
level = project.current_level

print(level.name, level.map.width, level.map.height)
for obj in level.objects:
    print(obj.kind, obj.name, obj.x, obj.y)

image_bytes = project.assets[0].data
```

`load_project(path)` lit un fichier JSON et leve `TilemapParseError` en cas de
JSON invalide, d'image integree incorrecte ou de reference incoherente. Les
octets de chaque image sont disponibles dans `Asset.data`. Les champs JSON
dynamiques des entites sont conserves dans `MapObject.fields`.

Le parseur accepte egalement l'ancien format a niveau unique, lorsque les
donnees de la carte se trouvent a la racine du fichier. Il utilise uniquement
la bibliotheque standard de Python.

## Verifier un projet

Depuis ce dossier :

```sh
python tilemap_parser.py "../../test/map-mondes.json"
```

## Voir une entite se deplacer

L'exemple anime une plateforme sur un segment diagonal, puis la fait revenir
vers son point de depart. Le vecteur `deltaX` / `deltaY` definit l'extremite du
trajet et `speed` sa vitesse le long du segment. Il utilise uniquement Python
et Tkinter :

```sh
python visualiser_patrouille.py
```

Pour afficher la premiere entite en patrouille d'un projet exporte :

```sh
python visualiser_patrouille.py "../../test/mon-projet.json"
```

Espace met l'animation en pause ou la reprend, `R` la recommence et `Echap`
ferme la fenetre. La carte de demonstration et son comportement reutilisable
sont dans `examples/plateforme-patrouille.json`. Pour lancer un projet
personnalise, affectez un comportement de patrouille a une entite avec son
champ `behaviorId`. Les anciens projets avec une regle de patrouille sur le
type d'entite restent acceptes et sont convertis lors du chargement.
La simulation est reutilisable depuis `visualiser_patrouille.PatrolMotion`.

## Tests

```sh
python -m unittest -v
```
