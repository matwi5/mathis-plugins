// Chaque champ du lien d'une session liée (GroupLink d'un groupe, LinkedWork des pistes, Closing de
// sa fermeture, ClosedLink d'un envoi remplacé), sur chaque chemin qui réécrit ou fusionne le
// parcours : la classe « donnée du lien perdue à la réécriture ou à la fusion » était sortie dans
// quatre passes « bogues » (sessions précédentes, compteur d'envois, envoi en cours) et avait demandé
// deux tickets. Le jeu d'essai remplit chaque champ que déclarent les types (types/index.d.ts) : un
// champ ajouté aux types fait échouer le test tant que le jeu d'essai ne le porte pas, puis tant que
// chaque chemin ne le garde pas ou n'a pas d'exception motivée ci-dessous.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit les types et appelle le modèle
// (model.ts, lu en retirant ses types : Node 22.18 ou plus récent ; plus ancien, le test le dit).

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** Node lit le TypeScript en retirant ses types depuis la 22.18 : plus ancien, le test se saute en le disant ; sinon une erreur d'import fait échouer. */
const [major, minor] = process.versions.node.split('.').map(Number)
const isOldNode = major < 22 || (major === 22 && minor < 18)
const model = isOldNode ? null : await import('../hooks/model.ts')
const SKIP = model ? false : `Node ${process.versions.node} ne lit pas model.ts : il faut Node 22.18 ou plus récent`

const TYPES = readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8')

/** Les clés de premier niveau d'un `type <name> = { … }`, sur plusieurs lignes ou sur une seule. */
const keysOf = name => {
  const start = TYPES.indexOf(`type ${name} = {`)
  assert.ok(start >= 0, `type ${name} introuvable`)
  let depth = 0
  let body = ''
  for (let i = TYPES.indexOf('{', start); i < TYPES.length; i++) {
    const c = TYPES[i]
    if (c === '{') depth += 1
    if (c === '}') depth -= 1
    if (depth === 0) break
    if (depth === 1 && c !== '{') body += c
    else if (depth > 1) body += ' '
  }
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split(/[;\n]/)
    .map(part => part.match(/^\s*([A-Za-z_]\w*)\??\s*:/)?.[1])
    .filter(Boolean)
}

const UUID = '178bd61c-0416-4d88-8317-cc583d9f0d47'
const CLOSING = { state: 'closed', why: 'fermée', at: 9_000, sessionId: UUID, branch: 'worktree-groupe-essai-A-2', worktree: '/r/.claude/worktrees/groupe-essai-a-2', cleanupAt: 9_500 }
const CLOSED_LINK = { at: 3_000, session: 'sess-1', seq: 1, closing: { ...CLOSING, at: 3_500, branch: 'worktree-groupe-essai-A' } }
const GROUP_LINK = { at: 4_000, session: 'sess-2', closeAskedAt: 8_000, seq: 2, closing: CLOSING, touchedAt: 7_000, earlier: [CLOSED_LINK] }
const LINKED_WORK = { items: ['p1'], at: 4_000, session: 'sess-p', missedAt: 4_500, closing: CLOSING, touchedAt: 7_000, closeAskedAt: 8_000, seq: 2 }
const FIXTURES = { GroupLink: GROUP_LINK, LinkedWork: LINKED_WORK, Closing: CLOSING, ClosedLink: CLOSED_LINK }

test('le jeu d’essai remplit chaque champ que déclarent les types du lien', () => {
  for (const [type, fixture] of Object.entries(FIXTURES)) {
    const missing = keysOf(type).filter(key => !(key in fixture))
    assert.deepEqual(missing, [], `${type} : champs absents du jeu d'essai (les y ajouter, puis décider de chaque chemin)`)
  }
})

/** Les champs d'un lien qu'un chemin a perdus : présents dans le jeu d'essai, absents après, sauf exceptions. */
const lost = (type, after, exceptions = {}) => {
  if (after === undefined) return ['(lien entier)']
  const out = keysOf(type).filter(key => FIXTURES[type][key] !== undefined && after[key] === undefined && !(key in exceptions))
  if (type === 'GroupLink' || type === 'LinkedWork') {
    if (after.closing) out.push(...lost('Closing', after.closing).map(k => `closing.${k}`))
  }
  if (type === 'GroupLink' && Array.isArray(after.earlier)) {
    for (const [i, prev] of after.earlier.entries()) out.push(...lost('ClosedLink', prev).map(k => `earlier[${i}].${k}`))
  }
  return out
}

// ─── Les groupes ─────────────────────────────────────────────────────────

const T0 = 10_000
const PLAN = [{ id: 'A', tickets: ['t1'] }, { id: 'B', tickets: ['t2'] }]

/** Un parcours à deux groupes ; A porte le lien complet, encore confié (`linked`) ou rendu (`delegated`). */
const groups = where => {
  const run = model.newRun('implement', T0, 'Essai')
  let board = { ...model.emptyBoard('/r', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = model.applyReport(board, { tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }], groups: PLAN }, T0 + 1).board
  board = model.startLinkedGroups(board, ['A'], T0 + 2).board
  const a = model.activeRun(board).groups.find(g => g.id === 'A')
  a.sends = 2
  a.isReset = true
  if (where === 'linked') a.linked = structuredClone(GROUP_LINK)
  else {
    delete a.linked
    a.delegated = structuredClone(GROUP_LINK)
  }
  return board
}
const groupA = board => model.activeRun(board).groups.find(g => g.id === 'A')

test('renvoi du plan des groupes : le lien d’un groupe confié ou rendu garde chaque champ', { skip: SKIP }, () => {
  for (const where of ['linked', 'delegated']) {
    const out = model.applyReport(groups(where), { groups: PLAN }, T0 + 100).board
    assert.deepEqual(lost('GroupLink', groupA(out)[where]), [], where)
    assert.equal(groupA(out).sends, 2)
    assert.equal(groupA(out).isReset, true, `${where} : la marque de la remise à zéro`)
  }
  // Omis du plan renvoyé, un groupe déjà confié reste, avec son lien et son compteur.
  const omitted = model.applyReport(groups('delegated'), { groups: [{ id: 'B', tickets: ['t1', 't2'] }, { id: 'C', tickets: [] }] }, T0 + 100).board
  assert.deepEqual(lost('GroupLink', groupA(omitted)?.delegated), [])
  assert.equal(groupA(omitted).sends, 2)
  assert.equal(groupA(omitted).isReset, true)
})

test('retrait d’un ticket : le lien du groupe garde chaque champ', { skip: SKIP }, () => {
  for (const where of ['linked', 'delegated']) {
    const out = model.applyReport(groups(where), { remove: ['t2'] }, T0 + 100).board
    assert.deepEqual(lost('GroupLink', groupA(out)[where]), [], where)
    assert.equal(groupA(out).isReset, true, where)
  }
})

test('retour d’un groupe : le lien confié devient le lien rendu avec chaque champ ; la marque de la remise à zéro s’efface', { skip: SKIP }, () => {
  const out = model.applyReport(groups('linked'), { returned: ['A'], set: [{ id: 't1', status: 'done' }] }, T0 + 100).board
  assert.deepEqual(lost('GroupLink', groupA(out).delegated), [])
  // `isReset` du groupe ne vaut que jusqu'au retour d'un envoi.
  assert.equal(groupA(out).isReset, undefined)
})

test('fusion de deux copies : la plus récente garde chaque champ, la fermeture de l’autre revient', { skip: SKIP }, () => {
  const stored = groups('delegated')
  const local = structuredClone(stored)
  const link = groupA(local).delegated
  delete link.closing
  delete link.earlier[0].closing
  model.activeRun(local).updatedAt = 99_000
  const merged = model.mergeBoards(local, stored)
  assert.deepEqual(lost('GroupLink', groupA(merged).delegated), [])
  assert.equal(groupA(merged).isReset, true)
})

// ─── Les pistes d'une phase ──────────────────────────────────────────────

const PISTES = [
  { id: 'p1', label: 'Contrôles : a', status: 'todo' },
  { id: 'p2', label: 'Accès : b', status: 'todo' },
]

/** Une rétro dont la phase porte le lien complet des pistes, `link` remplaçant ce qu'il faut. */
const retro = (link = {}) => {
  const run = { ...model.newRun('retro', T0, 'Rétro'), owner: 's' }
  let board = { ...model.emptyBoard('/r', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = model.applyReport(board, { items: PISTES, step: 'present' }, T0 + 1).board
  const phase = model.currentPhase(model.activeRun(board))
  phase.linked = { ...structuredClone(LINKED_WORK), ...link }
  phase.linkedEarlier = structuredClone(CLOSED_LINK)
  phase.linkedSends = 2
  return board
}
const phaseOf = board => model.currentPhase(model.activeRun(board))

test('renvoi des pistes : le lien de la phase garde chaque champ', { skip: SKIP }, () => {
  const out = model.applyReport(retro(), { items: [{ ...PISTES[0], status: 'doing' }, PISTES[1]] }, T0 + 100).board
  assert.deepEqual(lost('LinkedWork', phaseOf(out).linked), [])
  assert.deepEqual(lost('ClosedLink', phaseOf(out).linkedEarlier), [])
  assert.equal(phaseOf(out).linkedSends, 2)
})

test('appel du découpage des pistes après une session fermée : le lien et l’envoi remplacé gardent chaque champ', { skip: SKIP }, () => {
  const call = {
    step: 'split',
    items: PISTES.map(i => ({ ...i, status: 'done' })),
    tickets: [{ id: '07', name: 'Contrôles et accès', sensitive: false, logic: true }],
    groups: [{ id: 'A', name: 'Contrôles', tickets: ['07'] }],
    complete: true,
  }
  const out = model.applyReport(retro({ items: [] }), call, T0 + 100).board
  const phase = out.runs[0].phases[0]
  assert.deepEqual(out.runs[0].tickets.map(t => t.id), ['07'])
  assert.deepEqual(lost('LinkedWork', phase.linked), [])
  assert.deepEqual(lost('ClosedLink', phase.linkedEarlier), [])
  assert.equal(phase.linkedSends, 2)
})

test('annulation d’un envoi des pistes sans session : le lien part, l’envoi remplacé et le compteur restent', { skip: SKIP }, () => {
  const board = retro({ session: undefined, closing: undefined })
  const out = model.cancelLinked(board, T0 + 100).board
  assert.equal(phaseOf(out).linked, undefined)
  assert.deepEqual(lost('ClosedLink', phaseOf(out).linkedEarlier), [])
  assert.equal(phaseOf(out).linkedSends, 2)
})

test('fusion de deux copies d’une rétro : la fermeture des pistes et l’envoi remplacé reviennent', { skip: SKIP }, () => {
  const stored = retro()
  const local = structuredClone(stored)
  delete phaseOf(local).linked.closing
  delete phaseOf(local).linkedEarlier
  model.activeRun(local).updatedAt = 99_000
  const merged = model.mergeBoards(local, stored)
  assert.deepEqual(lost('LinkedWork', phaseOf(merged).linked), [])
  assert.deepEqual(lost('ClosedLink', phaseOf(merged).linkedEarlier), [])
})

test('le test voit un champ perdu : un lien sans « earlier » échoue', () => {
  const { earlier: _, ...without } = GROUP_LINK
  assert.deepEqual(lost('GroupLink', without), ['earlier'])
  assert.deepEqual(lost('GroupLink', { ...GROUP_LINK, closing: { state: 'closed', at: 1 } }), ['closing.why', 'closing.sessionId', 'closing.branch', 'closing.worktree', 'closing.cleanupAt'])
})
