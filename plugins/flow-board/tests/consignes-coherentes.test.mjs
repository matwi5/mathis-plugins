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
  'config/rules/general.md': repoFile('config/rules/general.md'),
  'config/rules/asana-board.md': repoFile('config/rules/asana-board.md'),
  'GLOSSARY.md': repoFile('GLOSSARY.md'),
  'config/reference/revues.md': repoFile('config/reference/revues.md'),
  'reference/procedure-groupe.md': read('reference/procedure-groupe.md'),
  'README.md': read('README.md'),
  'hooks/register.tsx': read('hooks/register.tsx'),
  'hooks/catalog.ts': read('hooks/catalog.ts'),
  'hooks/view.tsx': read('hooks/view.tsx'),
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
  {
    // La liste des zones sensibles : la commande ou le chemin construit d'une valeur lue ailleurs y est partout
    // (en anglais, SENSITIVE_AREAS de catalog.ts, que model.ts reprend : test cadrage-zone-sensible et rappels-outil).
    name: 'la liste des zones sensibles',
    keywords: ["concurrence, commande ou chemin construit à partir d'une valeur lue ailleurs"],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md', 'hooks/register.tsx'],
  },
  {
    // Un groupe sans logique ni zone sensible : ni revue du groupe ni revue de sécurité, quel que soit son nombre de tickets.
    name: "les revues d'un groupe sans logique ni zone sensible",
    keywords: ['ni revue du groupe ni revue de sécurité'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md', 'hooks/register.tsx'],
  },
  {
    // Les correctifs de la passe « bogues » d'un ticket sensible : une seule nouvelle passe, en high, sur leur diff.
    name: 'la nouvelle passe sur les correctifs de la passe « bogues »',
    keywords: ['une seule nouvelle passe', 'limitée à leur diff'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md'],
  },
  {
    // Un texte qui fait agir Claude (une règle, une procédure, un skill) est « Logique : oui » : la règle des lots, le README, et la consigne de découpage en anglais.
    name: 'la logique d’un texte qui fait agir Claude',
    keywords: ['fait lancer une commande à Claude ou construire un chemin'],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  { name: 'la logique d’un texte qui fait agir Claude, en anglais', keywords: ['makes Claude act'], surfaces: ['hooks/register.tsx'] },
  {
    // Les pistes d'une rétro passent par le découpage en tickets : ses bornes et la règle des fichiers chargés partout.
    name: 'le découpage des pistes d’une rétro',
    keywords: ['1 à 3', 'un seul groupe', 'chaque phrase ajoutée ou retirée'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/register.tsx'],
  },
  {
    // La même règle dans les consignes en anglais : au découpage (register.tsx) et pendant l'implémentation (catalog.ts).
    name: "les revues d'un groupe sans logique ni zone sensible, en anglais",
    keywords: ['has neither a group review nor a security review'],
    surfaces: ['hooks/catalog.ts', 'hooks/register.tsx'],
  },
  {
    // Les six catégories qui restent à la personne en auto : la règle des lots, le premier clic sur « ⚡ Auto » (view.tsx), le README.
    name: 'les six catégories qui bloquent en mode auto',
    keywords: ['zone sensible', 'recommandation défendable', 'contredit une décision déjà prise', 'faille de sécurité sans correctif', 'effort xhigh', 'action externe hors du parcours'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/view.tsx'],
  },
  {
    // Les origines d'un choix déclaré en auto, et la notification au texte fixé : la règle des lots et le README.
    name: 'les choix et la notification du mode auto',
    keywords: ['« reco prise »', '« validation sautée »', 'PushNotification', "N question(s) t'attendent"],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  {
    // Ce que le second clic accorde : les validations sautées, la même liste dans la règle des lots, le glossaire et le README.
    name: 'les validations sautées du mode auto',
    keywords: ['accord du cadrage, spec, découpage, plan, écritures Asana du parcours'],
    surfaces: ['config/rules/flow-board.md', 'GLOSSARY.md', 'README.md'],
  },
  { name: 'les validations sautées du mode auto, en anglais', keywords: ['framing agreement, spec, ticket split, work plan', 'the tickets created, their statuses'], surfaces: ['hooks/register.tsx'] },
  {
    // Les écritures Asana que le second clic accorde : la règle Asana et le premier clic sur « ⚡ Auto ».
    name: 'les écritures Asana accordées en mode auto',
    keywords: ['création des tickets, statuts'],
    surfaces: ['config/rules/asana-board.md', 'hooks/view.tsx'],
  },
  {
    // Les exceptions du mode auto des règles communes ne valent que là où l'auto agit, et renvoient à la règle des lots.
    name: 'les exceptions du mode auto des règles communes',
    keywords: ["dans la discussion d'où l'auto agit", 'règle « Mode auto » du plugin `flow-board`', '« Confirmer »'],
    surfaces: ['config/rules/general.md', 'config/rules/asana-board.md'],
  },
  {
    // La session autonome et l'effort en mode auto : à tout effort, jamais xhigh proposé ; la vague suivante lancée par le mod.
    name: 'la session autonome et l’effort en mode auto',
    keywords: ['quel que soit son effort', 'ne propose jamais xhigh', 'le mod lance lui-même la vague suivante'],
    surfaces: ['config/rules/flow-board.md'],
  },
  { name: 'la session autonome en mode auto, au glossaire', keywords: ['quel que soit son effort', 'mode auto'], surfaces: ['GLOSSARY.md'] },
  {
    // Une session liée d'un parcours en mode auto est autonome à tout effort : la règle, la procédure, la demande de délégation, le README.
    name: 'la session autonome à tout effort en mode auto',
    keywords: ['quel que soit son effort'],
    surfaces: ['config/rules/flow-board.md', 'reference/procedure-groupe.md', 'hooks/register.tsx', 'README.md'],
  },
  {
    // Les mêmes, en anglais, dans la consigne du mode auto, avec ses deux origines de choix.
    name: 'les six catégories qui bloquent en mode auto, en anglais',
    keywords: ['a sensitive area', 'no defensible recommendation', 'contradicts DECISIONS.md', 'leaving a security finding unfixed', 'declare that xhigh was not offered', 'external action outside the run', '« reco prise »', '« validation sautée »'],
    surfaces: ['hooks/register.tsx'],
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
