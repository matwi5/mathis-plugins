// Le titre de la mission, recopié dans une demande mise dans le prompt, dans la description d'une
// fermeture ou en tête du fichier des choix (relay.ts), passe toujours par neutralInPrompt : un titre recopié brut pouvait fermer sa citation
// « … » ou glisser une consigne (pistes du groupe C de « Pistes de rétro en groupes »).
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit les sources. Seuls les textes qui
// ne vont pas dans le prompt (la ligne d'état, les réponses de /flow à la personne) gardent le titre
// tel quel ; ils sont nommés ici, un par un.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hookSources } from './sources.mjs'

/** Les lignes qui recopient le titre tel quel dans un texte (`${run.title}`, `${run?.title}`). */
const rawTitleLines = src =>
  src
    .split('\n')
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    .filter(({ line }) => /\$\{run\??\.title\}/.test(line))

/**
 * Les textes qui ne vont pas dans le prompt : la ligne d'état, les réponses de /flow à la personne,
 * les toasts du tableau de bord (`fx.toasts`, `toasts: […]`), les phrases du panneau (view.tsx) et les lignes
 * « info » du journal (les faits du compte rendu n'en citent que les lignes « warn »).
 */
const NOT_PROMPT = [
  /\$\.ui\.status\(/,
  /Mission mise de côté : \$\{run\.title\}/,
  /Mission archivée : \$\{run\.title\}/,
  /toasts(?:\.push\(|: \[)`[^`]*\$\{run\.title\}/,
  /^log\(run, now, '[^']*', `[^`]*\$\{run\.title\}`, 'info'\)$/,
  /^\? `La dernière mission, « \$\{run\.title\} », /,
]

test('aucun module de hooks/ ne recopie le titre de la mission brut dans une demande, une description de fermeture ou le fichier des choix', () => {
  const leaks = hookSources().flatMap(({ file, text }) =>
    rawTitleLines(text)
      .filter(({ line }) => !NOT_PROMPT.some(re => re.test(line)))
      .map(({ line, at }) => `${file}:${at} ${line.slice(0, 120)}`),
  )
  assert.deepEqual(leaks, [])
})
