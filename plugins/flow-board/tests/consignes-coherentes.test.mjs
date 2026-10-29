// Les consignes recopiées sur plusieurs surfaces disent la même chose : la règle d'effort d'une
// session de groupe (xhigh) et la relecture du fond et de la forme vivent chacune dans la règle des
// lots, le README, les textes du mod et, selon le cas, la procédure ou la règle des revues ; 4 des
// 5 constats importants d'une revue de groupe étaient des copies qui divergeaient. Chaque surface
// porte les mots-clés de chaque consigne qu'elle recopie. Un test Node (node --test, lancé par
// scripts/check.sh) : il lit les sources, et les règles communes du dépôt quand elles sont là.

import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const at = file => new URL(`../${file}`, import.meta.url)
const read = file => readFileSync(at(file), 'utf8')
/** Une règle commune, à la racine du dépôt ; null hors du dépôt (plugin installé seul). */
const repoFile = file => (existsSync(at(`../../${file}`)) ? read(`../../${file}`) : null)

const SURFACES = {
  'config/rules/flow-board.md': repoFile('config/rules/flow-board.md'),
  'config/reference/revues.md': repoFile('config/reference/revues.md'),
  'reference/procedure-groupe.md': read('reference/procedure-groupe.md'),
  'README.md': read('README.md'),
  'hooks/register.tsx': read('hooks/register.tsx'),
}

/** Chaque consigne : ses mots-clés, et les surfaces qui la recopient (la procédure ne reçoit de la règle d'effort que la session autonome). */
const CONSIGNES = [
  {
    name: "l'effort d'une session de groupe",
    keywords: ['medium par défaut', 'xhigh (Recommandé) / high', 'tâche de jugement', "tâche d'exécution", 'session autonome'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/register.tsx'],
  },
  { name: 'la session autonome', keywords: ['session autonome', 'Session autonome'], surfaces: ['reference/procedure-groupe.md'] },
  {
    name: 'la relecture du fond et de la forme',
    keywords: ['Lecteur', 'relecture-fond-forme.md', 'fond et de la forme'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md', 'hooks/register.tsx'],
  },
]

for (const consigne of CONSIGNES) {
  test(`${consigne.name} : chaque surface qui la recopie en porte les mots-clés`, () => {
    const missing = []
    for (const surface of consigne.surfaces) {
      const text = SURFACES[surface]
      if (text === null) continue
      for (const keyword of consigne.keywords) if (!text.includes(keyword)) missing.push(`${surface} : « ${keyword} »`)
    }
    assert.deepEqual(missing, [], `mots-clés absents de ${consigne.name}`)
  })
}
