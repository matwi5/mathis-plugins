# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième.

---

## 0.1.0 — 2026-11-16

### Ajouté
- **Décor « Morkie à Paris »** : un petit chien et un chat en pixel art se rencontrent sur un quai de Seine, devant la tour Eiffel (flair, petits sauts, poursuites, pause assis côte à côte) ; scène de jour en mode clair, de nuit en mode sombre, ou selon l'heure du poste (jour de 8 h à 21 h).
- **Horloge de rue** dans le décor de Paris, dont les aiguilles donnent l'heure du poste.
- **Le rat de la demie** : une fois par heure, à la demie, un rat traverse la rue de Paris ; le chien et le chat le voient et le prennent en chasse. `/decor rat` rejoue la poursuite tout de suite.
- **Scintillement de la tour Eiffel**, la nuit : cinq minutes à chaque heure pile, calé sur l'heure du poste.
- **Décor « Frissons 80 »** : la lisière d'une petite ville, une nuit des années 80 : des enfants à vélo, une bête sortie d'une faille, un orage rouge, une maison à la guirlande ; le thème de l'app en clair ou en sombre, ou selon l'heure, sous le même décor de nuit.
- **Commande `/decor`** : choisit le décor (`paris`, `frissons`), la scène de Paris (`auto`, `jour`, `nuit`, `heure`), le voile (0 à 95 %) et le flou (0 à 16) ; chaque décor garde les siens, de jour et de nuit, d'une session à l'autre.
- **Couleurs de l'app** accordées à chaque décor, en clair et en sombre pour Paris, en sombre pour Frissons 80.
- **Bandeaux aérés** : un peu d'espace entre les lignes des bandeaux des autres mods ; `/decor bandeaux non` les resserre.
- **Voile des bandeaux** : `/decor fond` pose un voile de plus sous les bandeaux seuls, gardé par lumière (aucun au départ).
