import { expect, test } from 'claude-code/testing'

import { armStepper, CLOSE_WAIT_MS, compactionStarted, COMPACTION_MAX_MS, disarmStepper, isCompacting, isPromptPending, jalonsProven, judged, promptEntered, PROMPT_PENDING_MS, resendText, SENT_IDLE_MS, sendResult, stepAt, stepLabel, stepMissing, stepperNow, stepVerdict, stopStepper, turnEnded, type StepFresh, type StepPick } from '../hooks/pas-a-pas.ts'
import { parseRoadmap, type RoadmapEntry } from '../hooks/roadmap.ts'
import { cooStatement, statementText } from '../hooks/coo.ts'
import { emptyBoard } from '../hooks/model.ts'
import { headedStatement, withDueHead } from '../hooks/rangement.ts'

// Le pas à pas du rangement, sans moteur. Invariant : « Un message de tâche ne part que de la discussion qui tient le
// siège du COO, Claude au repos, hors d'une compaction, un seul pas à pas à la fois ; aucun effet n'est noté avant un
// envoi entré dans la session ; et le pas à pas ne ferme ni n'archive rien lui-même, et n'enregistre pas son propre
// état : il envoie un texte et relit des fichiers. »

const UUID = '11111111-2222-3333-4444-555555555555'
const close: StepPick = { task: { kind: 'close', sessions: [UUID] }, text: 'Tidy-up task « fermetures »', label: 'fermetures' }
const glean = (mission: string): StepPick => ({ task: { kind: 'glean', mission }, text: `Tidy-up task « relevé » ${mission}`, label: `relevé de « ${mission} »` })
const fresh = (over: Partial<StepFresh> = {}): StepFresh => ({ toCopy: new Set(), toClose: new Set(), toGlean: new Set(), decisions: 0, jalons: true, ...over })

/** Arme un pas à pas neuf, celui d'avant oublié. */
const armed = (source: 'archive' | 'delivery' = 'archive') => {
  disarmStepper()
  expect(armStepper(source, 'o1', 'seat')).toBe(true)
}

test('tâche entrée, jugée à la fin du tour qui suit ; faite : la suivante ; plus rien : fini', () => {
  armed()
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'send', text: close.text })
  // Pas avant le résultat de l'envoi, ni avant la fin du tour : rien à faire.
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'wait' })
  sendResult(true)
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'wait' })
  turnEnded(false)
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'judge' })
  judged('done', '')
  expect(stepAt(glean('m1'), [], '', 0)).toEqual({ kind: 'send', text: glean('m1').text })
  sendResult(true)
  turnEnded(false)
  judged('done', '')
  expect(stepperNow()?.gleaned).toBe(1)
  expect(stepAt(null, [], '', 0)).toEqual({ kind: 'done', why: '' })
})

test('pas faite : renvoyée une fois avec ce qui manque, puis arrêt ; un tour interrompu compte comme un essai', () => {
  armed()
  stepAt(close, [], '', 0)
  sendResult(true)
  turnEnded(true)
  judged('not-done', `discussion(s) encore à fermer : ${UUID}`)
  const again = stepAt(close, [], '', 0)
  expect(again).toEqual({ kind: 'send', text: resendText(close.text, `discussion(s) encore à fermer : ${UUID}`) })
  sendResult(true)
  turnEnded(true)
  judged('not-done', `discussion(s) encore à fermer : ${UUID}`)
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'stop', why: `tâche « fermetures » pas faite : discussion(s) encore à fermer : ${UUID}` })
})

test('envoi refusé : réessayé au repos sans compter comme un essai ; au troisième refus de suite, arrêt', () => {
  armed()
  for (let i = 0; i < 2; i++) {
    expect(stepAt(close, [], '', 0).kind).toBe('send')
    sendResult(false)
    expect(stepperNow()?.tries).toBe(0)
  }
  expect(stepAt(close, [], '', 0).kind).toBe('send')
  sendResult(false)
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'stop', why: 'tâche « fermetures » : message refusé 3 fois' })
})

test('lecture ratée au jugement : pas de verdict, la tâche reste à juger, rien n’est compté', () => {
  armed()
  stepAt(close, [], '', 0)
  sendResult(true)
  turnEnded(false)
  judged(null, '')
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'judge' })
  expect(stepperNow()?.tries).toBe(0)
})

test('un tour fini pendant l’envoi est celui de la tâche ; un tour fini sans envoi ne juge rien', () => {
  armed()
  turnEnded(false)
  expect(stepAt(close, [], '', 0).kind).toBe('send')
  turnEnded(false)
  sendResult(true)
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'judge' })
})

test('un seul pas à pas : un second armement laisse celui qui tourne ; désarmé, plus rien ne part', () => {
  armed('delivery')
  stepAt(close, [], '', 0)
  expect(armStepper('archive', 'o2', 'seat')).toBe(false)
  expect(stepperNow()?.source).toBe('delivery')
  disarmStepper()
  expect(stepAt(close, [], '', 0)).toEqual({ kind: 'wait' })
})

test('l’attente des clôtures : bornée à 2 minutes une fois le reste fait, puis fini en nommant ce qui reste', () => {
  armed('delivery')
  expect(stepAt(null, ['« M »'], 'remis : « R »', 1_000)).toEqual({ kind: 'wait' })
  expect(stepAt(null, ['« M »'], 'remis : « R »', 1_000 + CLOSE_WAIT_MS - 1)).toEqual({ kind: 'wait' })
  // Une mission close entre-temps : donnée tout de suite, l'attente repart ensuite.
  expect(stepAt(glean('m1'), ['« M »'], '', 2_000).kind).toBe('send')
  sendResult(true)
  turnEnded(false)
  judged('done', '')
  expect(stepAt(null, ['« M »'], 'remis : « R »', 5_000)).toEqual({ kind: 'wait' })
  expect(stepAt(null, ['« M »'], 'remis : « R »', 5_000 + CLOSE_WAIT_MS)).toEqual({ kind: 'done', why: 'remis : « R » ; restent à relever : « M »' })
})

test('compaction : en cours de son début à sa fin, bornée si sa fin n’est jamais vue', () => {
  compactionStarted(1_000)
  expect(isCompacting(2_000)).toBe(true)
  expect(isCompacting(1_000 + COMPACTION_MAX_MS)).toBe(false)
  compactionStarted(null)
  expect(isCompacting(2_000)).toBe(false)
})

test('jugement : décisions, Jalons, et celui de la tête pour les autres ; sans relecture, pas de verdict', () => {
  expect(stepVerdict({ kind: 'decisions', keys: [] }, fresh({ decisions: 2 }))).toBe('not-done')
  expect(stepVerdict({ kind: 'decisions', keys: [] }, fresh())).toBe('done')
  expect(stepVerdict({ kind: 'decisions', keys: [] }, fresh({ decisions: null }))).toBeNull()
  expect(stepVerdict({ kind: 'jalons' }, fresh({ jalons: false }))).toBe('not-done')
  expect(stepVerdict({ kind: 'jalons' }, fresh({ jalons: null }))).toBeNull()
  expect(stepVerdict(close.task, fresh({ toClose: new Set([UUID]) }))).toBe('not-done')
  expect(stepVerdict(close.task, fresh({ toClose: new Set([UUID]) }), { sessions: new Set([UUID]) })).toBe('done')
  expect(stepMissing(close.task, fresh({ toClose: new Set([UUID]) }))).toBe(`discussion(s) encore à fermer : ${UUID}`)
  // Une discussion remise n'est pas redonnée au renvoi.
  expect(stepMissing(close.task, fresh({ toClose: new Set([UUID]) }), { sessions: new Set([UUID]) })).toBe('discussion(s) encore à fermer : ')
})

test('la preuve des « Jalons » : une entrée vue pour la première fois, ou changée, depuis le début de la livraison', () => {
  const read = parseRoadmap('# Feuille de route\n\n## Jalons\n- [J1] en cours · 2026-11-20 · Mathis · Le COO range — fin : chaque livraison passe par lui\n## Prochaines étapes\n## Idées\n## À reprendre\n')
  const entries: RoadmapEntry[] = read.ok ? read.entries : []
  expect(entries.length).toBe(1)
  const line = entries[0]!.line
  expect(jalonsProven(entries, {}, 100)).toBe(true)
  expect(jalonsProven(entries, { J1: { line, section: 'Jalons', seenAt: 50 } }, 100)).toBe(false)
  expect(jalonsProven(entries, { J1: { line, section: 'Jalons', seenAt: 150 } }, 100)).toBe(true)
  expect(jalonsProven(entries, { J1: { line: `${line} (avant)`, section: 'Jalons', seenAt: 50 } }, 100)).toBe(true)
})

test('les libellés de la carte (série 7, E1)', () => {
  expect(stepLabel({ kind: 'boxes', decls: [] }, '', 0, 0)).toBe('boîtes')
  expect(stepLabel({ kind: 'jalons' }, '', 0, 0)).toBe('jalon')
  expect(stepLabel({ kind: 'glean', mission: 'm' }, 'M', 2, 7)).toBe('relevé de « M » (2 sur 7)')
})

test('un message entré dont aucun tour ne vient : jugé passé le délai au repos, comme un tour interrompu', () => {
  disarmStepper()
  armStepper('archive', 'archive', 'A@1')
  expect(stepAt(close, [], '', 1_000).kind).toBe('send')
  sendResult(true)
  expect(stepAt(close, [], '', 1_000 + SENT_IDLE_MS - 1)).toEqual({ kind: 'wait' })
  expect(stepAt(close, [], '', 1_000 + SENT_IDLE_MS)).toEqual({ kind: 'judge' })
  disarmStepper()
})

test('un projet qui peut livrer : les boîtes attendent la livraison, une ligne le dit, sans tâche en tête ni consigne ; sans dépôt distant, elles restent dues sans attendre', () => {
  const box = { id: 'b-1', source: 'mission « N »', text: 'Une chose à reprendre' }
  const waiting = statementText(withDueHead(cooStatement(emptyBoard('/p', 'p'), { now: 1 }), { boxes: [box, { ...box, id: 'b-2' }], isBoxesNow: false, toClose: [], toGlean: [] }, '/p'))
  expect(waiting).toMatch(/2 declaration\(s\) wait for the delivery\./)
  expect(waiting).not.toMatch(/TIDY-UP TASK DUE NOW/)
  const now = statementText(withDueHead(cooStatement(emptyBoard('/p', 'p'), { now: 1 }), { boxes: [box], isBoxesNow: true, toClose: [], toGlean: [] }, '/p'))
  expect(now).toMatch(/Tidy-up task « boîtes »/)
  expect(now).not.toMatch(/wait for the delivery/)
})

test('jugements sans relecture : bornés, puis l’arrêt dit que la preuve ne se relit pas ; un clic ne prend jamais la place du rangement d’une livraison', () => {
  disarmStepper()
  armStepper('delivery', 'd1', 'A@1')
  stepAt(close, [], '', 0)
  sendResult(true)
  turnEnded(false)
  judged(null, '', 1_000)
  judged(null, '', 1_000 + SENT_IDLE_MS - 1)
  expect(stepperNow()!.phase).toBe('ended')
  judged(null, '', 1_000 + SENT_IDLE_MS)
  expect(stepperNow()!.phase).toBe('stopped')
  expect(stepperNow()!.why).toBe('tâche « fermetures » : ce qui la prouve ne se relit pas')
  // Arrêté, son issue pas encore rendue : un clic d'archivage ne le remplace pas ; le rangement d'une livraison remplace un clic.
  expect(armStepper('archive', 'archive', 'A@1')).toBe(false)
  disarmStepper()
  armStepper('archive', 'archive', 'A@1')
  stepAt(close, [], '', 0)
  expect(armStepper('delivery', 'd1', 'A@1')).toBe(true)
  // Le message du clic en route est repris : rien d'autre ne part avant que son tour soit jugé.
  expect(stepperNow()).toEqual(expect.objectContaining({ source: 'delivery', owner: 'd1', phase: 'sending', label: 'fermetures' }))
  expect(stepAt(close, [], '', 1)).toEqual({ kind: 'wait' })
  sendResult(true)
  turnEnded(false)
  expect(stepperNow()!.phase).toBe('ended')
  disarmStepper()
})

test('une tâche pas faite laissée pour une autre garde ses essais : à son retour, renvoyée avec ce qui manque, puis arrêt ; un message soumis retient le pas à pas jusqu’à son tour, borné', () => {
  disarmStepper()
  armStepper('delivery', 'd1', 'A@1')
  stepAt(glean('M'), [], '', 0)
  sendResult(true)
  turnEnded(false)
  judged('not-done', 'la mission n’est déclarée ni relevée ni remise')
  // Une autre tâche passe devant (une décision arrivée entre-temps), faite.
  expect(stepAt(close, [], '', 1).kind).toBe('send')
  expect(stepperNow()!.tries).toBe(0)
  sendResult(true)
  turnEnded(false)
  judged('done', '')
  expect(stepperNow()!.label).toBe('')
  // La tâche laissée revient avec son essai compté et ce qui manquait.
  const back = stepAt(glean('M'), [], '', 2)
  expect(back).toEqual({ kind: 'send', text: expect.stringMatching(/la mission n’est déclarée ni relevée ni remise/) })
  expect(stepperNow()!.tries).toBe(1)
  sendResult(true)
  turnEnded(false)
  judged('not-done', 'la mission n’est déclarée ni relevée ni remise')
  expect(stepperNow()!.phase).toBe('stopped')
  disarmStepper()
  promptEntered(10)
  expect(isPromptPending(10 + PROMPT_PENDING_MS - 1)).toBe(true)
  expect(isPromptPending(10 + PROMPT_PENDING_MS)).toBe(false)
  promptEntered(null)
  expect(isPromptPending(11)).toBe(false)
  armStepper('archive', 'archive', 'A@1')
  stopStepper('tâche « fermetures » : son texte ne se compose pas')
  expect(stepAt(close, [], '', 12)).toEqual({ kind: 'stop', why: 'tâche « fermetures » : son texte ne se compose pas' })
  disarmStepper()
})

test('pendant un clic (une livraison ouverte, une tâche envoyée), le relevé ne dit pas que les déclarations attendent la livraison', () => {
  const box = { id: 'b-1', source: 'mission « N »', text: 'Une chose à reprendre' }
  const during = statementText(headedStatement(cooStatement(emptyBoard('/p', 'p'), { now: 1 }), { boxes: [box], isBoxesNow: false, toClose: [], toGlean: [] }, '/p', true).statement)
  expect(during).not.toMatch(/wait for the delivery/)
})
