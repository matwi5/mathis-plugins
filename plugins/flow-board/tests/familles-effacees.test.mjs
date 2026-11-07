// Chaque famille de clés de `$.store` et de fichiers rangée par mission part avec la mission, ou porte
// une exception motivée. Trois familles (consignes du COO appliquées, référence du manager, choix
// déclarés) avaient été oubliées par l'effacement puis rattrapées par les revues.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit les sources. Une famille par mission
// paraît comme un constructeur de clé ou de chemin (une fonction `…Key` ou `…Path`, fléchée ou non, dont
// un paramètre s'appelle `run` ou `runId`) ; chacun doit être nommé dans les listes que suit l'effacement
// (`MISSION_FAMILIES`, `WORKER_FAMILIES` de `hooks/erase-run.ts`, et les `switch` qui en donnent la clé
// et le fichier), que le test de l'effacement crée
// toutes, ou avoir sa raison ici.

import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const HOOKS = readdirSync(new URL('../hooks/', import.meta.url)).filter(f => /\.tsx?$/.test(f))

/** Les familles effacées autrement qu'en suivant les listes, chacune avec sa raison. */
const EXCEPTIONS = {
  confirmKey: "date du clic de l'auto : `pruneConfirms` l'efface (forgetConfirm, isErased) dès que la mission quitte le board",
  tracesKey: "traces de l'auto : `pruneConfirms` les efface (forgetOwnTraces, isErased) dès que la mission quitte le board",
  reportKey: "identifiant d'un compte rendu à l'intérieur du relais, ni clé de `$.store` ni fichier : il part avec le relais",
  phaseKey: "identifiant d'une phase, calculé en mémoire, jamais gardé",
  missionDecisionsPath: 'le `DECISIONS.md` du projet, écrit par la personne dans son dépôt : le mod ne l’efface jamais',
  workerCompactKey:
    "marque de compaction d'un worker (`worker-compact:<session>:<mission>:<ticket>`), antérieure à cette liste et effacée nulle part : à trancher avec la personne (durcissement), pas ajoutée d'office à l'effacement",
}

/** Le texte des deux listes, de leur déclaration à la fin de la seconde. */
const familiesText = () => {
  const src = read('hooks/erase-run.ts')
  const start = src.indexOf('export const MISSION_FAMILIES')
  const end = src.indexOf('// Fin des familles', start)
  assert.ok(start >= 0 && end > start, 'MISSION_FAMILIES et WORKER_FAMILIES introuvables dans hooks/erase-run.ts')
  return src.slice(start, end)
}

/**
 * Les constructeurs de clé et de chemin par mission des modules de hooks/ : une fonction (`function`, ou
 * `const` fléchée, `async` compris) dont le nom finit par `Key` ou `Path` et dont un paramètre, à
 * n'importe quelle place, s'appelle `run` ou `runId`.
 */
const builders = () => {
  const found = []
  for (const file of HOOKS) {
    const src = read(`hooks/${file}`)
    for (const m of src.matchAll(/\b(?:const\s+(\w+(?:Key|Path))\s*=\s*(?:async\s*)?|function\s+(\w+(?:Key|Path))\s*)\(([^)]*)\)/g)) {
      if (/(?:^|,)\s*(?:run|runId|missionId|mission)\s*[?:,]|(?:^|,)\s*(?:run|runId|missionId|mission)\s*$/.test(m[3])) found.push({ name: m[1] ?? m[2], file })
    }
  }
  return found
}

/** Les préfixes de clés écrits en gabarit avec l'id de la mission hors d'un constructeur (`foo:${run.id}`, `foo:${runId}`). */
const PREFIX_EXCEPTIONS = {
  run: "id de la trace d'effacement d'une mission (`run:<id>`) et de son registre, pas une donnée gardée par mission",
}

const loosePrefixes = () => {
  const found = []
  for (const file of HOOKS) {
    for (const line of read(`hooks/${file}`).split('\n')) {
      if (/\b(?:const|function)\s+\w+(?:Key|Path)\b/.test(line)) continue
      for (const m of line.matchAll(/`([a-z][\w-]*):\$\{(?:run\.id|runId|run0\.id|missionId)\}/g)) found.push({ prefix: m[1], file })
    }
  }
  return found
}

test('chaque clé ou chemin rangé par mission est dans les listes que suit l’effacement, ou a sa raison', () => {
  const listed = familiesText()
  const all = builders()
  // Contrôle positif : le relevé trouve bien les constructeurs connus.
  for (const name of ['relayKey', 'relayPath', 'relayEntryKey', 'appliedKey', 'decidedPath', 'confirmKey', 'workerCompactKey', 'missionDecisionsPath']) assert.ok(all.some(b => b.name === name), `${name} pas relevé`)
  const missing = all.filter(b => !new RegExp(`\\b${b.name}\\b`).test(listed) && !(b.name in EXCEPTIONS)).map(b => `${b.name} (hooks/${b.file})`)
  assert.deepEqual(missing, [], 'une famille gardée par mission que la suppression de la mission n’efface pas : ajoute-la à MISSION_FAMILIES ou WORKER_FAMILIES, ou motive une exception')
  // Une exception sans constructeur est périmée.
  for (const name of Object.keys(EXCEPTIONS)) assert.ok(all.some(b => b.name === name), `exception périmée : ${name}`)
})

test('une clé écrite en gabarit avec l’id de la mission hors d’un constructeur a son exception', () => {
  const loose = loosePrefixes()
  // Contrôle positif : la trace d'effacement `run:${run.id}` est relevée.
  assert.ok(loose.some(p => p.prefix === 'run'), 'run: pas relevé')
  const missing = loose.filter(p => !(p.prefix in PREFIX_EXCEPTIONS)).map(p => `${p.prefix}: (hooks/${p.file})`)
  assert.deepEqual(missing, [], 'une clé par mission écrite hors d’un constructeur : passe par un constructeur `…Key` des familles, ou motive une exception')
})
