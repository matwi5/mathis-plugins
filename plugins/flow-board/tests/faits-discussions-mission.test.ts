import { expect, test } from 'claude-code/testing'

import { missionDiscussionsLine } from '../hooks/discussions-recap.ts'
import { newRun, reportFacts } from '../hooks/model.ts'
import type { Run } from '../types'
import { CORPUS, NON_TEXT } from './corpus.mjs'

// Les faits du compte rendu donnent les discussions de la mission, pour sa section « Contexte et coût » :
// chacune avec son rôle, dans la forme de `--discussions` du récap de stats-board, et la date depuis laquelle chercher.
// Seul un id en forme (un uuid, ou 8 chiffres hexadécimaux) et un id de groupe en forme paraissent dans la ligne.

const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'
const W1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const W2 = 'bbbbbbbb-0000-4000-8000-000000000002'

/** Début de la mission : le 20/11/2026 à 01:30 UTC, d'où `--since 2026-11-19`. */
const STARTED = Date.UTC(2026, 10, 20, 1, 30)

const mission = (): Run => {
  const run = newRun('implement', STARTED, 'Course')
  run.startedAt = STARTED
  return run
}

const PREFIX = "- Discussions of the mission, for the report's « Contexte et coût » section: "

const discussionsLine = (run: Run): string | undefined => reportFacts(run).find(l => l.startsWith(PREFIX))

test('manager seul : la ligne suit la première ligne des faits, avec son id et la veille UTC du début', () => {
  const run = mission()
  run.bornIn = M1
  run.owner = M1
  const lines = reportFacts(run)
  expect(lines[1]).toBe(`${PREFIX}recap arguments « --discussions manager:${M1} --since 2026-11-19 » (copy them as they are, add no id).`)
})

test('naissance et discussion active différentes : deux couples manager, la naissance d’abord', () => {
  const run = mission()
  run.bornIn = M1
  run.owner = M2
  expect(discussionsLine(run)).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},manager:${M2} --since 2026-11-19 » (copy them as they are, add no id).`)
})

test('groupe en vol, rendu, renvoyé deux fois : un couple par envoi, dans l’ordre de sendsOf ; l’id entier passe devant l’id court', () => {
  const run = mission()
  run.bornIn = M1
  run.groups = [
    // Rendu deux fois puis renvoyé : earlier (deux), delegated, puis linked en vol.
    {
      id: 'A',
      name: 'Un',
      tickets: [],
      delegated: {
        at: 3_000,
        session: 'cccccccc',
        closing: { state: 'closed', at: 3_500, sessionId: 'cccccccc-0000-4000-8000-000000000003' },
        earlier: [
          { at: 1_000, session: 'aaaaaaaa', closing: { state: 'closed', at: 1_500, sessionId: W1 } },
          { at: 2_000, session: 'bbbbbbbb' },
        ],
      },
      linked: { at: 4_000, session: 'dddddddd' },
    },
    // En vol seulement, l'id entier noté avant l'id court.
    { id: 'B', name: 'Deux', tickets: [], linked: { at: 5_000, session: W2 } },
  ] as Run['groups']
  expect(discussionsLine(run)).toBe(
    `${PREFIX}recap arguments « --discussions manager:${M1},worker-A:${W1},worker-A:bbbbbbbb,worker-A:cccccccc-0000-4000-8000-000000000003,worker-A:dddddddd,worker-B:${W2} --since 2026-11-19 » (copy them as they are, add no id).`,
  )
})

test('id local_…, id absent, sessionClash et id hors forme : comptés par leur rôle seul, leur valeur jamais recopiée', () => {
  const run = mission()
  run.bornIn = M1
  run.groups = [
    { id: 'A', name: 'Un', tickets: [], delegated: { at: 1_000, session: W1 } },
    { id: 'C', name: 'Trois', tickets: [], delegated: { at: 1_000, session: 'local_REPERE1', closing: { state: 'closed', at: 1_200, sessionId: 'local_REPERE2' } } },
    // `sessionClash` l'emporte sur un id en forme.
    {
      id: 'D',
      name: 'Quatre',
      tickets: [],
      delegated: { at: 2_000, session: 'eeeeeeee', sessionClash: true, closing: { state: 'closed', at: 2_100, sessionId: W2 }, earlier: [{ at: 1_000 }] },
    },
    { id: 'E', name: 'Cinq', tickets: [], linked: { at: 3_000, session: 'REPERE3 --since 1999-01-01' } },
    // Toute valeur relue de la marque compte, `null` et `false` compris.
    { id: 'F', name: 'Six', tickets: [], delegated: { at: 1_000, session: W1, sessionClash: null }, linked: { at: 2_000, session: W2, sessionClash: false } },
  ] as unknown as Run['groups']
  const line = discussionsLine(run)!
  expect(line).toBe(
    `${PREFIX}recap arguments « --discussions manager:${M1},worker-A:${W1} --since 2026-11-19 » (copy them as they are, add no id). Without a usable id (name each « non mesurée (sans id utilisable) » in the report): worker-C, worker-D (2), worker-E, worker-F (2).`,
  )
  // Le repère d'un id hors forme ne paraît dans aucune ligne des faits.
  expect(reportFacts(run).join('\n')).not.toContain('REPERE')
  expect(line).not.toContain('eeeeeeee')
})

test('manager en local_… : jamais recopié, compté « manager » ; un champ absent ne compte pas', () => {
  const run = mission()
  run.bornIn = 'local_REPERE'
  run.owner = M2
  expect(discussionsLine(run)).toBe(
    `${PREFIX}recap arguments « --discussions manager:${M2} --since 2026-11-19 » (copy them as they are, add no id). Without a usable id (name each « non mesurée (sans id utilisable) » in the report): manager.`,
  )
  const alone = mission()
  alone.owner = M2
  expect(discussionsLine(alone)).not.toContain('Without a usable id')
})

test('un groupe à l’id hors forme ne donne aucun couple : ses envois comptent « worker », sans id de groupe', () => {
  const run = mission()
  run.bornIn = M1
  run.groups = [
    { id: 'A', name: 'Un', tickets: [], delegated: { at: 1_000, session: W1 } },
    { id: 'Groupe-REPERE', name: 'Deux', tickets: [], delegated: { at: 1_000, session: W2, earlier: [{ at: 500, session: 'ffffffff' }] } },
  ] as Run['groups']
  const line = discussionsLine(run)!
  expect(line).toBe(
    `${PREFIX}recap arguments « --discussions manager:${M1},worker-A:${W1} --since 2026-11-19 » (copy them as they are, add no id). Without a usable id (name each « non mesurée (sans id utilisable) » in the report): worker (2).`,
  )
  expect(line).not.toContain(W2)
})

test('worker de diagnostic : un couple diagnostic en forme d’uuid ; hors forme, compté « diagnostic »', () => {
  const run = mission()
  run.bornIn = M1
  run.handoff = { at: 1_000, from: M1, by: W1 }
  expect(discussionsLine(run)).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},diagnostic:${W1} --since 2026-11-19 » (copy them as they are, add no id).`)
  // Un id court ne vaut pas pour le diagnostic : seul un uuid entier est noté par `resume`.
  run.handoff = { at: 1_000, from: M1, by: 'local_REPERE' }
  expect(discussionsLine(run)).toBe(
    `${PREFIX}recap arguments « --discussions manager:${M1} --since 2026-11-19 » (copy them as they are, add no id). Without a usable id (name each « non mesurée (sans id utilisable) » in the report): diagnostic.`,
  )
})

test('mission sans aucun id utilisable : la ligne sans arguments, et la seconde partie quand elle a de quoi', () => {
  const run = mission()
  expect(discussionsLine(run)).toBe(`${PREFIX}no discussion with a usable id.`)
  run.owner = 'local_x'
  run.groups = [{ id: 'A', name: 'Un', tickets: [], linked: { at: 1_000 } }] as Run['groups']
  expect(discussionsLine(run)).toBe(
    `${PREFIX}no discussion with a usable id. Without a usable id (name each « non mesurée (sans id utilisable) » in the report): manager, worker-A.`,
  )
})

test('un début hors forme rend les arguments sans --since', () => {
  const run = mission()
  run.bornIn = M1
  const without = `${PREFIX}recap arguments « --discussions manager:${M1} » (copy them as they are, add no id).`
  ;(run as { startedAt: unknown }).startedAt = 'REPERE'
  expect(discussionsLine(run)).toBe(without)
  // Au-delà de l'an 9999, l'année écrite sortirait de la forme AAAA-MM-JJ.
  for (const bad of [Number.NaN, -1, Date.UTC(10_000, 0, 5), 9e15]) {
    run.startedAt = bad
    expect(missionDiscussionsLine(run)).toBe(without)
  }
})

test('relu d’un fichier partagé : un groupe, un lien ou une entrée de earlier qui n’est pas un objet est ignoré sans erreur', () => {
  const run = mission()
  run.bornIn = M1
  run.groups = [
    null,
    'A',
    { id: 'A', name: 'Un', tickets: [], delegated: { at: 2_000, session: W2, earlier: [null, 'REPERE', 3, { at: 1_000, session: 'aaaaaaaa' }] }, linked: 'REPERE' },
    { id: 'B', name: 'Deux', tickets: [], delegated: 7 },
  ] as unknown as Run['groups']
  // La fonction seule : le reste des faits ne lit pas un groupe qui n'est pas un objet.
  const line = missionDiscussionsLine(run)
  expect(line).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},worker-A:aaaaaaaa,worker-A:${W2} --since 2026-11-19 » (copy them as they are, add no id).`)
})

test('un id de fermeture qui ne prolonge pas l’id noté à l’envoi n’est pas pris ; un id court et son id entier ne font qu’un couple', () => {
  const run = mission()
  run.bornIn = M1
  run.groups = [
    // Erreur de copie du manager : l'id du manager noté à la fermeture du groupe A.
    { id: 'A', name: 'Un', tickets: [], delegated: { at: 1_000, session: 'aaaaaaaa', closing: { state: 'stopped', at: 1_100, sessionId: M1 } } },
    // Deux envois de la même session : l'id court d'abord, puis l'id entier à la fermeture du second.
    { id: 'B', name: 'Deux', tickets: [], delegated: { at: 2_000, session: 'bbbbbbbb', closing: { state: 'closed', at: 2_100, sessionId: W2 }, earlier: [{ at: 1_000, session: 'bbbbbbbb' }] } },
  ] as Run['groups']
  expect(discussionsLine(run)).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},worker-A:aaaaaaaa,worker-B:bbbbbbbb --since 2026-11-19 » (copy them as they are, add no id).`)
})

test('pendant que le worker de diagnostic tient la mission, le manager est la discussion qui la lui a passée, jamais lui', () => {
  const run = mission()
  run.bornIn = M1
  run.owner = W1
  run.handoff = { at: 1_000, from: M2, by: W1, byAt: 1_100 }
  expect(discussionsLine(run)).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},manager:${M2},diagnostic:${W1} --since 2026-11-19 » (copy them as they are, add no id).`)
  // Le passage fermé : la discussion active est de nouveau le manager.
  run.owner = M2
  run.handoff = { at: 1_000, from: M2, by: W1, byAt: 1_100, closedAt: 2_000 }
  expect(discussionsLine(run)).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},manager:${M2},diagnostic:${W1} --since 2026-11-19 » (copy them as they are, add no id).`)
  // Fermé (archivage) sans que `owner` quitte le diagnostic : le manager reste celui du passage.
  run.owner = W1
  expect(discussionsLine(run)).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},manager:${M2},diagnostic:${W1} --since 2026-11-19 » (copy them as they are, add no id).`)
  // Le manager du passage hors forme : compté « manager », sa valeur jamais recopiée.
  run.owner = W1
  run.handoff = { at: 1_000, from: 'local_REPERE', by: W1 }
  const line = discussionsLine(run)!
  expect(line).toContain('Without a usable id (name each « non mesurée (sans id utilisable) » in the report): manager.')
  expect(line).not.toContain('REPERE')
  expect(line).not.toContain(`manager:${W1}`)
})

test('deux couples ne se confondent que pour le même rôle et le même id : les groupes A et a restent deux rôles', () => {
  const run = mission()
  run.bornIn = M1
  run.owner = M1.toUpperCase()
  run.groups = [
    { id: 'A', name: 'Un', tickets: [], delegated: { at: 1_000, session: W1, earlier: [{ at: 500, session: W1.toUpperCase() }] } },
    { id: 'a', name: 'Deux', tickets: [], delegated: { at: 1_000, session: W1 } },
  ] as Run['groups']
  expect(discussionsLine(run)).toBe(`${PREFIX}recap arguments « --discussions manager:${M1},worker-A:${W1.toUpperCase()},worker-a:${W1} --since 2026-11-19 » (copy them as they are, add no id).`)
})

test('le corpus hostile commun, glissé dans chaque id et chaque id de groupe, ne paraît jamais dans la ligne', () => {
  // Une chaîne glissée au milieu d'un id par ailleurs valide : la ligne exacte prouve qu'aucune valeur n'y est recopiée.
  for (const bad of Object.values(CORPUS)) {
    const inside = (id: string) => `${id.slice(0, 4)}${bad}${id.slice(4)}`
    const run = mission()
    run.bornIn = inside(M1)
    // La mission tenue par le diagnostic : le manager se lit dans `from`.
    run.owner = inside(W1)
    run.handoff = { at: 1_000, from: inside(M2), by: inside(W1) }
    run.groups = [
      { id: inside('AB'), name: 'Un', tickets: [], delegated: { at: 1_000, session: W1 } },
      { id: 'C', name: 'Deux', tickets: [], delegated: { at: 1_000, session: inside('cccccccc'), closing: { state: 'closed', at: 1_100, sessionId: inside(W2) } } },
    ] as Run['groups']
    expect(missionDiscussionsLine(run)).toBe(
      `${PREFIX}no discussion with a usable id. Without a usable id (name each « non mesurée (sans id utilisable) » in the report): manager (2), worker, worker-C, diagnostic.`,
    )
  }
  // Une valeur qui n'est pas une chaîne se passe entière : jamais un couple, et `null` ou `undefined` valent un champ absent.
  for (const bad of Object.values(NON_TEXT)) {
    const run = mission()
    ;(run as Record<string, unknown>).bornIn = bad
    run.handoff = { at: 1_000, from: M1, by: bad as string }
    run.groups = [
      { id: bad as string, name: 'Un', tickets: [], delegated: { at: 1_000, session: W1 } },
      { id: 'C', name: 'Deux', tickets: [], delegated: { at: 1_000, session: bad as string, closing: { state: 'closed', at: 1_100, sessionId: bad as string } } },
    ] as Run['groups']
    const line = missionDiscussionsLine(run)
    expect(line.includes('--discussions')).toBe(false)
    expect(/\b(ab|42|true|Infinity)\b/.test(line)).toBe(false)
  }
})
