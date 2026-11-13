// Chaque champ des registres persistés est traité par l'effacement, l'historique et le rattrapage,
// ou porte une exception motivée. La ligne `advisor` ajoutée au registre avait été oubliée par
// l'historique d'une mission, l'effacement et `isEmptyRebuilt` : trois revues et deux correctifs.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit les sources. Un champ « traité »
// par un fichier y paraît comme propriété (`.champ`, `champ:`, `{ champ }`) ; c'est un repère, pas
// une preuve : il oblige à décider, champ par champ, quand on en ajoute un.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/** Les clés de premier niveau d'un `type <name> = { … }` du source. */
const keysOf = (src, name) => {
  const start = src.indexOf(`type ${name} = {`)
  assert.ok(start >= 0, `type ${name} introuvable`)
  let depth = 0
  let body = ''
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth += 1
    if (c === '}') depth -= 1
    if (depth === 0) break
    if (depth === 1 && c !== '{') body += c
    else if (depth > 1) body += ' '
  }
  return [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*([A-Za-z_]\w*)\??\s*:/gm)].map(m => m[1])
}

const TYPES = read('types/index.d.ts')
const HISTORY = read('hooks/history.ts')
const FIELDS = {
  SessionRegistry: keysOf(TYPES, 'SessionRegistry'),
  AgentLane: keysOf(TYPES, 'AgentLane'),
  // La piste d'un fichier à part porte aussi ses appels à l'advisor (`main.advisor`).
  Rebuilt: [...keysOf(HISTORY, 'Rebuilt'), 'advisor'],
}

const IDENTITY = "identité ou format du fichier, jamais effacé seul : l'effacement retire la session ou la mission entière"
const WRITE_META = 'réécrit à chaque écriture du registre (registry-file.ts), pas une donnée de la session'
const TOTALS = "total de la piste, sans date : un effacement partiel ne retire que ce qui est daté (segments, repères) ; l'effacement entier retire la piste"
const LIVE_ONLY = "écrit par la session vivante, que le transcript ne porte pas : le rattrapage n'a rien à reconstruire"

/** Les champs qu'un fichier ne traite pas, chacun avec sa raison. */
const EXCEPTIONS = {
  'hooks/erase.ts': {
    'SessionRegistry.v': IDENTITY,
    'SessionRegistry.root': IDENTITY,
    'SessionRegistry.title': "titre de la session, sans date : il part avec la session entière (forgetSession)",
    'SessionRegistry.transcript': 'chemin du transcript, sans date : il part avec la session entière',
    'SessionRegistry.group': 'groupe du worker, sans date : il part avec la session entière',
    'SessionRegistry.updatedAt': WRITE_META,
    'SessionRegistry.parts': WRITE_META,
    'AgentLane.effort': TOTALS,
    'AgentLane.models': TOTALS,
    'AgentLane.tokens': TOTALS,
    'AgentLane.lines': TOTALS,
    'Rebuilt.v': IDENTITY,
  },
  'hooks/history.ts': {
    'SessionRegistry.transcript': "chemin du transcript : l'historique relit le registre, pas le transcript",
    'SessionRegistry.group': "l'historique d'une mission range les sessions par mission (run), pas par groupe",
    'SessionRegistry.parts': WRITE_META,
    'SessionRegistry.carriedNotedAt': "date de suivi du portage, fusionnée par mergeRegistry (registry.ts) : l'historique ne montre que les périodes (carriedAt)",
    'AgentLane.effort': 'relu tel quel par cleanLane (registry.ts), que history.ts appelle',
    'AgentLane.models': 'relu tel quel par cleanLane (registry.ts), que history.ts appelle',
    'AgentLane.tokens': 'relu tel quel par cleanLane (registry.ts), que history.ts appelle',
    'AgentLane.lines': 'relu tel quel par cleanLane (registry.ts), que history.ts appelle',
  },
  'hooks/catch-up.ts': {
    'SessionRegistry.root': IDENTITY,
    'SessionRegistry.title': LIVE_ONLY,
    'SessionRegistry.run': LIVE_ONLY,
    'SessionRegistry.group': LIVE_ONLY,
    'SessionRegistry.linked': LIVE_ONLY,
    'SessionRegistry.carried': LIVE_ONLY,
    'SessionRegistry.carriedAt': LIVE_ONLY,
    'SessionRegistry.carriedNotedAt': LIVE_ONLY,
    'SessionRegistry.updatedAt': WRITE_META,
    'SessionRegistry.parts': WRITE_META,
    'AgentLane.effort': 'lu par transcript.ts (laneFromTranscript), que catch-up.ts appelle',
    'AgentLane.lines': 'lu par transcript.ts (laneFromTranscript), que catch-up.ts appelle',
  },
}

const handles = (src, key) => new RegExp(`(?:\\.|\\?\\.)${key}\\b|\\b${key}\\s*[:?]|[{,]\\s*${key}\\s*[,}]`).test(src)

test('les champs persistés : SessionRegistry, AgentLane et Rebuilt sont lus dans leur source', () => {
  assert.ok(FIELDS.SessionRegistry.includes('advisor'))
  assert.ok(FIELDS.SessionRegistry.includes('carriedAt'))
  assert.ok(FIELDS.AgentLane.includes('segments'))
  assert.ok(FIELDS.Rebuilt.includes('runs'))
})

for (const [file, exceptions] of Object.entries(EXCEPTIONS)) {
  test(`chaque champ persisté est traité par ${file}, ou y a une exception motivée`, () => {
    const src = read(file)
    const missing = []
    const stale = []
    for (const [type, keys] of Object.entries(FIELDS)) {
      for (const key of keys) {
        const name = `${type}.${key}`
        const isHandled = handles(src, key)
        if (!isHandled && !(name in exceptions)) missing.push(name)
        if (isHandled && name in exceptions) stale.push(name)
      }
    }
    assert.deepEqual(missing, [], `champs ni traités ni excusés par ${file} : ${missing.join(', ')}`)
    assert.deepEqual(stale, [], `exceptions devenues inutiles dans ${file} : ${stale.join(', ')}`)
    for (const [name, why] of Object.entries(exceptions)) assert.ok(why.length > 20, `${name} : raison trop courte`)
  })
}

test('le test voit un traitement retiré : sans sa ligne advisor, erase.ts échoue', () => {
  const erase = read('hooks/erase.ts')
  const without = erase.replace(/\badvisor\b/g, 'retired')
  assert.ok(handles(erase, 'advisor'))
  assert.ok(!handles(without, 'advisor'))
  assert.ok(!('SessionRegistry.advisor' in EXCEPTIONS['hooks/erase.ts']))
})

// --- La matrice de fusion -----------------------------------------------------------------------
// Aux groupes A et C de la rétro « Mode auto », la même classe de défaut est revenue pour chaque champ
// persisté fusionné à part : une date illisible, une date future, une valeur absente, une valeur abîmée,
// l'ordre de fusion. Chaque fonction de fusion d'un champ (la chaîne de `keepRun` et ce que
// `mergeBoards` fusionne lui-même) a donc, pour chacun de ces cinq cas, le test qui le couvre (son
// fichier et un morceau de son titre, vérifiés ici) ou une raison : « sans objet » quand le cas n'existe
// pas pour ce champ, « piste » quand il reste à couvrir. Un champ fusionné ajouté sans sa ligne fait
// échouer ce test. C'est un repère, comme le reste du fichier : il oblige à décider, cas par cas.

const MODEL = read('hooks/model.ts')
const CASES = ['date illisible', 'date future', 'valeur absente', 'valeur abîmée', 'deux ordres']

/** Le texte d'une déclaration `const <name> = …` de premier niveau, jusqu'à la suivante. */
const declOf = (src, name) => {
  const start = src.search(new RegExp(`^(?:export )?const ${name} =`, 'm'))
  assert.ok(start >= 0, `déclaration ${name} introuvable`)
  const next = src.slice(start + 1).search(/^(?:export )?(?:const|function|type|let) /m)
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next)
}

/** Le code d'une déclaration, sans ses commentaires ni ses `...` (un appel étalé reste un appel). */
const codeOf = (src, name) =>
  declOf(src, name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\.\.\./g, ' ')

/** Chaque fonction appelée par son nom (pas une méthode) dans une déclaration. */
const callsOf = (src, name) => [...codeOf(src, name).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\(/g)].map(m => m[1])

/**
 * Ce que `keepRun` et `mergeBoards` appellent sans fusionner un champ, chacun avec sa raison. Tout autre
 * appel est une fusion de champ, qui a sa ligne dans la matrice : côté faux rouge, un appel nouveau
 * fait échouer le test jusqu'à ce qu'on le range d'un côté ou de l'autre.
 */
const NOT_FUSIONS = {
  keepRun: 'la chaîne des fusions de champs de la mission, lue à part (ses appels sont les fusions)',
  Map: 'constructeur de la table des missions par id, pas une fusion de champ',
  isGone: 'test local d’une mission effacée par une trace, rangé avec soundTombstones',
  isShipped: 'prédicat sur la mission (livraison marquée, push compris) qui décide, avec updatedAt, si une copie close comme livrée ailleurs l’emporte sur la mission active d’ici, comme isTakenOver ; pas une fusion de champ (testé par coordination.test.ts)',
  prune: 'plafonne les listes du board fusionné après coup, sans choisir entre deux copies',
  soundClaim: 'relit en forme la prise que keepClaim vient de fusionner, pour décider si un autre processus de la même discussion tient la mission (isOtherProcess, comme isTakenOver) ; pas une fusion de champ (testé par mission-discussion.test.ts)',
}

/** Les fonctions de fusion d'un champ, lues dans le source : les appels de `keepRun` et de `mergeBoards`, hors `NOT_FUSIONS`. */
const fusedOf = model => [...new Set([...callsOf(model, 'keepRun'), ...callsOf(model, 'mergeBoards')])].filter(n => !(n in NOT_FUSIONS)).sort()

/**
 * Les champs du board que `mergeBoards` écrit lui-même (les clés du board fusionné et `merged.<champ> =`),
 * chacun avec la fusion qui le choisit : un champ ajouté au board fusionné sans sa ligne fait échouer le test.
 */
const BOARD_FIELDS = {
  runs: 'keepRun',
  deleted: 'soundTombstones',
  coo: 'mergeSeat',
  activeId: 'sans fusion de valeur : la mission active d’ici, retirée seulement quand une autre discussion l’a reprise, que le COO l’a close comme livrée depuis, ou qu’elle a disparu (testé par mode-auto, « prise en main comprise »)',
}

/** Les champs que `mergeBoards` écrit dans le board fusionné. */
const boardFieldsOf = model => {
  const code = declOf(model, 'mergeBoards').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const literal = code.slice(code.indexOf('const merged: Board = {'))
  const body = literal.slice(literal.indexOf('{') + 1, literal.indexOf('\n  }'))
  const keys = [...body.matchAll(/^\s*([A-Za-z_]\w*)\s*[:,]/gm)].map(m => m[1])
  const assigned = [...code.matchAll(/\bmerged\.([A-Za-z_]\w*)\s*=/g)].map(m => m[1])
  return [...new Set([...keys, ...assigned])].sort()
}

const covered = (file, title) => ({ file, title })
const why = text => ({ why: text })
const NO_DATE = 'sans objet : la fusion de ce champ ne lit aucune date'

/** Pour chaque fonction de fusion, chacun des cinq cas : son test, ou sa raison. */
const MERGE_MATRIX = {
  keepSendNames: {
    'date illisible': why(NO_DATE + ' (le même envoi se retrouve par l’égalité de sa date d’envoi, at, jamais comparée en ordre)'),
    'date future': why(NO_DATE + ' (aucune date ramenée par clampFuture : at n’y sert qu’à apparier un envoi)'),
    'valeur absente': covered('nom-du-worktree-note.test.mjs', 'fusion de deux copies : un nom absent de la copie gardée revient de l’autre'),
    'valeur abîmée': covered('nom-du-worktree-note.test.mjs', 'fusion de deux copies, une valeur abîmée'),
    'deux ordres': covered('nom-du-worktree-note.test.mjs', 'fusion de deux copies, dans les deux ordres'),
  },
  keepSessions: {
    'date illisible': why(NO_DATE + ' (le même envoi se retrouve par l’égalité de sa date d’envoi, at, jamais comparée en ordre)'),
    'date future': why(NO_DATE + ' (aucune date ramenée par clampFuture : at n’y sert qu’à apparier un envoi)'),
    'valeur absente': covered('session-par-le-relais.test.ts', 'la fusion garde l’id noté, le reprend de l’autre copie s’il manque, et marque deux ids différents'),
    'valeur abîmée': covered('session-par-le-relais.test.ts', 'la fusion garde l’id noté, le reprend de l’autre copie s’il manque, et marque deux ids différents'),
    'deux ordres': covered('session-par-le-relais.test.ts', 'la fusion garde l’id noté, le reprend de l’autre copie s’il manque, et marque deux ids différents'),
  },
  keepClosings: {
    'date illisible': why(NO_DATE + ' (isAhead compare l’état et les marques securityOff, cleanupAt)'),
    'date future': why(NO_DATE + ' (aucune date de fermeture comparée, ni ramenée par clampFuture)'),
    'valeur absente': covered('fermeture-d-office.test.ts', 'l’état « closed » ne recule jamais : renvoi des groupes'),
    'valeur abîmée': why('piste : aucune fermeture hors forme passée par mergeBoards (durcissement-fin-de-lot la relit hors forme sans fusion)'),
    'deux ordres': covered('securite-desactivee.test.ts', 'fusion de deux copies d’un groupe clos'),
  },
  keepReportMark: {
    'date illisible': covered('matrice-fusion.test.ts', 'matrice · reportValidatedAt · date illisible'),
    'date future': why('piste : reportValidatedAt n’est pas ramenée par clampFuture ; la plus récente reste, et ne dit que « validé »'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · reportValidatedAt · deux ordres'),
    'valeur abîmée': covered('matrice-fusion.test.ts', 'matrice · reportValidatedAt · valeur abîmée'),
    'deux ordres': covered('matrice-fusion.test.ts', 'matrice · reportValidatedAt · deux ordres'),
  },
  keepLotReview: {
    'date illisible': why('piste : seule une date absente est fusionnée (securite-du-lot, « un avis sans date »), pas une date illisible'),
    'date future': covered('securite-du-lot.test.ts', 'un avis de sécurité du lot daté au-delà de la tolérance'),
    'valeur absente': covered('securite-du-lot.test.ts', 'fusion : un avis daté l’emporte sur un avis sans date'),
    'valeur abîmée': why('piste : aucun avis ni revue du lot hors forme (pas un objet) passé par mergeBoards'),
    'deux ordres': covered('securite-du-lot.test.ts', 'l’avis de date la plus récente l’emportent, dans les deux ordres'),
  },
  keepAuto: {
    'date illisible': covered('mode-auto.test.ts', 'Une date hors forme ne rallume jamais'),
    'date future': covered('mode-auto.test.ts', 'Une date de l’auto dans le futur est ramenée à maintenant'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · auto · valeur absente'),
    'valeur abîmée': covered('mode-auto.test.ts', 'Un état auto abîmé autrement'),
    'deux ordres': covered('mode-auto.test.ts', 'Une copie en retard, auto allumé, ne rallume jamais une copie éteinte, dans les deux sens'),
  },
  keepWaiting: {
    'date illisible': covered('questions-bloquantes.test.ts', 'Une question ouverte dont la date s’est abîmée'),
    'date future': covered('matrice-fusion.test.ts', 'matrice · waiting · date future'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · waiting · valeur absente'),
    'valeur abîmée': covered('questions-bloquantes.test.ts', 'Une entrée relue d’un autre format n’est jamais reconstruite ni perdue par une fusion'),
    'deux ordres': covered('questions-bloquantes.test.ts', 'La fusion garde l’union des questions et applique les retraits tracés'),
  },
  keepDecided: {
    'date illisible': covered('matrice-fusion.test.ts', 'matrice · decided · date illisible'),
    'date future': covered('matrice-fusion.test.ts', 'matrice · decided · date future'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · decided · valeur absente'),
    'valeur abîmée': covered('matrice-fusion.test.ts', 'matrice · decided · valeur abîmée'),
    'deux ordres': covered('choix-auto.test.ts', 'En auto, la fusion de deux copies garde l’union des choix'),
  },
  keepAutoSent: {
    'date illisible': covered('matrice-fusion.test.ts', 'matrice · autoSent · date illisible'),
    'date future': covered('envoi-auto.test.ts', 'Une trace « ↻ Renvoyer » ou « répondue » datée dans le futur'),
    'valeur absente': covered('envoi-auto.test.ts', 'La fusion garde l’union des marques'),
    'valeur abîmée': covered('matrice-fusion.test.ts', 'matrice · autoSent · valeur abîmée'),
    // envoi-auto échange la copie d'ici et celle du stockage, aucune active : la copie gardée y est toujours la même.
    'deux ordres': covered('matrice-fusion.test.ts', 'matrice · autoSent · valeur abîmée'),
  },
  keepForced: {
    'date illisible': covered('matrice-fusion.test.ts', 'matrice · forced · date illisible'),
    'date future': covered('matrice-fusion.test.ts', 'matrice · forced · date future'),
    'valeur absente': covered('retenues.test.ts', 'un forçage vaut pour la seule paire nommée'),
    'valeur abîmée': covered('matrice-fusion.test.ts', 'matrice · forced · valeur abîmée'),
    'deux ordres': covered('retenues.test.ts', 'un forçage vaut pour la seule paire nommée'),
  },
  keepInstructed: {
    'date illisible': why(NO_DATE + ' (la trace des consignes reçues ne porte que des ids d’entrée)'),
    'date future': why(NO_DATE + ' (aucune date gardée : un id seul, comparé tel quel)'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · instructed · valeur absente'),
    'valeur abîmée': covered('matrice-fusion.test.ts', 'matrice · instructed · valeur abîmée'),
    'deux ordres': covered('matrice-fusion.test.ts', 'matrice · instructed · deux ordres'),
  },
  keepLaunch: {
    'date illisible': covered('matrice-fusion.test.ts', 'matrice · launch · date illisible'),
    'date future': covered('matrice-fusion.test.ts', 'matrice · launch · date future'),
    'valeur absente': covered('carte-lancement.test.ts', 'un rattachement se garde à la fusion'),
    'valeur abîmée': covered('matrice-fusion.test.ts', 'matrice · launch · valeur abîmée'),
    'deux ordres': covered('matrice-fusion.test.ts', 'matrice · launch · deux ordres'),
  },
  keepExternals: {
    'date illisible': covered('matrice-fusion.test.ts', 'matrice · externals · date illisible'),
    'date future': covered('bloqueur-local.test.ts', 'une levée datée au-delà de la tolérance est ramenée à maintenant'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · externals · valeur absente'),
    'valeur abîmée': covered('bloqueur-local.test.ts', 'des bloqueurs relus qui ne sont pas une liste'),
    'deux ordres': covered('bloqueur-local.test.ts', 'mergeBoards : une copie en retard ne rouvre pas un bloqueur levé'),
  },
  keepClaim: {
    'date illisible': covered('mission-discussion.test.ts', 'prise · date illisible'),
    'date future': covered('mission-discussion.test.ts', 'prise · date future'),
    'valeur absente': covered('mission-discussion.test.ts', 'prise · valeur absente'),
    'valeur abîmée': covered('mission-discussion.test.ts', 'prise · valeur abîmée'),
    'deux ordres': covered('mission-discussion.test.ts', 'deux processus d’une même discussion'),
  },
  keepHandoff: {
    'date illisible': covered('mission-discussion.test.ts', 'passage · date illisible'),
    'date future': covered('mission-discussion.test.ts', 'passage · date future'),
    'valeur absente': covered('mission-discussion.test.ts', 'passage · valeur absente'),
    'valeur abîmée': covered('mission-discussion.test.ts', 'passage · valeur abîmée'),
    'deux ordres': covered('mission-discussion.test.ts', 'passage · deux ordres'),
  },
  mergeSeat: {
    'date illisible': covered('matrice-fusion.test.ts', 'matrice · coo · date illisible'),
    'date future': covered('coo-siege.test.ts', 'un siège daté loin dans le futur est ramené à maintenant'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · coo · valeur absente'),
    'valeur abîmée': covered('matrice-fusion.test.ts', 'matrice · coo · valeur abîmée'),
    'deux ordres': covered('coo-siege.test.ts', 'deux prises croisées finissent sur un seul titulaire'),
  },
  soundTombstones: {
    'date illisible': covered('suppression-future.test.ts', 'Une trace mal formée'),
    'date future': covered('suppression-future.test.ts', 'Une trace datée à plus d’une minute dans le futur'),
    'valeur absente': covered('matrice-fusion.test.ts', 'matrice · deleted · valeur absente'),
    'valeur abîmée': covered('suppression-future.test.ts', 'Une trace mal formée'),
    'deux ordres': covered('suppression-future.test.ts', 'Une vraie suppression marche comme avant'),
  },
}

/** Les titres des `test(…)` d'un fichier de test. */
const titlesOf = src => [...src.matchAll(/\btest\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map(m => m[2])

/** Les défauts de la matrice face au source : fonctions sans ligne, lignes sans fonction, cases manquantes ou sans test. */
const matrixProblems = (fused, matrix, titles) => {
  const problems = []
  for (const name of fused) if (!(name in matrix)) problems.push(`${name} : fusionné sans sa ligne dans MERGE_MATRIX`)
  for (const name of Object.keys(matrix)) if (!fused.includes(name)) problems.push(`${name} : ligne d’une fusion qui n’existe plus`)
  for (const [name, cells] of Object.entries(matrix)) {
    for (const c of CASES) {
      const cell = cells[c]
      if (!cell) problems.push(`${name} · ${c} : case manquante`)
      else if ('why' in cell) {
        if (cell.why.length <= 20) problems.push(`${name} · ${c} : raison trop courte`)
      } else if (!(titles(cell.file) ?? []).some(t => t.includes(cell.title))) problems.push(`${name} · ${c} : aucun test « ${cell.title} » dans ${cell.file}`)
    }
    for (const c of Object.keys(cells)) if (!CASES.includes(c)) problems.push(`${name} · ${c} : cas inconnu`)
  }
  return problems
}

const testTitles = file => {
  try {
    return titlesOf(read(`tests/${file}`))
  } catch {
    return undefined
  }
}

test('chaque champ que mergeBoards fusionne à part a sa matrice : date illisible, date future, valeur absente, valeur abîmée, deux ordres', () => {
  const fused = fusedOf(MODEL)
  assert.ok(fused.includes('keepAuto') && fused.includes('mergeSeat') && fused.includes('soundTombstones'), `fusions lues : ${fused.join(', ')}`)
  assert.deepEqual(matrixProblems(fused, MERGE_MATRIX, testTitles), [])
  // Chaque champ que mergeBoards écrit lui-même a la fusion qui le choisit, rangée dans la matrice (ou sa raison).
  assert.deepEqual(boardFieldsOf(MODEL), Object.keys(BOARD_FIELDS).sort())
  for (const [field, by] of Object.entries(BOARD_FIELDS)) assert.ok(by in MERGE_MATRIX || by === 'keepRun' || by.length > 20, `${field} : ${by}`)
})

test('la matrice voit un champ fusionné sans sa ligne, une case sans test et un titre qui a changé', () => {
  const added = MODEL.replace('keepExternals(keepLaunch(', 'keepExternals(keepNouveau(keepLaunch(')
  assert.ok(fusedOf(added).includes('keepNouveau'))
  assert.deepEqual(matrixProblems(fusedOf(added), MERGE_MATRIX, testTitles), ['keepNouveau : fusionné sans sa ligne dans MERGE_MATRIX'])
  // Une fusion d'un nom quelconque appelée par mergeBoards, et un champ écrit en ligne dans le board fusionné.
  const other = MODEL.replace('  prune(merged)\n', '  merged.roadmap = mergeRoadmap(local.roadmap, stored.roadmap)\n  prune(merged)\n')
  assert.notEqual(other, MODEL)
  assert.deepEqual(matrixProblems(fusedOf(other), MERGE_MATRIX, testTitles), ['mergeRoadmap : fusionné sans sa ligne dans MERGE_MATRIX'])
  assert.ok(boardFieldsOf(other).includes('roadmap'))
  const { 'deux ordres': _, ...fourCases } = MERGE_MATRIX.keepForced
  assert.deepEqual(matrixProblems(fusedOf(MODEL), { ...MERGE_MATRIX, keepForced: fourCases }, testTitles), ['keepForced · deux ordres : case manquante'])
  const renamed = file => (testTitles(file) ?? []).map(t => t.replace('matrice · forced', 'matrice · forçage'))
  assert.deepEqual(matrixProblems(fusedOf(MODEL), MERGE_MATRIX, renamed).filter(p => p.startsWith('keepForced')), [
    'keepForced · date illisible : aucun test « matrice · forced · date illisible » dans matrice-fusion.test.ts',
    'keepForced · date future : aucun test « matrice · forced · date future » dans matrice-fusion.test.ts',
    'keepForced · valeur abîmée : aucun test « matrice · forced · valeur abîmée » dans matrice-fusion.test.ts',
  ])
})
