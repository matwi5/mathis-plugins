// Le titre du parcours, recopié dans une demande mise dans le prompt ou dans la description d'une
// fermeture, passe toujours par neutralInPrompt : un titre recopié brut pouvait fermer sa citation
// « … » ou glisser une consigne (pistes du groupe C de « Pistes de rétro en groupes »).
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit les sources. Seuls les textes qui
// ne vont pas dans le prompt (la ligne d'état, les réponses de /flow à la personne) gardent le titre
// tel quel ; ils sont nommés ici, un par un.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/** Les lignes qui recopient le titre tel quel dans un texte (`${run.title}`, `${run?.title}`). */
const rawTitleLines = src =>
  src
    .split('\n')
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    .filter(({ line }) => /\$\{run\??\.title\}/.test(line))

/** Les textes qui ne vont pas dans le prompt : la ligne d'état et les réponses de /flow à la personne. */
const NOT_PROMPT = [/\$\.ui\.status\(/, /Parcours mis de côté : \$\{run\.title\}/, /Parcours archivé : \$\{run\.title\}/]

test('register.tsx et closing.ts ne recopient le titre du parcours brut dans aucune demande ni description de fermeture', () => {
  const leaks = ['hooks/register.tsx', 'hooks/closing.ts'].flatMap(file =>
    rawTitleLines(read(file))
      .filter(({ line }) => !NOT_PROMPT.some(re => re.test(line)))
      .map(({ line, at }) => `${file}:${at} ${line.slice(0, 120)}`),
  )
  assert.deepEqual(leaks, [])
})
