// Le nom du worktree d'un envoi de groupe, noté dans son lien au lancement (`worktreeName`) : la
// fermeture, sa vérification par le script, le nettoyage des branches et la marque de la consigne le
// lisent, au lieu de le recalculer depuis le titre courant de la mission (un titre corrigé après le
// lancement faisait viser un worktree qui n'existait pas, et garder les branches « nom inattendu »).
// Invariant : le nom noté au lancement d'un envoi ne change plus et ne disparaît qu'avec le lien de
// cet envoi ; un nom relu hors forme n'entre dans aucune commande ni aucun texte de fermeture.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il appelle le modèle (model.ts, lu en
// retirant ses types : Node 22.18 ou plus récent ; plus ancien, le test le dit).

import { test } from 'node:test'
import assert from 'node:assert/strict'

const [major, minor] = process.versions.node.split('.').map(Number)
const isOldNode = major < 22 || (major === 22 && minor < 18)
const model = isOldNode ? null : await import('../hooks/model.ts')
const basics = isOldNode ? null : await import('../hooks/basics.ts')
const closing = isOldNode ? null : await import('../hooks/closing.ts')
const linkModule = isOldNode ? null : await import('../hooks/link.ts')
const SKIP = model ? false : `Node ${process.versions.node} ne lit pas model.ts : il faut Node 22.18 ou plus récent`

const T0 = 10_000
const PLAN = [{ id: 'A', tickets: ['t1'] }, { id: 'B', tickets: ['t2'] }]

/** Une mission « Titre de départ » à deux groupes, A confié à un worker. */
const launched = (title = 'Titre de départ', entry = 'implement') => {
  const run = model.newRun(entry, T0, title)
  let board = { ...model.emptyBoard('/r', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = model.applyReport(board, { tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }], groups: PLAN }, T0 + 1).board
  return model.startLinkedGroups(board, ['A'], T0 + 2).board
}
const groupA = board => basics.activeRun(board).groups.find(g => g.id === 'A')

test('le lancement note le nom du worktree de l’envoi dans son lien', { skip: SKIP }, () => {
  assert.equal(groupA(launched()).linked.worktreeName, 'groupe-titre-de-depart-A')
})

test('chaque nom que le lancement donne est noté, au premier envoi comme aux suivants (sans titre, rétro, titre long ou sans lettre ASCII)', { skip: SKIP }, () => {
  const titles = [['', 'implement'], ['Rétrospective · Fermer les groupes', 'retro'], ['Rétrospective', 'retro'], ['Un titre très long qui dépasse de loin la longueur du nom court des worktrees de groupe', 'implement'], ['日本語のみ', 'implement'], ['—', 'implement'], ['A-B · c.d', 'implement']]
  const firsts = []
  for (const [title, entry] of titles) {
    let board = launched(title, entry)
    const first = groupA(board).linked
    firsts.push(first.worktreeName)
    // Rendu, puis confié de nouveau : l'envoi 2 note son propre nom, suffixé.
    board = model.applyReport(board, { returned: ['A'] }, T0 + 10).board
    board = model.startLinkedGroups(board, ['A'], T0 + 20).board
    assert.equal(groupA(board).linked.seq, 2)
    assert.equal(groupA(board).linked.worktreeName, `${first.worktreeName}-2`, `titre « ${title} »`)
    assert.equal(groupA(board).delegated.worktreeName, first.worktreeName, 'le premier envoi garde le sien')
  }
  assert.deepEqual(firsts, [
    // Sans titre : celui par défaut de la phase d'entrée ; les noms courts coupés à un mot entier.
    'groupe-implementation-A',
    'groupe-retro-fermer-les-A',
    'groupe-retro-A',
    'groupe-un-titre-tres-long-A',
    'groupe-A',
    'groupe-A',
    'groupe-a-b-c-d-A',
  ])
})

// ─── L'invariant sur chaque chemin qui réécrit, déplace ou fusionne le lien ─────────

const NOTED = 'groupe-titre-de-depart-A'

test('titre changé après le lancement (fix.title, /flow rename, premier titre envoyé) : le nom noté ne bouge pas', { skip: SKIP }, () => {
  const fixed = model.applyReport(launched(), { fix: { title: 'Titre corrigé' } }, T0 + 5).board
  assert.equal(basics.activeRun(fixed).title, 'Titre corrigé')
  assert.equal(groupA(fixed).linked.worktreeName, NOTED)
  const before = launched()
  const renamed = model.renameRun(before, basics.activeRun(before).id, 'Autre nom', T0 + 5)?.board
  assert.equal(basics.activeRun(renamed).title, 'Autre nom')
  assert.equal(groupA(renamed).linked.worktreeName, NOTED)
  // Une mission pas encore titrée : son premier titre, envoyé après le lancement, ne change pas le nom noté.
  const untitled = launched('')
  const first = groupA(untitled).linked.worktreeName
  const titled = model.applyReport(untitled, { title: 'Premier titre' }, T0 + 5).board
  assert.equal(basics.activeRun(titled).title, 'Premier titre')
  assert.equal(groupA(titled).linked.worktreeName, first)
})

test('retour, renvoi du plan, deuxième et troisième envois, reprise : chaque envoi garde son nom', { skip: SKIP }, () => {
  let board = model.applyReport(launched(), { fix: { title: 'Titre corrigé' } }, T0 + 5).board
  board = model.applyReport(board, { returned: ['A'] }, T0 + 10).board
  assert.equal(groupA(board).delegated.worktreeName, NOTED, 'retour : le lien rendu')
  board = model.applyReport(board, { groups: [...PLAN, { id: 'C', tickets: [] }] }, T0 + 11).board
  assert.equal(groupA(board).delegated.worktreeName, NOTED, 'plan renvoyé')
  board = model.startLinkedGroups(board, ['A'], T0 + 20).board
  assert.equal(groupA(board).linked.worktreeName, 'groupe-titre-corrige-A-2', 'deuxième envoi : le nom du titre de son lancement')
  board = model.applyReport(board, { returned: ['A'] }, T0 + 30).board
  board = model.startLinkedGroups(board, ['A'], T0 + 40).board
  board = model.applyReport(board, { returned: ['A'] }, T0 + 50).board
  const link = groupA(board).delegated
  assert.equal(link.worktreeName, 'groupe-titre-corrige-A-3')
  assert.deepEqual(link.earlier.map(e => e.worktreeName), [NOTED, 'groupe-titre-corrige-A-2'], 'les envois précédents, dans earlier, gardent chacun le sien')
  // Reprise : la mission mise de côté puis reprise garde ses liens tels quels.
  const id = basics.activeRun(board).id
  const other = model.newRun('implement', T0 + 60, 'Autre mission')
  const aside = { ...board, runs: [...board.runs, other], activeId: other.id }
  const resumed = model.resumeRun(aside, id, T0 + 70).board
  assert.deepEqual(groupA(resumed).delegated, link)
})

/** Deux copies d'une mission : `local`, la plus récente (gardée), et `stored`. */
const copies = board => {
  const stored = structuredClone(board)
  const local = structuredClone(board)
  basics.activeRun(local).updatedAt = 99_000
  return { local, stored }
}

test('fusion de deux copies : un nom absent de la copie gardée revient de l’autre, au même envoi, à n’importe quelle étape', { skip: SKIP }, () => {
  // La copie gardée a rendu le groupe et reconstruit son envoi sans le nom (une session sur l'ancien code) ;
  // l'autre l'a encore en vol (linked).
  let board = launched()
  const { local, stored } = copies(board)
  let kept = model.applyReport(local, { returned: ['A'] }, T0 + 10).board
  delete groupA(kept).delegated.worktreeName
  basics.activeRun(kept).updatedAt = 99_000
  let merged = model.mergeBoards(kept, stored)
  assert.equal(groupA(merged).delegated.worktreeName, NOTED, 'linked de l’autre copie')
  // Dans earlier de la copie gardée, delegated de l'autre.
  board = model.applyReport(launched(), { returned: ['A'] }, T0 + 10).board
  const two = copies(board)
  kept = model.startLinkedGroups(two.local, ['A'], T0 + 20).board
  kept = model.applyReport(kept, { returned: ['A'] }, T0 + 30).board
  delete groupA(kept).delegated.earlier[0].worktreeName
  basics.activeRun(kept).updatedAt = 99_000
  merged = model.mergeBoards(kept, two.stored)
  assert.equal(groupA(merged).delegated.earlier[0].worktreeName, NOTED, 'delegated de l’autre copie')
  assert.equal(groupA(merged).delegated.worktreeName, 'groupe-titre-de-depart-A-2', 'l’envoi suivant garde le sien')
  // Un envoi d'une autre date n'apporte rien : le nom n'est jamais pris à un autre envoi.
  const three = copies(launched())
  delete groupA(three.local).linked.worktreeName
  groupA(three.stored).linked.at = T0 + 3
  assert.equal(groupA(model.mergeBoards(three.local, three.stored)).linked.worktreeName, undefined)
})

test('fusion de deux copies aux noms différents pour le même envoi : le nom de la copie gardée ne change pas, le conflit est marqué et ne s’efface plus', { skip: SKIP }, () => {
  const { local, stored } = copies(launched())
  groupA(stored).linked.worktreeName = 'groupe-autre-A'
  const merged = model.mergeBoards(local, stored)
  assert.equal(groupA(merged).linked.worktreeName, NOTED, 'le nom de la copie gardée ne change pas')
  assert.equal(groupA(merged).linked.worktreeClash, true)
  // Monotone : marqué dans l'autre copie seulement, il l'est après la fusion ; et il suit le lien au retour.
  const again = copies(launched())
  groupA(again.stored).linked.worktreeClash = true
  let board = model.mergeBoards(again.local, again.stored)
  assert.equal(groupA(board).linked.worktreeClash, true)
  board = model.applyReport(board, { returned: ['A'] }, T0 + 10).board
  board = model.startLinkedGroups(board, ['A'], T0 + 20).board
  board = model.applyReport(board, { returned: ['A'] }, T0 + 30).board
  assert.equal(groupA(board).delegated.earlier[0].worktreeClash, true)
  assert.equal(groupA(board).delegated.worktreeClash, undefined, 'un nouvel envoi n’hérite pas du conflit')
})

test('fusion de deux copies, dans les deux ordres : le nom noté et la marque du conflit ne changent jamais', { skip: SKIP }, () => {
  // Chaque copie tour à tour celle d'ici (gardée) : elle garde son nom, et le conflit est marqué.
  for (const isSwapped of [false, true]) {
    const { local, stored } = copies(launched())
    groupA(stored).linked.worktreeName = 'groupe-autre-A'
    const [here, there] = isSwapped ? [stored, local] : [local, stored]
    const merged = model.mergeBoards(here, there)
    assert.equal(groupA(merged).linked.worktreeName, groupA(here).linked.worktreeName, 'la copie gardée garde son nom')
    assert.equal(groupA(merged).linked.worktreeClash, true, isSwapped ? 'ordre inverse' : 'ordre direct')
  }
})

test('fusion de deux copies, une valeur abîmée : un lien ou un groupe qui n’est pas un objet n’apporte rien, un nom abîmé arrête la fermeture', { skip: SKIP }, () => {
  // Un lien abîmé dans l'autre copie : rien n'est pris, rien ne tombe.
  const one = copies(launched())
  delete groupA(one.local).linked.worktreeName
  groupA(one.stored).linked = 'abîmé'
  assert.equal(groupA(model.mergeBoards(one.local, one.stored)).linked.worktreeName, undefined)
  // Un nom abîmé dans l'autre copie, absent de la gardée : il revient tel quel, et la fermeture s'arrête (aucun recalcul).
  const two = copies(launched())
  delete groupA(two.local).linked.worktreeName
  groupA(two.stored).linked.worktreeName = 42
  const merged = model.mergeBoards(two.local, two.stored)
  assert.equal(groupA(merged).linked.worktreeName, 42)
  assert.equal(closing.hasSendName('A', undefined, groupA(merged).linked), false)
})

// ─── La fermeture, le script et le nettoyage des branches lisent le nom noté ───────────

const REPO = { isRepo: true }
const SCRIPT = '/plugins/flow-board/scripts/fermeture.mjs'
const UUID = '178bd61c-0416-4d88-8317-cc583d9f0d47'

/** A lancé sous « Titre de départ », le titre corrigé ensuite, puis A rendu, relu, sécurité tranchée : à fermer. */
const closable = (edit = () => {}) => {
  let board = model.applyReport(launched(), { fix: { title: 'Titre corrigé' } }, T0 + 5).board
  edit(groupA(board).linked)
  board = model.applyReport(board, { set: [{ id: 't1', status: 'done' }], returned: ['A'] }, T0 + 10, REPO).board
  board = model.applyReport(board, { reviewed: ['A'] }, T0 + 11, REPO).board
  return model.applyReport(board, { security: { group: 'A', advised: false, why: 'doc seule' } }, T0 + 12, REPO).board
}
const answer = board => model.applyReport(board, { note: 'point' }, T0 + 20, REPO).text
const withScript = f => {
  const was = closing.closingScript.path
  closing.closingScript.path = SCRIPT
  try {
    return f()
  } finally {
    closing.closingScript.path = was
  }
}
const target = { kind: 'group', id: 'A', name: 'A' }

test('titre changé après le lancement : la fermeture cite le worktree du lancement, et le nettoyage vise sa branche', { skip: SKIP }, () => {
  const board = closable()
  const text = withScript(() => answer(board))
  assert.match(text, /Close now: group A/)
  assert.ok(text.includes(`--worktree '${NOTED}' --branche 'worktree-${NOTED}' --branche '${NOTED}' --branche 'groupe-A'`), 'la commande du script')
  assert.ok(!text.includes('groupe-titre-corrige'), 'aucun nom tiré du titre courant')
  // Sans le script : la procédure entière nomme aussi le worktree du lancement.
  const full = answer(board)
  assert.ok(full.includes(`worktree-${NOTED} (lancée par le CLI)`))
  assert.ok(!full.includes('groupe-titre-corrige'))
  // Fermé, sa branche notée sous le nom du lancement : le nettoyage la supprime, et la marque suit.
  const closed = model.applyReport(board, { closed: [{ group: 'A', state: 'closed', sessionId: UUID, branch: `worktree-${NOTED}`, worktree: `/r/.claude/worktrees/${NOTED}` }] }, T0 + 30, REPO).board
  const run = basics.activeRun(closed)
  const cleanup = closing.branchCleanup({ run, isRepo: true, root: '/r' })
  assert.deepEqual(cleanup.branches, [`worktree-${NOTED}`])
  const marked = linkModule.markCleanupSent(closed, run.id, cleanup.branches, T0 + 40).board
  assert.equal(groupA(marked).delegated.closing.cleanupAt, T0 + 40)
  // Une branche sous le nom du titre courant n'est pas celle de cet envoi : gardée.
  const other = model.applyReport(board, { closed: [{ group: 'A', state: 'closed', sessionId: UUID, branch: 'worktree-groupe-titre-corrige-A', worktree: '/r/.claude/worktrees/groupe-titre-corrige-A' }] }, T0 + 30, REPO).board
  assert.deepEqual(closing.branchCleanup({ run: basics.activeRun(other), isRepo: true, root: '/r' }).branches, [])
})

test('lien sans nom noté (d’avant la note) : le nom se recalcule depuis le titre, comme avant', { skip: SKIP }, () => {
  const board = closable(link => delete link.worktreeName)
  const text = withScript(() => answer(board))
  assert.ok(text.includes("--worktree 'groupe-titre-corrige-A'"))
})

test('nom noté inconnu du dépôt : le script reçoit ce seul nom, sans autre essayé', { skip: SKIP }, () => {
  const board = closable(link => (link.worktreeName = 'groupe-ancien-A'))
  const text = withScript(() => answer(board))
  assert.equal(text.match(/--worktree /g).length, 1)
  assert.ok(text.includes("--worktree 'groupe-ancien-A' --branche 'worktree-groupe-ancien-A' --branche 'groupe-ancien-A' --branche 'groupe-A'"))
  assert.ok(!text.includes('groupe-titre-'))
})

test('nom noté hors forme, ou en conflit entre deux copies : aucune commande, aucun nom, la fermeture s’arrête et le dit ; sa branche reste', { skip: SKIP }, () => {
  const cases = [
    ['<id>', l => (l.worktreeName = '<id>')],
    ['vide', l => (l.worktreeName = '')],
    ['autre type', l => (l.worktreeName = 42)],
    ['trop long', l => (l.worktreeName = `groupe-${'x'.repeat(200)}-A`)],
    ['caractère hors liste', l => (l.worktreeName = "groupe-a'b-A")],
    ['option', l => (l.worktreeName = '-groupe-A')],
    ['.lock', l => (l.worktreeName = 'groupe-x.lock')],
    ['autre groupe', l => (l.worktreeName = 'groupe-titre-de-depart-B')],
    ['autre envoi', l => (l.worktreeName = 'groupe-titre-de-depart-A-2')],
    ['conflit', l => (l.worktreeClash = true)],
  ]
  for (const [what, edit] of cases) {
    const board = closable(edit)
    for (const text of [withScript(() => answer(board)), answer(board)]) {
      assert.match(text, /Do not close/, what)
      assert.doesNotMatch(text, /Close now|--worktree|git worktree remove|claude stop|"state": "closed"/, what)
      assert.ok(!text.includes('<id>-') && !text.includes("a'b") && !text.includes('x.lock'), `${what} : le nom relu n'est pas cité`)
    }
    // Sans git aussi : le refus vaut avec git comme sans.
    assert.match(model.applyReport(board, { note: 'point' }, T0 + 20, { isRepo: false }).text, /Do not close/, what)
    const run = basics.activeRun(board)
    const link = groupA(board).delegated
    assert.match(closing.closingProcedure({ run, target, isRepo: false, hasReport: true, send: link }), /^Ne ferme pas/, what)
    // Seul l'arrêt se note ; une fermeture « closed » est refusée et la branche reste gardée.
    const out = model.applyReport(board, { closed: [{ group: 'A', state: 'closed', sessionId: UUID, branch: `worktree-${NOTED}`, worktree: `/r/.claude/worktrees/${NOTED}` }] }, T0 + 30, REPO)
    assert.equal(groupA(out.board).delegated.closing, undefined, what)
    assert.match(out.text, /closed: refused for A/, what)
    const forced = structuredClone(board)
    groupA(forced).delegated.closing = { state: 'closed', at: 1, sessionId: UUID, branch: `worktree-${NOTED}` }
    assert.deepEqual(closing.branchCleanup({ run: basics.activeRun(forced), isRepo: true, root: '/r' }).branches, [], what)
  }
})

/** Les appels « closed » que dicte un texte de la réponse (« Then send {…}: »), tels qu'écrits. */
const dictated = text => [...text.matchAll(/Then send (\{"closed": \[\{[^\]]*\}\]\})/g)].map(m => JSON.parse(m[1]))

test('le « stopped » que dicte le refus se rejoue tel qu’écrit : noté sur l’envoi refusé, et la fermeture ne se repropose plus', { skip: SKIP }, () => {
  const board = closable(l => (l.worktreeClash = true))
  const calls = dictated(answer(board))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { closed: [{ group: 'A', state: 'stopped', why: 'nom de worktree noté hors forme ou en conflit' }] })
  const out = model.applyReport(board, calls[0], T0 + 30, REPO)
  assert.equal(groupA(out.board).delegated.closing.state, 'stopped')
  assert.doesNotMatch(out.text, /refused/)
  assert.doesNotMatch(answer(out.board), /Do not close|Close now/)
})

test('un envoi précédent au nom en conflit : refusé seul, nommé par son envoi, son « stopped » rejoué sur lui ; l’envoi courant, sain, se ferme', { skip: SKIP }, () => {
  let board = model.applyReport(launched(), { fix: { title: 'Titre corrigé' } }, T0 + 5).board
  groupA(board).linked.worktreeClash = true
  board = model.applyReport(board, { set: [{ id: 't1', status: 'done' }], returned: ['A'] }, T0 + 10, REPO).board
  board = model.applyReport(board, { set: [{ id: 't1', status: 'todo' }] }, T0 + 15, REPO).board
  board = model.startLinkedGroups(board, ['A'], T0 + 20).board
  board = model.applyReport(board, { set: [{ id: 't1', status: 'done' }], returned: ['A'] }, T0 + 30, REPO).board
  board = model.applyReport(board, { reviewed: ['A'] }, T0 + 31, REPO).board
  board = model.applyReport(board, { security: { group: 'A', advised: false, why: 'doc seule' } }, T0 + 32, REPO).board
  const text = withScript(() => answer(board))
  assert.match(text, /Do not close: Ne ferme pas le worker de l’envoi 1 du groupe A .* Ce refus ne vaut que pour cet envoi/)
  assert.match(text, /Close now: group A/)
  assert.ok(text.includes("--worktree 'groupe-titre-corrige-A-2'"), 'l’envoi courant, sain, garde sa commande')
  const calls = dictated(text)
  const refusal = calls.find(c => c.closed[0].state === 'stopped')
  assert.deepEqual(refusal, { closed: [{ group: 'A', link: T0 + 2, state: 'stopped', why: 'nom de worktree noté hors forme ou en conflit' }] })
  const out = model.applyReport(board, refusal, T0 + 40, REPO)
  assert.equal(groupA(out.board).delegated.earlier[0].closing.state, 'stopped')
  assert.equal(groupA(out.board).delegated.closing, undefined, 'l’envoi courant n’est pas touché')
  // « closed » pour l'envoi précédent refusé, comme pour le courant.
  const closedPrev = model.applyReport(board, { closed: [{ group: 'A', link: T0 + 2, state: 'closed', sessionId: UUID }] }, T0 + 40, REPO)
  assert.match(closedPrev.text, /closed: refused for A \(sent at \d+: its noted worktree name is out of form or in conflict/)
  assert.equal(groupA(closedPrev.board).delegated.earlier[0].closing, undefined)
})

