<!-- PUBLIC -->
<!-- Section lue par les utilisateurs (notes de version, Discord...). Supprimer tout le bloc, marqueurs compris, si la PR ne change rien pour eux. -->
<Une phrase : ce qui change pour les utilisateurs.>

✨ **Nouveautés**
- <fonctionnalité, en langage utilisateur>

🐛 **Corrections**
- <problème corrigé, décrit par ce que l'utilisateur voit>

⚡ **Améliorations**
- <amélioration, décrite par son bénéfice>
<!-- INTERNAL -->

## Résumé

<Deux à quatre phrases : ce que fait la PR, pourquoi, et son ampleur (nouvelle fonctionnalité, lot de corrections, rupture de compatibilité ou non).>

## Projets concernés

<!-- Seulement si le dépôt contient plusieurs projets versionnés ; sinon supprimer la section. -->

| Projet | Version | Changements |
|---|---|---|
| <projet> | <vX.Y.Z> | <résumé> |

## Changements

### Fonctionnalités
- <changement, avec les composants, fonctions ou tables concernés>

### Corrections
- <référence du bug ou de l'issue si elle existe> <correction et cause>

### Refactoring
- <changement sans effet sur le comportement>

### Base de données
- <migration, nouvelle colonne, politique RLS, fonction>

### Documentation
- <fichiers de documentation mis à jour>

### Tests
- <tests ajoutés ou modifiés>

## Détails techniques

<Ce qu'un relecteur doit savoir et que le diff ne dit pas : choix d'architecture, compromis, déploiement, compatibilité (mise à jour OTA ou build natif, migration à appliquer), limites connues.>

## Vérification

<!-- Ne cocher que ce qui a réellement été lancé sur cette branche. -->
- [ ] <commande de test> : <résultat>
- [ ] <vérification manuelle> : <scénario>

## Risque

<!-- Le niveau dépend du changement, pas de son auteur. Un risque faible se justifie aussi. -->
<Faible, moyen ou élevé, et pourquoi : ce qui peut casser, pour qui, et ce qui le détecterait (tests, CI, journaux).>

## Comment revenir en arrière

<!-- Le geste qui annule ce changement une fois fusionné, et ce qu'il ne défait pas. -->
<Revert du commit de fusion, option à désactiver, migration à défaire, données à restaurer.>

## Tickets

<!-- `Closes #n` seulement pour une issue confirmée résolue ; sinon `Related to #n`. -->
