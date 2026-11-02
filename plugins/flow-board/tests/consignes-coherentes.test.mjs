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
  'config/rules/agents.md': repoFile('config/rules/agents.md'),
  'reference/procedure-groupe.md': read('reference/procedure-groupe.md'),
  'reference/revue-securite.md': read('reference/revue-securite.md'),
  'reference/consignes-revue.md': read('reference/consignes-revue.md'),
  'README.md': read('README.md'),
  'hooks/register.tsx': read('hooks/register.tsx'),
  'hooks/catalog.ts': read('hooks/catalog.ts'),
  'hooks/effort.ts': read('hooks/effort.ts'),
  'hooks/view.tsx': read('hooks/view.tsx'),
  'hooks/model.ts': read('hooks/model.ts'),
  'skills/compte-rendu/SKILL.md': read('skills/compte-rendu/SKILL.md'),
  'skills/coo/SKILL.md': read('skills/coo/SKILL.md'),
  'to-spec/SKILL.md': repoFile('plugins/mattpocock-skills/skills/engineering/to-spec/SKILL.md'),
  'to-tickets/SKILL.md': repoFile('plugins/mattpocock-skills/skills/engineering/to-tickets/SKILL.md'),
  'docs/evenements-moteur.md': repoFile('docs/evenements-moteur.md'),
}

/** Chaque consigne : ses mots-clés, et les surfaces qui la recopient (la procédure ne reçoit de la règle d'effort que le worker autonome). */
const CONSIGNES = [
  {
    // Un ticket sensible ou très sensible n'a que l'axe Spec, en high : l'axe Standards refait sa passe « bogues ».
    name: "le relecteur de l'axe Spec seul d'un ticket sensible",
    keywords: ['axe Spec seul'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'config/rules/agents.md', 'reference/procedure-groupe.md', 'README.md'],
  },
  { name: "le relecteur de l'axe Spec seul, en anglais", keywords: ['the Spec axis alone'], surfaces: ['hooks/catalog.ts'] },
  {
    // Un groupe d'un seul ticket n'a pas de revue du groupe ; son avis de sécurité reste dû.
    name: "le groupe d'un seul ticket",
    keywords: ["un seul ticket n'a pas de revue du groupe", 'avis de sécurité reste dû'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'README.md'],
  },
  { name: "le groupe d'un seul ticket, dans la procédure", keywords: ["un groupe d'un seul ticket, rattachés compris, n'a pas de revue du groupe", 'avis de sécurité reste dû'], surfaces: ['reference/procedure-groupe.md'] },
  { name: "le groupe d'un seul ticket, en anglais", keywords: ['A group of a single ticket (attached ones included) has no group review'], surfaces: ['hooks/catalog.ts'] },
  {
    // La revue de sécurité ne se conseille que pour ce qui franchit la limite du compte (sa frontière de confiance) :
    // un fichier sous ~/.claude écrit par une autre session n'est pas une entrée hostile ; ni suppression ni concurrence seule.
    name: 'la liste qui déclenche la revue de sécurité',
    keywords: [
      'la limite du compte',
      'secrets et jetons (masquage compris), dépendances et code tiers lancé, publication, réseau ou export public, droits des fichiers et accès',
      "un fichier sous `~/.claude` écrit par une autre session du compte n'est pas une entrée hostile",
      "ni une suppression de données ni la concurrence seule n'en font partie",
      "l'accès comprend l'authentification et les règles d'accès d'une application, et le réseau vaut dans les deux sens",
    ],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'reference/revue-securite.md', 'README.md'],
  },
  {
    name: 'la liste qui déclenche la revue de sécurité, en anglais',
    keywords: [
      "crosses the boundary of the user's account",
      'secrets and tokens (masking included), dependencies and third-party code run, publishing, network or public export, file permissions and access',
      'a file under ~/.claude written by another session of the account is not a hostile input',
      'neither a data deletion nor concurrency alone calls for it',
      "access includes authentication and an application's access rules, and network goes both ways",
    ],
    surfaces: ['hooks/catalog.ts'],
  },
  {
    // La revue d'un groupe ou d'un lot signale une valeur relue qui entre dans une commande ou un chemin : le gabarit
    // des consignes (sessions liées), la consigne du mod (revue d'un groupe fini, d'un lot), le README.
    name: 'la ligne « sécurité » de la revue du groupe',
    keywords: ['qui entre dans une commande shell ou un chemin', 'sauf là où un contrôle du projet la vérifie déjà'],
    surfaces: ['reference/consignes-revue.md', 'README.md'],
  },
  { name: 'la ligne « sécurité » de la revue du groupe, en anglais', keywords: ['that reaches a shell command or a path is reported as a bug, Important, except where a check of the project already controls it'], surfaces: ['hooks/catalog.ts'] },
  {
    // Trois questions vérifient le classement d'un ticket, au découpage puis avant chaque ticket.
    name: 'les trois questions du classement',
    keywords: ['trois questions', 'valeur lue ailleurs', 'supprime'],
    surfaces: ['config/rules/flow-board.md', 'reference/procedure-groupe.md', 'README.md'],
  },
  { name: 'les trois questions du classement, en anglais', keywords: ['three questions'], surfaces: ['hooks/register.tsx'] },
  {
    // Une classe de défaut trouvée une deuxième fois se corrige partout d'un coup.
    name: 'la classe de défaut corrigée partout',
    keywords: ['classe de défaut'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md'],
  },
  {
    name: "l'effort d'une session de groupe",
    keywords: ['medium par défaut', 'xhigh (Recommandé) / high', 'tâche de jugement', "tâche d'exécution", 'worker autonome'],
    // Le brief d'un worker la tient de hooks/effort.ts, la règle d'effort des workers en un seul endroit.
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/effort.ts'],
  },
  { name: 'le worker autonome', keywords: ['worker autonome', 'Worker autonome'], surfaces: ['reference/procedure-groupe.md'] },
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
    // Après la passe « bogues » d'un ticket sensible : une seule passe high sur tout ce qui a changé depuis son instantané.
    name: 'la passe unique après la passe « bogues »',
    keywords: ['une seule passe high', 'depuis son instantané', 'un nouveau, posé après les correctifs'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'README.md'],
  },
  {
    name: 'la plage de la passe unique, dans la procédure',
    keywords: ['une seule passe high', 'depuis son instantané', '<hash d\'un nouvel instantané>'],
    surfaces: ['reference/procedure-groupe.md'],
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
    // Les six catégories qui restent à la personne en auto, le choix d'expérience défini là où la liste le nomme :
    // la règle des lots, le premier clic sur « ⚡ Auto » (view.tsx), le README, la procédure d'un worker autonome.
    name: 'les six catégories qui bloquent en mode auto',
    keywords: ['expérience', 'mise en page, maquette, libellés, boutons, notifications', 'se valent techniquement et ne diffèrent que par', 'affaiblir un invariant', 'contredit une décision déjà prise', 'suppression sans retour', 'hors du poste', 'faille de sécurité sans correctif', 'effort xhigh', 'action externe hors de la mission'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/view.tsx', 'reference/procedure-groupe.md'],
  },
  {
    // Une question en zone sensible se tranche seule en auto, à une condition : les mêmes surfaces.
    name: 'la question sensible tranchée seule en mode auto',
    keywords: ['invariant déjà validé', 'la plus prudente', 'ne perd rien, n', 'ne supprime rien sans retour', '« Décidé sans toi »'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/view.tsx'],
  },
  {
    // Le choix sensible tranché en auto se reconnaît à son texte, et le compte rendu le range à part.
    name: 'la marque d’un choix sensible tranché en auto',
    keywords: ['« Zone sensible : »'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'reference/procedure-groupe.md', 'skills/compte-rendu/SKILL.md', 'hooks/register.tsx'],
  },
  {
    // Le worker d'une mission en auto : la condition dans sa procédure, et le renvoi de la réponse de l'outil flow.
    name: 'la question sensible tranchée seule par un worker autonome',
    keywords: ['invariant déjà validé', 'la plus prudente', 'Seules les décisions qui restent bloquantes en mode auto montent au manager'],
    surfaces: ['reference/procedure-groupe.md'],
  },
  {
    // Les blocs de la spec et du découpage en auto : seuls l'invariant et la question sensible hors condition y bloquent.
    name: 'la question sensible à la spec et au découpage en mode auto',
    keywords: ['qui ne remplissent pas la condition pour se trancher seules'],
    surfaces: ['README.md'],
  },
  { name: 'la question sensible à la spec et au découpage en mode auto, en anglais', keywords: ['does not meet the condition above to be settled by you, stay blocking questions on this phase ("phase": "to-tickets")', 'and setting or weakening an invariant, stay blocking questions on this phase ("phase": "to-spec")'], surfaces: ['hooks/register.tsx'] },
  {
    // Les questions répondues par écrit chez le COO : les mêmes catégories que la liste bloquante.
    name: 'les questions répondues par écrit chez le COO',
    keywords: ["un choix d'expérience, une zone sensible, un invariant ou une contradiction, une suppression ou une exposition"],
    surfaces: ['skills/coo/SKILL.md'],
  },
  { name: 'les questions répondues par écrit chez le COO, en anglais', keywords: ['an experience choice, a sensitive area, an invariant or a contradiction, a deletion or an exposure'], surfaces: ['hooks/register.tsx'] },
  { name: 'la question sensible tranchée seule par un worker autonome, en anglais', keywords: ['a worker of a mission in auto mode', '« Worker autonome »'], surfaces: ['hooks/model.ts'] },
  {
    // Les origines d'un choix déclaré en auto, et la notification au texte fixé : la règle des lots et le README.
    name: 'les choix et la notification du mode auto',
    keywords: ['« reco prise »', '« validation sautée »', 'PushNotification', "N question(s) t'attendent"],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  {
    // Ce que le second clic accorde : les validations sautées, la même liste dans la règle des lots, le glossaire et le README.
    name: 'les validations sautées du mode auto',
    keywords: ['accord du cadrage, spec, découpage, plan, écritures Asana de la mission'],
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
    // L'accord du mode auto et le tour d'intention recueilli par le COO : la règle des lots et le README.
    name: 'l’accord du mode auto et le tour d’intention du COO',
    keywords: ['« Lancer en auto »', 'à la seule discussion lancée pour lui, dans les 10 minutes', 'une fusion, une reconstruction ou une lecture ratée laisse l\'auto éteint ou l\'éteint, jamais l\'inverse', 'travail/<sujet>/demande.md'],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  {
    // Le worker autonome et l'effort en mode auto : à tout effort, jamais xhigh proposé ; les groupes suivants lancés par le mod.
    name: 'le worker autonome et l’effort en mode auto',
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
  { name: 'le worker autonome en mode auto, au glossaire', keywords: ['quel que soit son effort', 'mode auto'], surfaces: ['GLOSSARY.md'] },
  {
    // Une session liée d'un parcours en mode auto est autonome à tout effort : la règle, la procédure, la demande de délégation, le README.
    name: 'le worker autonome à tout effort en mode auto',
    keywords: ['quel que soit son effort'],
    surfaces: ['config/rules/flow-board.md', 'reference/procedure-groupe.md', 'hooks/register.tsx', 'README.md'],
  },
  {
    // Les mêmes, en anglais, dans la consigne du mode auto, avec ses deux origines de choix et la question sensible tranchée seule.
    name: 'les six catégories qui bloquent en mode auto, en anglais',
    keywords: ['an experience choice', 'layout, mockup, labels, buttons, notifications', 'technically equal and differ only by', 'setting or weakening an invariant', 'contradicts DECISIONS.md', 'a deletion with no way back', 'outside this machine', 'leaving a security finding unfixed', 'declare that xhigh was not offered', 'external action outside the mission', '« reco prise »', '« validation sautée »', 'the invariant already validated', 'the most prudent one'],
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
// que par le renvoi au bloc de la consigne (et la définition d'un worker autonome) : une exception recopiée
// y ajoutait des centaines de mots qui ne valent que dans la discussion d'où l'auto agit.
const AUTO_RULES = ['config/rules/general.md', 'config/rules/asana-board.md', 'config/rules/flow-board.md']
const AUTO_ALLOWED = ["En mode auto, le bloc « mode auto » de la consigne flow-board l'emporte", 'ou par une mission en mode auto quel que soit son effort']

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

test('la liste qui déclenche la revue de sécurité : plus aucune surface ne garde l’ancienne liste', () => {
  // Une copie restée dans le README passait le test à mots-clés, qui les trouvait ailleurs dans le même fichier.
  // Puis la liste d'avant la limite du compte (02/11/2026), qui faisait entrer une valeur relue sous ~/.claude et la suppression.
  const OLD = ["entrées de l'utilisateur jusqu'à une requête", 'user input reaching a query', 'uploads, dependencies', 'accès réseau ou fichiers, envois de fichiers', "commande ou chemin construit à partir d'une entrée", 'a command or a path built from an input', 'données personnelles ou contenu de messages', 'personal data or message content stored on disk', "n'est **pas** de confiance"]
  const stale = Object.entries(SURFACES).flatMap(([name, text]) => (text === null ? [] : OLD.filter(k => text.includes(k)).map(k => `${name} : « ${k} »`)))
  assert.deepEqual(stale, [])
})
