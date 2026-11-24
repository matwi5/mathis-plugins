// L'outil flow et les choix « Réglage : <case> : <choix> » : gardés seulement en auto et quand chaque case nommée est
// cochée, relue à chaque choix reçu. Invariant : « Une mission ne tranche jamais seule une sorte de question dont tu n'as
// pas coché la case par un clic ; une case absente, illisible ou mal lue vaut décochée, et la question t'est posée. »

import { expect, test } from 'claude-code/testing'

import { SETTING_CHOICE_MARK, SENSITIVE_CHOICE_MARK, applyReport, emptyBoard, hasSettingChoice, isAutoOn, newRun, openQuestions, switchOnAuto } from '../hooks/model.ts'
import type { AutonomyCases } from '../hooks/autonomy-setting.ts'
import type { Board, Run } from '../types'

const T0 = 98_000_000
const OFF: AutonomyCases = { experience: false, invariant: false, contradiction: false, spend: false, reread: false }

/** Une mission en Implémentation dans la discussion « sa », à deux groupes. */
const lot = (): Board => {
  const run: Run = { ...newRun('implement', T0, 'Boutique'), owner: 'sa' }
  const board: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, { tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }], groups: [{ id: 'A', name: 'Code', tickets: ['t1'] }, { id: 'B', name: 'Données', tickets: ['t2'] }] }, T0 + 1).board
}
const auto = (): Board => switchOnAuto(lot(), 'sa', T0 + 2)!.board
const kept = (board: Board): string[] => (board.runs[0]!.decided ?? []).map(d => d.what)
const journal = (board: Board): string[] => (board.runs[0]!.log ?? []).map(l => l.text)
const choose = (board: Board, what: string, autonomy: AutonomyCases | null | undefined) => applyReport(board, { decided: [{ what, origin: 'recommendation' }] }, T0 + 10, { autonomy })

test('la marque « Réglage : » est une constante exportée à côté de celle de la zone sensible', () => {
  expect(SETTING_CHOICE_MARK).toBe('Réglage :')
  expect(SENSITIVE_CHOICE_MARK).toBe('Zone sensible :')
})

test('case cochée : le choix « Réglage : <case> : … » d’une mission en auto est gardé', () => {
  const out = choose(auto(), 'Réglage : Dépense ou action externe : installer jq', { ...OFF, spend: true })
  expect(kept(out.board)).toEqual(['Réglage : Dépense ou action externe : installer jq'])
  expect(out.text).not.toContain('refused')
})

test('plusieurs cases cochées : jointes par « + », gardé', () => {
  const what = 'Réglage : Choix d\'expérience + Décision déjà prise contredite : libellé changé'
  expect(kept(choose(auto(), what, { ...OFF, experience: true, contradiction: true }).board)).toEqual([what])
})

test('une case sur deux : refusé, la case décochée nommée', () => {
  const out = choose(auto(), 'Réglage : Choix d\'expérience + Décision déjà prise contredite : libellé changé', { ...OFF, experience: true })
  expect(kept(out.board)).toEqual([])
  expect(out.text).toContain('the box « Décision déjà prise contredite » is not ticked')
  expect(out.text).not.toContain('« Choix d\'expérience » is not ticked')
})

test('case décochée : refusé, ni gardé ni journalisé « Décidé sans toi », la case nommée et la question à poser dans waiting', () => {
  const out = choose(auto(), 'Réglage : Invariant d\'un ticket : rien ne s’efface', OFF)
  expect(kept(out.board)).toEqual([])
  expect(journal(out.board).some(t => t.startsWith('Décidé sans toi'))).toBe(false)
  expect(out.text).toContain('refused, not kept: the box « Invariant d\'un ticket » is not ticked')
  expect(out.text).toContain('ask the question instead and declare it in "waiting"')
})

test('cases illisibles : un fichier qui ne se lit pas (null, ou aucun relevé passé), refusé', () => {
  for (const autonomy of [null, undefined]) {
    const out = choose(auto(), 'Réglage : Dépense ou action externe : installer jq', autonomy)
    expect(kept(out.board)).toEqual([])
    expect(out.text).toContain('the autonomy boxes cannot be read, so they count as unticked')
  }
})

test('case inconnue : libellé inconnu, tête sans second « : » ou quasi-marque, refusé avec les cinq libellés et la forme exacte', () => {
  for (const what of ['Réglage : Budget : 30 €', 'Réglage : Dépense ou action externe', 'réglage : Dépense ou action externe : x', 'Reglage: Dépense ou action externe : x', `Re${String.fromCodePoint(0x301)}glage : Dépense ou action externe : x`, 'Réglage : Choix d’expérience : apostrophe typographique']) {
    const out = choose(auto(), what, { experience: true, invariant: true, contradiction: true, spend: true, reread: true })
    expect([what, kept(out.board)]).toEqual([what, []])
    expect(out.text).toContain('its head must be exactly « Réglage : <box> : <choice> »')
    expect(out.text).toContain('« Choix d\'expérience », « Invariant d\'un ticket », « Décision déjà prise contredite », « Dépense ou action externe », « Relecture après la fusion »')
  }
})

test('hors auto : mission en manuel, ou auto en pause, refusé', () => {
  const manual = choose(lot(), 'Réglage : Dépense ou action externe : installer jq', { ...OFF, spend: true })
  expect(kept(manual.board)).toEqual([])
  expect(manual.text).toContain('the mission is not in auto mode (or its auto is paused)')
  expect(manual.text).not.toContain('unread here')
  // L'auto mis en pause au passage des 200 choix.
  const many = applyReport(auto(), { decided: Array.from({ length: 200 }, (_, i) => ({ what: `Choix ${i}` })) }, T0 + 3).board
  expect(isAutoOn(many.runs[0]!)).toBe(false)
  const paused = choose(many, 'Réglage : Dépense ou action externe : installer jq', { ...OFF, spend: true })
  expect(kept(paused.board).includes('Réglage : Dépense ou action externe : installer jq')).toBe(false)
})

test('quasi-marques plus larges : pluriel, accent grave, parenthèse, tiret, espace invisible en tête, ou derrière « Zone sensible : », toutes refusées', () => {
  const all = { experience: true, invariant: true, contradiction: true, spend: true, reread: true }
  const zw = String.fromCodePoint(0x200b)
  for (const what of ['Réglages : Invariant d\'un ticket : x', 'Règlage : Invariant d\'un ticket : x', 'Réglage (Invariant d\'un ticket) : x', 'Réglage – Invariant d\'un ticket : x', `${zw}réglage : Invariant d'un ticket : x`, 'Zone sensible : réglage : Invariant d\'un ticket : x']) {
    expect([what, hasSettingChoice({ decided: [{ what }] })]).toEqual([what, true])
    const out = choose(auto(), what, all)
    expect([what, kept(out.board)]).toEqual([what, []])
    expect(out.text).toContain('refused, not kept')
  }
  // Un texte ordinaire qui parle d'un réglage sans nommer de case n'est pas un choix de réglage : gardé comme avant, en
  // manuel comme en auto.
  for (const what of ['Réglages de la page : bouton gris', 'Réglages : valeurs par défaut gardées', 'Réglage (provisoire) : seuil à 3', 'Zone sensible : Réglage (délai du verrou) porté à 5 s']) {
    expect([what, hasSettingChoice({ decided: [{ what }] })]).toEqual([what, false])
    expect([what, kept(choose(lot(), what, OFF).board)]).toEqual([what, [what]])
  }
})

test('« Zone sensible : Réglage : » suivi d’un libellé inconnu est refusé, comme sans la marque sensible', () => {
  const all = { experience: true, invariant: true, contradiction: true, spend: true, reread: true }
  for (const what of ['Zone sensible : Réglage : Invariant du ticket : on garde l’ancien', 'Zone sensible : réglage : Decision deja prise contredite : x']) {
    expect([what, hasSettingChoice({ decided: [{ what }] })]).toEqual([what, true])
    const out = choose(auto(), what, all)
    expect([what, kept(out.board)]).toEqual([what, []])
    expect(out.text).toContain('refused, not kept')
  }
})
test('un choix sensible couvert par une case cochée garde sa marque : « Zone sensible : Réglage : <case> : … » est gardé', () => {
  const what = 'Zone sensible : Réglage : Invariant d\'un ticket : rien ne s’efface sans copie'
  expect(kept(choose(auto(), what, { ...OFF, invariant: true }).board)).toEqual([what])
  expect(choose(auto(), what, OFF).text).toContain('the box « Invariant d\'un ticket » is not ticked')
})

test('un choix de réglage déjà gardé puis retiré ne revient pas par le remplaçant d’un retrait quand sa case est décochée', () => {
  const y = 'Réglage : Dépense ou action externe : installer jq'
  const first = applyReport(auto(), { decided: [{ what: y }, { what: 'Option A' }] }, T0 + 10, { autonomy: { ...OFF, spend: true } }).board
  const out = applyReport(first, { withdrawn: [{ what: y }, { what: 'Option A', replacedBy: y }] }, T0 + 20, { autonomy: OFF })
  const run = out.board.runs[0]!
  expect(run.decided!.filter(d => d.what === y && d.withdrawnAt === undefined)).toEqual([])
  expect(journal(out.board).filter(t => t === `Décidé sans toi : ${y}`)).toHaveLength(1)
  expect(out.text).toContain('"withdrawn": "Option A" not applied')
})

test('les appels que dicte un refus, rejoués : la forme exacte renvoyée est gardée ; la question déclarée dans "waiting" est ouverte', () => {
  const box = { ...OFF, invariant: true }
  const refused = choose(auto(), 'réglage : Invariant d\'un ticket : rien ne s’efface', box)
  expect(kept(refused.board)).toEqual([])
  expect(refused.text).toContain('send it again in that form')
  const again = applyReport(refused.board, { decided: [{ what: 'Réglage : Invariant d\'un ticket : rien ne s’efface' }] }, T0 + 11, { autonomy: box })
  expect(kept(again.board)).toEqual(['Réglage : Invariant d\'un ticket : rien ne s’efface'])
  // Case décochée : la réponse dit de poser la question dans "waiting" ; l'appel rejoué l'ouvre, rien n'est gardé.
  const off = choose(auto(), 'Réglage : Dépense ou action externe : installer jq', OFF)
  expect(off.text).toContain('declare it in "waiting"')
  const asked = applyReport(off.board, { waiting: [{ id: 'jq', phase: 'implement', text: 'Installer jq ?' }] }, T0 + 12)
  expect(openQuestions(asked.board.runs[0]!).map(q => q.id)).toEqual(['jq'])
  expect(kept(asked.board)).toEqual([])
})

test('un choix de réglage déjà gardé, renvoyé après la décoche, n’est pas dit refusé : il reste tel quel', () => {
  const what = 'Réglage : Dépense ou action externe : installer jq'
  const first = choose(auto(), what, { ...OFF, spend: true }).board
  const again = choose(first, what, OFF)
  expect(again.text).not.toContain('refused')
  expect(kept(again.board)).toEqual([what])
})

test('un texte qui ne commence pas par « Réglage : » est traité comme aujourd’hui, cases illisibles ou non', () => {
  const out = choose(auto(), 'Option A retenue', null)
  expect(kept(out.board)).toEqual(['Option A retenue'])
  expect(out.text).not.toContain('refused')
})

test('un retrait dont le remplaçant est un choix de réglage refusé est refusé en entier : l’ancien choix reste en vigueur', () => {
  const first = choose(auto(), 'Option A retenue', OFF).board
  const out = applyReport(first, { withdrawn: [{ what: 'Option A retenue', why: 'mieux', replacedBy: 'Réglage : Choix d\'expérience : bouton renommé' }] }, T0 + 20, { autonomy: OFF })
  const run = out.board.runs[0]!
  expect(run.decided!.map(d => [d.what, d.withdrawnAt === undefined])).toEqual([['Option A retenue', true]])
  expect(out.text).toContain('the box « Choix d\'expérience » is not ticked')
  expect(out.text).toContain('"withdrawn": "Option A retenue" not applied')
  // Case cochée : le remplacement passe.
  const ok = applyReport(first, { withdrawn: [{ what: 'Option A retenue', replacedBy: 'Réglage : Choix d\'expérience : bouton renommé' }] }, T0 + 20, { autonomy: { ...OFF, experience: true } })
  expect(kept(ok.board)).toEqual(['Option A retenue', 'Réglage : Choix d\'expérience : bouton renommé'])
})

test('le rappel « choix d’expérience » n’est pas ajouté à un choix gardé sous « Choix d’expérience », et reste pour tout autre choix qui en a l’air', () => {
  const under = choose(auto(), 'Réglage : Choix d\'expérience : libellé du bouton « Lancer »', { ...OFF, experience: true })
  expect(under.text).not.toContain('reads like an experience choice')
  const other = choose(auto(), 'Libellé du bouton « Lancer »', { ...OFF, experience: true })
  expect(other.text).toContain('reads like an experience choice')
  const spend = choose(auto(), 'Réglage : Dépense ou action externe : libellé du bouton « Lancer »', { ...OFF, spend: true })
  expect(spend.text).toContain('reads like an experience choice')
})

test('Une mission ne tranche jamais seule une sorte de question dont tu n’as pas coché la case par un clic ; une case absente, illisible ou mal lue vaut décochée, et la question t’est posée', () => {
  const what = 'Réglage : Relecture après la fusion : fusionné sans relecture'
  // Fichier absent : jamais réglé, cinq cases décochées (`autonomyCasesNow`) ; fichier illisible : aucun relevé (null).
  expect(kept(choose(auto(), what, OFF).board)).toEqual([])
  expect(kept(choose(auto(), what, null).board)).toEqual([])
  // Case décochée après un premier choix gardé : le second est refusé (les cases relues à chaque appel).
  const first = choose(auto(), what, { ...OFF, reread: true }).board
  expect(kept(first)).toEqual([what])
  const second = applyReport(first, { decided: [{ what: 'Réglage : Relecture après la fusion : second groupe fusionné' }] }, T0 + 30, { autonomy: OFF })
  expect(kept(second.board)).toEqual([what])
  expect(second.text).toContain('is not ticked')
})
