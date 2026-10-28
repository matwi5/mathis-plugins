// Chaque champ des registres persistés est traité par l'effacement, l'historique et le rattrapage,
// ou porte une exception motivée. La ligne `advisor` ajoutée au registre avait été oubliée par
// l'historique d'un parcours, l'effacement et `isEmptyRebuilt` : trois revues et deux correctifs.
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

const IDENTITY = "identité ou format du fichier, jamais effacé seul : l'effacement retire la session ou le parcours entier"
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
    'SessionRegistry.group': 'groupe de la session liée, sans date : il part avec la session entière',
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
    'SessionRegistry.group': "l'historique d'un parcours range les sessions par parcours (run), pas par groupe",
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
