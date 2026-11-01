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
  'to-spec/SKILL.md': repoFile('plugins/mattpocock-skills/skills/engineering/to-spec/SKILL.md'),
  'to-tickets/SKILL.md': repoFile('plugins/mattpocock-skills/skills/engineering/to-tickets/SKILL.md'),
  'docs/evenements-moteur.md': repoFile('docs/evenements-moteur.md'),
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
    // Les écritures Asana que le second clic accorde : la règle « Mode auto » des lots et le premier clic sur « ⚡ Auto ».
    name: 'les écritures Asana accordées en mode auto',
    keywords: ['création des tickets, statuts'],
    surfaces: ['config/rules/flow-board.md', 'hooks/view.tsx'],
  },
  {
    // Les règles chargées partout ne recopient pas les exceptions du mode auto : un renvoi au bloc de la consigne, qui les porte.
    name: 'le renvoi au bloc « mode auto » des règles communes',
    keywords: ["En mode auto, le bloc « mode auto » de la consigne flow-board l'emporte"],
    surfaces: ['config/rules/general.md', 'config/rules/asana-board.md', 'config/rules/flow-board.md'],
  },
  {
    // La session autonome et l'effort en mode auto : à tout effort, jamais xhigh proposé ; les groupes suivants lancés par le mod.
    name: 'la session autonome et l’effort en mode auto',
    keywords: ['quel que soit son effort', 'ne propose jamais xhigh', 'le mod lance lui-même les groupes suivants', 'jamais par une question à boutons'],
    surfaces: ['config/rules/flow-board.md'],
  },
  {
    // Un ticket qui modifie une règle, une référence ou un skill a de la logique (étape slice de catalog.ts) :
    // la règle des lots et la règle des revues le disent, et plus aucune surface ne dit qu'une règle n'en a pas.
    name: 'la logique d’un ticket qui modifie une règle, une référence ou un skill',
    keywords: ['ticket qui modifie les règles communes (`config/rules`), un fichier de référence ou un skill', 'ces textes guident ce que fait Claude'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md'],
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
  {
    // Les cas du cycle de vie d'un champ persisté, posés au cadrage plutôt que ticket par ticket pendant
    // l'implémentation : les deux skills de cadrage et les étapes de /to-spec et /to-tickets (catalog.ts).
    name: 'les cas du cycle de vie d’un champ persisté',
    keywords: ['a failed read', 'a failed write', 'its bounds', 'the erasure of what must be kept', 'a forged copy', 'each transition of the object that carries a mark (sent, cancelled, sent again, back)'],
    surfaces: ['to-spec/SKILL.md', 'to-tickets/SKILL.md', 'hooks/catalog.ts'],
  },
  {
    // Un critère d'un ticket sensible qui contredisait son invariant n'était vu qu'à l'implémentation.
    name: 'la relecture des critères d’un ticket sensible contre son invariant',
    keywords: ['against its invariant'],
    surfaces: ['to-tickets/SKILL.md', 'hooks/catalog.ts'],
  },
  {
    // Deux constats importants d'un groupe venaient d'un texte écrit avant la mesure et jamais recoupé.
    name: 'le ticket de mesure qui cite ses lignes de journal',
    keywords: ['measurement ticket', 'quotes its log line'],
    surfaces: ['to-tickets/SKILL.md'],
  },
  {
    // Une API du moteur se vérifie avant d'entrer dans une spec : la consigne de cadrage (catalog.ts) et
    // le document des événements, qui dit ce que le moteur refuse (le « / » de $.prompt.submit, no-surface).
    name: 'ce que le moteur refuse, vérifié au cadrage',
    keywords: ['plugin-authoring', '$.command.run', 'no-surface'],
    surfaces: ['hooks/catalog.ts', 'docs/evenements-moteur.md'],
  },
  {
    name: 'ce que le moteur refuse, avec ses sources',
    keywords: ['## Ce que le moteur refuse', 'a text beginning with / would run a command as the user', 'UiNotifyResult', 'écrits par Claude Code 2.1.310', 'essai du 30/10/2026', 'With no terminal the hooks alone run; unbound or exiting, none'],
    surfaces: ['docs/evenements-moteur.md'],
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

// Hors de la règle « Mode auto » des lots, les règles chargées dans toutes les sessions ne parlent du mode auto
// que par le renvoi au bloc de la consigne (et la définition d'une session autonome) : une exception recopiée
// y ajoutait des centaines de mots qui ne valent que dans la discussion d'où l'auto agit.
const AUTO_RULES = ['config/rules/general.md', 'config/rules/asana-board.md', 'config/rules/flow-board.md']
const AUTO_ALLOWED = ["En mode auto, le bloc « mode auto » de la consigne flow-board l'emporte", 'ou par un parcours en mode auto quel que soit son effort']

test('les règles communes ne recopient pas les exceptions du mode auto, hors de la règle « Mode auto »', () => {
  const copied = []
  for (const surface of AUTO_RULES) {
    const text = SURFACES[surface]
    if (text === null) continue
    for (const line of text.split('\n')) {
      if (line.startsWith('- **Mode auto**')) continue
      let rest = line
      for (const allowed of AUTO_ALLOWED) rest = rest.split(allowed).join('')
      if (/mode auto|en auto\b|« ⚡ Auto »/.test(rest)) copied.push(`${surface} : ${line.slice(0, 80)}…`)
    }
  }
  assert.deepEqual(copied, [], 'exceptions du mode auto recopiées hors de la règle « Mode auto »')
})

test('aucune surface ne dit qu’une règle qui ne fait rien lancer n’a pas de logique', () => {
  const stale = ['config/rules/flow-board.md', 'config/reference/revues.md', 'README.md'].filter(
    surface => SURFACES[surface] !== null && SURFACES[surface].includes('une règle qui ne fait rien lancer'),
  )
  assert.deepEqual(stale, [])
})
