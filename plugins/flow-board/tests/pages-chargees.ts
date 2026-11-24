// Un relevé chargé des pages « Idées », « À reprendre », « Pistes » et « Réglages » de la vue Coordination, et la liste
// figée des clés de lignes et de boutons que chacune en tire, lue sur le code d'avant leurs rectangles : le ticket qui les
// met en rectangles la relit pour prouver qu'aucune clé n'est perdue (une chose déplacée dans un rectangle garde sa clé).
// Un module d'aide, pas un fichier de test.

import { cooStatement, type CooStatement } from '../hooks/coo.ts'
import type { CooShown } from '../hooks/coo-view.tsx'
import { emptyBoard } from '../hooks/model.ts'
import { parseRoadmap } from '../hooks/roadmap.ts'

export const PAGES_NOW = 650_000_000

/** Un jalon, deux étapes, deux idées (une à lancer avec un complément, une plus tard), des choses à reprendre (à décider, rattachée, plus tard, un complément). */
const ROADMAP = `# Feuille de route

## Jalons
- [J1] en cours · 2026-11-02 · Alex · Le COO suit les missions — fin : chaque mission passe par lui
## Prochaines étapes
- [E1] à faire · 2026-11-03 · COO · Lancer le groupe C
- [E2] en cours · 2026-11-04 · COO · Relire le plan
## Idées
- [I1] à lancer · 2026-11-05 · Alex · une idée à lancer
- [I2] plus tard · 2026-11-06 · Alex · une idée pour plus tard
## À reprendre
- [R1] à décider · 2026-11-07 · mission « Mode auto », compte rendu · une chose à décider
- [R2] rattachée à M3 · 2026-11-08 · mission « Mode auto », revue · une chose rattachée
- [R3] plus tard · 2026-11-09 · mission « Mode auto », revue · une chose pour plus tard
- [R4] complète R1 · 2026-11-10 · mission « Mode auto », revue · un complément de R1
- [R5] complète I1 · 2026-11-11 · mission « Mode auto », revue · un complément de I1
`

/** Le relevé : la feuille de route ci-dessus (sur ce poste), une rétro à cocher (une piste prise ailleurs), des pistes en attente sur deux fichiers. */
export const loadedPages = (): CooStatement => {
  const s = cooStatement(emptyBoard('', 'p'), { now: PAGES_NOW })
  return {
    ...s,
    roadmap: { where: 'poste', path: '/x/feuille-de-route.md', read: parseRoadmap(ROADMAP), gone: [], isRepoLeft: true },
    retroPicks: [
      { retro: 'retro1', title: 'Rétro du mode auto', print: 'p1', items: [{ id: '1', label: 'Une piste', isTicked: true }, { id: '2', label: 'Une autre', isTicked: false }], taken: [{ id: '3', label: 'Prise', by: 'Mission B' }] },
    ],
    pistesWaiting: {
      rows: [
        { id: 'r/p1', state: 'pending', stateText: 'pas encore validée', retro: 'R', files: ['a.ts'], text: 'piste un', file: 'a.ts', isTickable: true, isTicked: false, texts: 0 },
        { id: 'r/p2', state: 'pending', stateText: 'pas encore validée', retro: 'R', files: ['a.ts'], text: 'piste deux', file: 'a.ts', isTickable: true, isTicked: true, texts: 0 },
        { id: 'r/p3', state: 'pending', stateText: 'pas encore validée', retro: 'R', files: [], text: 'piste trois', file: '', isTickable: true, isTicked: false, texts: 0 },
      ],
      more: 2,
      closed: 1,
      hidden: 3,
      ticked: 1,
      print: 'w',
      pending: 5,
    },
  } as unknown as CooStatement
}

/** Ce que montre chaque page figée : « À reprendre » avec l'entrée R1 et le complément R4 dépliés et « Plus tard » ouvert. */
export const PAGES_SHOWN: Record<'ideas' | 'pending' | 'pistes' | 'settings', CooShown> = {
  ideas: { page: 'ideas' },
  pending: { page: 'pending', open: 'R1 à décider', isLaterOpen: true },
  pistes: { page: 'pistes' },
  settings: { page: 'settings' },
}
