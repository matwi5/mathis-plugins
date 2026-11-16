// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { nightMorningLines } from '../hooks/coo.ts'
import { NIGHT_ENTRY_ACTS } from '../hooks/coordination.ts'
import { AUTO_STOPS, autoResumedAt, detachOnLoad, emptyBoard, isAutoOn, isEndedPause, newRun, parkActive, switchOnAuto } from '../hooks/model.ts'
import { parseNightLog, reopenCommand, type NightLogLine } from '../hooks/night.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// La réouverture d'une mission la nuit (la commande que compose le mod) et le résumé du matin (ce que le relevé
// du COO dit de la nuit au premier message de la personne).

/** Les mots d'une commande telle que le shell POSIX la lit : apostrophes, et « \' » hors d'elles ; tout autre signe spécial la refuse. */
const posixWords = (cmd: string): string[] | null => {
  const words: string[] = []
  let word: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (c === ' ') {
      if (word !== null) words.push(word)
      word = null
    } else if (c === "'") {
      const end = cmd.indexOf("'", i + 1)
      if (end < 0) return null
      word = (word ?? '') + cmd.slice(i + 1, end)
      i = end
    } else if (c === '\\' && cmd[i + 1] === "'") {
      word = (word ?? '') + "'"
      i += 1
    } else if (/[A-Za-z0-9-]/.test(c)) word = (word ?? '') + c
    else return null
  }
  if (word !== null) words.push(word)
  return words
}

test('la commande de réouverture : claude --bg --resume relance la discussion de la mission, son premier message ne porte que l’id', () => {
  const cmd = reopenCommand('mx7abc-12', 'session-M')!
  const words = posixWords(cmd)
  expect(words?.slice(0, 4)).toEqual(['claude', '--bg', '--resume', 'session-M'])
  expect(words).toHaveLength(5)
  expect(words![4]).toBe(
    'Reprends la mission mx7abc-12 du tableau de bord : commence par appeler flow avec {"resume": "mx7abc-12"}, puis continue cette mission là où elle en est. Si son auto a repris de lui-même, suis sa consigne ; sinon elle reste en manuel : ne pas allumer, la personne le fera depuis la vue Coordination.',
  )
})

test('la commande de réouverture : aucune apostrophe dans son message ; un id de mission ou de discussion hors forme n’en a pas', () => {
  // Ni droite (elle fermerait la citation) ni typographique.
  expect(reopenCommand('m1', 'session-M')!.replace(/^claude --bg --resume 'session-M' '/, '').slice(0, -1)).not.toMatch(/['’]/)
  for (const bad of ['', 'a b', "m1'", 'm1;rm', '../m1', '-m1', 'x'.repeat(101), 3, null]) {
    expect(reopenCommand(bad as any, 'session-M')).toBeNull()
    expect(reopenCommand('m1', bad as any)).toBeNull()
  }
  // Sans discussion connue (une mission d'avant, ni tenue ni née nulle part) : pas de commande.
  expect(reopenCommand('m1', undefined)).toBeNull()
})

const line = (over: Partial<NightLogLine>): NightLogLine => ({ at: 3_600_000, watch: 'nwatchabcd1', act: 'wave', why: 'geste écrit', result: 'written', ...over })
const missions: { id: string; title: string; mode: 'auto' | 'manual'; resumedAt?: number }[] = [{ id: 'm1', title: 'Riche', mode: 'manual' }]

test('le résumé du matin : chaque geste de la surveillance (mission, groupe, geste, raison, résultat), puis ce qui attend la personne', () => {
  const text = nightMorningLines(
    { watch: 'nwatchabcd1', at: 7_200_000, why: 'person', lines: [line({ act: 'start', why: 'clic', result: 'allumée' }), line({ mission: 'm1', group: 'B' }), line({ mission: 'm1', act: 'reopen', why: 'commande de réouverture lancée par le COO : mission rouverte', result: 'written' }), line({ mission: 'm2', act: 'reopen', why: 'refusé par l’app : pour le matin', result: 'refused' }), line({ act: 'stop', why: 'message', result: 'arrêtée' })] },
    missions,
  ).join('\n')
  expect(text).toMatch(/^Night summary/)
  expect(text).toMatch(/mission « Riche » \(mission id « m1 »\), group « B »: wave, geste écrit: written/)
  expect(text).toMatch(/mission « m2 » \(mission id « m2 »\): reopen, refusé par l’app : pour le matin: refused/)
  expect(text).not.toMatch(/allumée|arrêtée/)
  // Une mission rouverte la nuit, restée en manuel : son auto s'allume depuis la vue Coordination ; une absente du relevé est dite absente.
  expect(text).toMatch(/reopened at night.*« Riche » \(stayed in manual\).*Coordination view/)
  expect(nightMorningLines({ watch: 'nwatchabcd1', at: 7_200_000, why: 'person', lines: [line({ mission: 'm9', act: 'reopen', why: 'commande de réouverture lancée par le COO : mission rouverte', result: 'written' })] }, missions).join('\n')).toMatch(/« m9 » \(not in the missions list\)/)
  expect(text).toMatch(/still waits for the user/)
})

test('le résumé du matin : chaque mission rouverte dit, d’après le fichier des missions au matin, si son auto a repris de lui-même ou si elle est restée en manuel', () => {
  // Rouvertes à 01:00 (3 600 000) ; la mission m4 rouverte deux fois, comptée une fois, à sa première réouverture.
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm4']
  const night = { watch: 'nwatchabcd1', at: 7_200_000, why: 'person' as const, lines: ids.map(id => line({ mission: id, act: 'reopen', why: 'commande de réouverture lancée par le COO : mission rouverte', result: 'written' })) }
  const text = nightMorningLines(night, [
    { id: 'm1', title: 'Reprise', mode: 'auto', resumedAt: 3_660_000 },
    { id: 'm2', title: 'Manuelle', mode: 'manual' },
    { id: 'm3', title: 'Allumée au matin', mode: 'auto' },
    // Reprise à la relance, puis en pause (une question qui bloque tout) ou finie : elle a bien repris.
    { id: 'm4', title: 'Reprise puis en pause', mode: 'manual', resumedAt: 3_700_000 },
    // Une reprise d'avant la réouverture (la veille) ne compte pas pour cette nuit.
    { id: 'm5', title: 'Reprise d’avant', mode: 'manual', resumedAt: 1_000 },
    // Une question ouverte retire le libellé « repris » du relevé, pas la date de la reprise.
    { id: 'm6', title: 'Reprise avec question', mode: 'auto', resumedAt: 3_600_000 },
  ]).join('\n')
  expect(text).toMatch(
    /Missions reopened at night \(their command launched\): « Reprise » \(its auto resumed by itself\), « Manuelle » \(stayed in manual\), « Allumée au matin » \(its auto on\), « Reprise puis en pause » \(its auto resumed by itself, off again since: see the missions list\), « Reprise d’avant » \(stayed in manual\), « Reprise avec question » \(its auto resumed by itself\);/,
  )
  expect(text).toMatch(/the auto of each mission that stayed in manual; never switch it on yourself\./)
  expect(text).not.toMatch(/its auto stays off|their auto off|in manual, their/)
  // Avec la ligne « start » de la surveillance (00:30), une reprise écrite avant la ligne de réouverture (00:50) mais après ce début compte.
  const started = { ...night, lines: [line({ at: 1_800_000, act: 'start', why: 'clic', result: 'allumée' }), ...night.lines] }
  expect(nightMorningLines(started, [{ id: 'm1', title: 'Reprise', mode: 'auto', resumedAt: 3_000_000 }]).join('\n')).toMatch(/« Reprise » \(its auto resumed by itself\)/)
  expect(nightMorningLines(started, [{ id: 'm1', title: 'Reprise', mode: 'auto', resumedAt: 1_000_000 }]).join('\n')).toMatch(/« Reprise » \(its auto on\)/)
})

test('le résumé du matin : une nuit sans geste le dit ; un journal illisible le dit', () => {
  const none = nightMorningLines({ watch: 'nwatchabcd1', at: 7_200_000, why: 'ended', lines: [] }, missions).join('\n')
  expect(none).toMatch(/no night gesture/)
  expect(none).not.toMatch(/reopened at night/)
  const unread = nightMorningLines({ watch: 'nwatchabcd1', at: 7_200_000, why: 'button', unread: true }, missions).join('\n')
  expect(unread).toMatch(/night journal could not be read/)
})

// ─── Chez le COO ──────────────────────────────────────────────────────────

const T0 = 800_000_000

const press = async ($: any, key: string, surface = 'desktop') => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
  const button = await pane.find({ key })
  if (button) await pane.press({ key })
  await pane.unmount()
  return button
}

/** Une mission en auto arrêtée par son tableau de bord, des groupes ouverts, ouverte nulle part. */
const stopped = (title: string, offWhy: string = AUTO_STOPS.ended): Run =>
  ({
    ...newRun('implement', T0 - 60_000, title),
    id: 'run-1',
    status: 'paused',
    owner: undefined,
    bornIn: 'session-M',
    auto: { onAt: T0 - 30_000, offAt: T0 - 1000, offWhy },
    tickets: [
      { id: '1', name: 'Un', status: 'done' },
      { id: '2', name: 'Deux', status: 'todo' },
    ],
    groups: [
      { id: 'A', name: 'A', tickets: ['1'] },
      { id: 'B', name: 'B', tickets: ['2'] },
    ],
    waiting: [],
  }) as unknown as Run

const coo = async ($: any, on: any, runs: Run[], surface = 'desktop') => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  await openCoo($, clock)
  expect(await press($, 'coo-night-ask', surface)).toBeDefined()
  expect(await press($, 'coo-night-confirm', surface)).toBeDefined()
  await settle(clock, 1)
  return { clock, w }
}
const watchOf = (w: World): { id: string; at: number } => {
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit.json'))
  const raw = path ? JSON.parse(w.files[path]!) : w.mem[Object.keys(w.mem).find(k => k.startsWith('coo-night:'))!]
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
const watchId = (w: World): string => watchOf(w).id
const journal = (w: World): any[] => {
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit-journal.jsonl'))
  const key = Object.keys(w.mem).find(k => k.startsWith('coo-night-log:'))
  const read = parseNightLog((path ? w.files[path] : key ? String(w.mem[key]) : '') ?? '')
  return read.state === 'read' ? read.lines.map(l => JSON.parse(l)) : []
}
/** Le relevé que reçoit le Claude du COO avec ce message : d'une autre session (`peer`), ou tapé par la personne (`composer`). */
const statement = async ($: any, kind = 'peer'): Promise<string> => {
  const out = (await $.prompt.submit({ text: 'Message', origin: { kind } } as any)) as any
  await $.turn.start({ turnId: kind, text: 'Message' } as any)
  await $.turn.complete({ answer: 'Vu.', durationMs: 10, isAborted: false, turnId: kind, reason: 'answer' } as any)
  return ((out?.context ?? []) as string[]).join('\n')
}
const ask = async ($: any, list: unknown[]) => String(((await $.tool.call({ tool: TOOL, coordinate: { night: list } } as any)) as any).result)

test('dans le CLI : le relevé donne la commande de réouverture composée par le mod ; enregistrée une fois, au journal, sans entrée pour la mission', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await coo($, on, [stopped("L'appli $(rm -rf ~)")], 'terminal')
  const id = watchId(w)
  const text = await statement($)
  const line = text.split('\n').find(l => /night gesture: reopen/.test(l))!
  expect(line).toMatch(/run it by the shell, in the foreground, from this folder, never edited except for one addition, --permission-mode/)
  const cmd = /when you know it \(else its messages would wait for an approval\): (claude --bg .*) ; once it answers/.exec(line)?.[1]
  expect(cmd).toBe(reopenCommand('run-1', 'session-M'))
  expect(line).toContain(`{"coordinate": {"night": [{"mission": "run-1", "watch": "${id}", "act": "reopen"}]}}`)
  expect(line).toMatch(/It reopens the mission: its auto resumes by itself when its resume still holds \(its discussion, the one that switched it on and still keeps its proof, the click date or the trace of a resume, relaunched under its id within 24 h of the mission's last activity\), otherwise the user switches it on from the Coordination view; never switch it on yourself/)
  expect(line).not.toMatch(/in manual|stays off/)
  // Lancée, puis enregistrée par l'appel que dicte la ligne, rejoué tel quel : une fois.
  const dictated = JSON.parse(/« backgrounded », send (\{"coordinate".*\}\]\}\}); if it fails/.exec(line)![1]!)
  expect(String(((await $.tool.call({ tool: TOOL, ...dictated } as any)) as any).result)).toMatch(/recorded for mission « L'appli \$\(rm -rf ~\) »: reopened; its auto resumes by itself when its resume still holds, otherwise the user switches it on from the Coordination view; never switch it on yourself/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/already reopened during this night watch/)
  expect(journal(w).filter(l => l.act === 'reopen').map(l => l.result)).toEqual(['written', 'refused'])
  expect(entries(w).filter(e => e.kind === 'night')).toEqual([])
  // Le relevé suivant ne la redonne plus.
  const again = await statement($)
  expect(again).toMatch(/already reopened during this night watch: nothing more to do/)
  expect(again).not.toMatch(/claude --bg/)
  // Sans surveillance, rien ne s'enregistre.
  expect(await press($, 'coo-night-stop', 'terminal')).toBeDefined()
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/refused/)
})

test('dans l’app : pas de commande, la réouverture reste pour le matin, notée une fois au journal ; l’appel est refusé', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on, [stopped('Fermée')])
  await settle(clock, 20)
  const id = watchId(w)
  const text = await statement($)
  expect(text).toMatch(/night gesture: reopen, for the morning/)
  expect(text).not.toMatch(/claude --bg/)
  expect(journal(w).filter(l => l.act === 'reopen').map(l => `${l.mission}:${l.result}:${l.why}`)).toEqual(['run-1:refused:refusé par l’app : pour le matin'])
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/in the app, a reopen does not leave at night/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/in the app, a reopen does not leave at night/)
  // Un seul refus « pour le matin » au journal, quel que soit le nombre d'appels.
  expect(journal(w).filter(l => l.act === 'reopen')).toHaveLength(1)
})

test('dans le CLI, un journal illisible ne donne pas de commande de réouverture', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await coo($, on, [stopped('Fermée')], 'terminal')
  for (const p of Object.keys(w.files).filter(p => p.endsWith('.nuit-journal.jsonl'))) w.files[p] = '{coupé'
  for (const k of Object.keys(w.mem).filter(k => k.startsWith('coo-night-log:'))) w.mem[k] = '{coupé'
  const text = await statement($)
  expect(text).toMatch(/night gesture: reopen, no command \(the night journal cannot be read/)
  expect(text).not.toMatch(/claude --bg/)
})

test('dans le CLI, la discussion d’une mission à rouvrir qui en tient une autre n’est pas relancée : pour le matin', { timeoutMs: 30000 }, async ($, on) => {
  const other = { ...stopped('Autre'), id: 'run-2', status: 'active', owner: 'session-M', auto: undefined } as unknown as Run
  await coo($, on, [stopped('Fermée'), other], 'terminal')
  const text = await statement($)
  expect(text).toMatch(/night gesture: reopen, no command \(its discussion carries another mission now/)
  expect(text).not.toMatch(/claude --bg/)
})

test('une mission coupée par le COO ne se rouvre pas : pas de commande, l’appel refusé', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await coo($, on, [stopped('Coupée', AUTO_STOPS.coo)], 'terminal')
  const id = watchId(w)
  expect(await statement($)).not.toMatch(/claude --bg/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/not a mission in auto paused by its dashboard/)
  expect(journal(w).filter(l => l.act === 'reopen').map(l => l.result)).toEqual(['refused'])
})

/**
 * Une mission en auto dont la discussion s'est fermée par la fin de sa session, telle que `parkActive` l'écrit :
 * titulaire gardé (`session-M`), statut « active », auto en pause « discussion fermée ».
 */
const parked = (title: string, id = 'run-1', session = 'session-M'): Run => {
  const run = { ...stopped(title), id, status: 'active', owner: session, auto: { onAt: T0 - 30_000, onBy: session }, claim: { boot: 'boot-1', at: T0 - 50_000 } } as unknown as Run
  const out = parkActive({ ...emptyBoard('/p', 'p'), activeId: id, runs: [run] }, T0 - 1000)
  return out!.board.runs.find(r => r.id === id)!
}

test('une mission en auto dont la discussion s’est fermée (titulaire gardé) est à rouvrir : le texte fait d’abord chercher son pid, puis la commande d’aujourd’hui ; notée une fois, et le matin le dit', { timeoutMs: 30000 }, async ($, on) => {
  const run = parked('Close par sa fin')
  // L'état réel : rien n'a retiré son titulaire ni son statut.
  expect([run.status, run.owner, run.auto?.offWhy]).toEqual(['active', 'session-M', AUTO_STOPS.ended])
  const { w } = await coo($, on, [run], 'terminal')
  const id = watchId(w)
  const line = (await statement($)).split('\n').find(l => /night gesture: reopen/.test(l))!
  expect(line).toMatch(/the mission open in no discussion or its discussion ended; night gesture: reopen, first check, right before launching, that its session no longer runs: run claude agents --json --all by the shell and look at every entry whose "sessionId" is exactly "session-M"; if one of them has a "pid" that is a number \(not null\)/)
  expect(line).toContain(`launch nothing and send {"coordinate": {"night": [{"mission": "run-1", "watch": "${id}", "act": "reopen", "running": true}]}}, the reopen waits for the morning`)
  expect(line).toMatch(/if the list cannot be read, launch nothing and send nothing\. Otherwise \(no such entry, or none with a numeric "pid"\), by this command/)
  // La commande d'aujourd'hui, inchangée.
  expect(/when you know it \(else its messages would wait for an approval\): (claude --bg .*) ; once it answers/.exec(line)?.[1]).toBe(reopenCommand('run-1', 'session-M'))
  const dictated = JSON.parse(/« backgrounded », send (\{"coordinate".*\}\]\}\}); if it fails/.exec(line)![1]!)
  expect(String(((await $.tool.call({ tool: TOOL, ...dictated } as any)) as any).result)).toMatch(/recorded for mission « Close par sa fin »: reopened;/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/already reopened during this night watch/)
  expect(journal(w).filter(l => l.act === 'reopen').map(l => l.result)).toEqual(['written', 'refused'])
  const morning = await statement($, 'composer')
  expect(morning).toMatch(/Missions reopened at night \(their command launched\): « Close par sa fin » \(stayed in manual\)/)
})

/**
 * La discussion « session-M » relancée par la commande de nuit (un nouveau processus) : sa mission arrêtée proprement
 * (`parked`, prise de l'ancien processus `boot-1`), la date du clic gardée par cet ancien processus, ou absente.
 */
const relaunched = async ($: any, on: any, hasProof: boolean) => {
  const clock = mock.clock(on, { now: T0 + 60_000 })
  const w = world(on)
  w.ids.now = 'session-M'
  const run = parked('Rouverte')
  writeBoard(w, b => ({ ...b, root: '', session: 'session-M', boot: 'boot-1', runs: [run] }))
  if (hasProof) w.mem[`auto-confirm:${run.id}`] = { by: 'session-M', onAt: run.auto!.onAt, boot: 'boot-1' }
  await start($)
  await settle(clock, 3)
  // Claude lit la consigne envoyée par le mod et finit son tour.
  await $.turn.start({ turnId: 'brief' } as any)
  await $.turn.complete({ answer: 'Lu.', durationMs: 10, isAborted: false, turnId: 'brief', reason: 'answer' } as any)
  await settle(clock, 6)
  return { w, run }
}
const storedRun = (w: World, id: string): Run => stored(w).runs.find(r => r.id === id)!

test('rouverte la nuit puis relancée par un nouveau processus, sa preuve gardée : son auto repart de lui-même (reprise à la relance)', { timeoutMs: 40000 }, async ($, on) => {
  const { w, run } = await relaunched($, on, true)
  expect(storedRun(w, run.id).auto).toMatchObject({ onBy: 'session-M', onWhy: 'resumed' })
  // Le premier appel que dicte le texte de la commande, rejoué tel quel : il n'éteint pas l'auto repris.
  expect(String(((await $.tool.call({ tool: TOOL, resume: run.id } as any)) as any).result)).not.toMatch(/refused|No mission/)
  expect(storedRun(w, run.id).auto).toMatchObject({ onBy: 'session-M', onWhy: 'resumed' })
  expect(isAutoOn(storedRun(w, run.id))).toBe(true)
})

test('rouverte la nuit puis relancée, sa preuve absente : elle reste en manuel', { timeoutMs: 40000 }, async ($, on) => {
  const { w, run } = await relaunched($, on, false)
  expect(isAutoOn(storedRun(w, run.id))).toBe(false)
  expect(storedRun(w, run.id).auto?.onWhy).toBeUndefined()
  // Le premier appel que dicte le texte de la commande, rejoué tel quel : la mission reste en manuel, tenue ici.
  await $.tool.call({ tool: TOOL, resume: run.id } as any)
  expect(isAutoOn(storedRun(w, run.id))).toBe(false)
  expect(storedRun(w, run.id).owner).toBe('session-M')
})

test('le résumé du matin d’une mission rouverte dont l’auto a repris à la relance (l’écriture de la reprise) dit qu’il a repris de lui-même', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on, [parked('Reprise')], 'terminal')
  const id = watchId(w)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/reopened;/)
  // La discussion relancée écrit sa reprise (celle de la relance, `switchOnAuto` pour « resumed ») dans le fichier des missions.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === 'run-1' ? switchOnAuto({ ...b, activeId: 'run-1' }, 'session-M', T0 + 30_000, null, 'resumed')!.board.runs.find(x => x.id === 'run-1')! : r)) }))
  await settle(clock, 6)
  const text = await statement($, 'composer')
  expect(text).toMatch(/Missions reopened at night \(their command launched\): « Reprise » \(its auto resumed by itself\)/)
})

test('la discussion relancée a repris son auto avant que le COO note la réouverture : notée quand même, et le matin dit qu’il a repris de lui-même', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on, [parked('Reprise d’abord')], 'terminal')
  const id = watchId(w)
  // La reprise écrite d'abord par la discussion relancée (un autre processus), après l'allumage de la surveillance,
  // puis l'appel que dicte la ligne du relevé.
  const at = watchOf(w).at + 1000
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === 'run-1' ? switchOnAuto({ ...b, activeId: 'run-1' }, 'session-M', at, null, 'resumed')!.board.runs.find(x => x.id === 'run-1')! : r)) }))
  await settle(clock, 6)
  expect(isAutoOn(storedRun(w, 'run-1'))).toBe(true)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/recorded for mission « Reprise d’abord »: reopened;/)
  expect(journal(w).filter(l => l.act === 'reopen').map(l => l.result)).toEqual(['written'])
  // Rien ne s'est allumé ni éteint par cet appel.
  expect(isAutoOn(storedRun(w, 'run-1'))).toBe(true)
  const text = await statement($, 'composer')
  expect(text).toMatch(/Missions reopened at night \(their command launched\): « Reprise d’abord » \(its auto resumed by itself\)/)
})

test('une mission reprise d’une pause « plus rien ne peut avancer sans toi » (pas un blocage « à rouvrir ») n’est pas notée rouverte', { timeoutMs: 30000 }, async ($, on) => {
  const stuck = { ...parked('Questions'), auto: { ...parked('Questions').auto!, offWhy: AUTO_STOPS.stuck } } as Run
  const { clock, w } = await coo($, on, [stuck], 'terminal')
  const id = watchId(w)
  const at = watchOf(w).at + 1000
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === 'run-1' ? switchOnAuto({ ...b, activeId: 'run-1' }, 'session-M', at, null, 'resumed')!.board.runs.find(x => x.id === 'run-1')! : r)) }))
  await settle(clock, 6)
  expect(isAutoOn(storedRun(w, 'run-1'))).toBe(true)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/not a mission in auto paused by its dashboard/)
})

test('une mission en auto allumé par un clic (pas une reprise) n’est pas notée rouverte', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on, [parked('Cliquée')], 'terminal')
  const id = watchId(w)
  const at = watchOf(w).at + 1000
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === 'run-1' ? switchOnAuto({ ...b, activeId: 'run-1' }, 'session-M', at, null)!.board.runs.find(x => x.id === 'run-1')! : r)) }))
  await settle(clock, 6)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/not a mission in auto paused by its dashboard/)
})

test('autoResumedAt : la date d’une reprise d’elle-même, gardée l’auto éteint depuis (une pause) ; un clic ensuite l’efface', () => {
  const b = { ...emptyBoard('', 'p'), activeId: 'run-1', runs: [parked('Reprise')] }
  expect(autoResumedAt(b.runs[0]!)).toBeUndefined()
  const resumed = switchOnAuto(b, 'session-M', T0 + 5000, null, 'resumed')!.board.runs[0]!
  const at = resumed.auto!.onAt!
  expect(autoResumedAt(resumed)).toBe(at)
  // Éteint par le vrai chemin de la fin de sa discussion (parkActive) : la date de la reprise reste.
  const off = parkActive({ ...b, runs: [resumed] }, at + 4000)!.board.runs[0]!
  expect(isAutoOn(off)).toBe(false)
  expect(autoResumedAt(off)).toBe(at)
  expect(autoResumedAt(switchOnAuto({ ...b, runs: [off] }, 'session-M', at + 8000, null)!.board.runs[0]!)).toBeUndefined()
})

test('aucun geste de nuit n’allume l’auto : la liste des gestes ne change pas, un geste d’allumage est refusé et rien ne s’écrit', { timeoutMs: 30000 }, async ($, on) => {
  expect([...NIGHT_ENTRY_ACTS]).toEqual(['wave', 'resend', 'relaunch', 'force'])
  const { w } = await coo($, on, [stopped('Fermée')], 'terminal')
  const id = watchId(w)
  for (const act of ['auto', 'switchOn', 'resume', 'on']) {
    expect(await ask($, [{ mission: 'run-1', watch: id, act }])).toMatch(/refused: at night only "wave", "resend", "relaunch", "force", "reopen" and "cutAuto"; never [^.]*switch auto on\. Nothing written\./)
  }
  expect(journal(w).filter(l => l.result === 'refused' && l.why === 'geste hors de la liste de nuit')).toHaveLength(4)
  expect(isAutoOn(storedRun(w, 'run-1'))).toBe(false)
})

test('sa session tourne encore (un pid) : rien n’est lancé, un seul refus au journal par surveillance, et le relevé ne la repropose plus', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await coo($, on, [parked('Relancée')], 'terminal')
  const id = watchId(w)
  // Témoin : avant le refus, le relevé donne la commande ; l'appel « running » qu'il dicte, rejoué tel quel.
  const line = (await statement($)).split('\n').find(l => /night gesture: reopen/.test(l))!
  expect(line).toMatch(/claude --bg --resume 'session-M'/)
  const dictated = JSON.parse(/launch nothing and send (\{"coordinate".*\}\]\}\}), the reopen waits/.exec(line)![1]!)
  expect(String(((await $.tool.call({ tool: TOOL, ...dictated } as any)) as any).result)).toMatch(/refused: its session still runs; it stays for the morning\. Nothing written\./)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen', running: true }])).toMatch(/its session still runs/)
  expect(journal(w).filter(l => l.act === 'reopen').map(l => `${l.result}:${l.why}`)).toEqual(['refused:sa session tourne encore : pour le matin'])
  const again = await statement($)
  expect(again).toMatch(/night gesture: reopen, no command \(its session still ran when checked during this night watch\): for the morning/)
  expect(again).not.toMatch(/claude --bg/)
  // Une réouverture envoyée ensuite (la commande d'un relevé d'avant) n'est pas notée : la session tournait.
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/refused: its session still ran when checked during this night watch/)
  expect(journal(w).filter(l => l.act === 'reopen')).toHaveLength(1)
  // Rien ne s'écrit au fichier de coordination.
  expect(entries(w).filter(e => e.kind === 'night')).toEqual([])
})

test('la mission dont la discussion est celle du COO n’est pas relancée sous elle : pour le matin', { timeoutMs: 30000 }, async ($, on) => {
  // Arrêtée, ouverte nulle part, née dans la discussion qui tient maintenant le siège du COO.
  const { w } = await coo($, on, [{ ...stopped('Chez le COO'), bornIn: 'session-A' } as Run, parked('Témoin', 'run-2', 'session-M')], 'terminal')
  expect(w.ids.now).toBe('session-A')
  const text = await statement($)
  expect(text).toMatch(/mission « Chez le COO » \(mission id « run-1 »\): [^\n]*night gesture: reopen, no command \(its discussion carries another mission now/)
  expect(text).not.toMatch(/claude --bg --resume 'session-A'/)
  // Témoin : l'autre mission a sa commande.
  expect(text).toMatch(/claude --bg --resume 'session-M'/)
})

test('une mission dont la discussion s’est fermée pendant la surveillance, sans être à rouvrir, n’est pas notée rouverte', { timeoutMs: 30000 }, async ($, on) => {
  // Ses groupes tous faits : pas un blocage, même mise à jour après l'allumage.
  const done = { ...parked('Groupes faits'), tickets: [{ id: '1', name: 'Un', status: 'done' }, { id: '2', name: 'Deux', status: 'done' }] } as unknown as Run
  const { w } = await coo($, on, [{ ...done, updatedAt: T0 + 60_000 } as Run], 'terminal')
  const id = watchId(w)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/not a mission in auto paused by its dashboard/)
})

test('une discussion relancée qui a retrouvé sa mission (detachOnLoad) tourne : pas à rouvrir, même absente de claude agents (une discussion de l’app)', { timeoutMs: 30000 }, async ($, on) => {
  // La fin de la discussion d'abord (prise gardée de son chargement), puis l'app redémarrée la relance sous le même id.
  const loaded = { ...stopped('Relancée'), id: 'run-2', status: 'active', owner: 'local_app1', auto: { onAt: T0 - 30_000, onBy: 'local_app1' }, claim: { boot: 'boot-1', at: T0 - 50_000 } } as unknown as Run
  const ended = parkActive({ ...emptyBoard('/p', 'p'), activeId: 'run-2', runs: [loaded] }, T0 - 2000)!.board
  expect(isEndedPause(ended.runs[0]!)).toBe(true)
  const back = detachOnLoad(ended, T0 - 1000, 'local_app1', 'boot-2').runs[0]!
  expect([back.status, back.owner, back.auto?.offWhy]).toEqual(['active', 'local_app1', AUTO_STOPS.ended])
  expect(isEndedPause(back)).toBe(false)
  // Relancée puis refermée : la fin redate la pause, de nouveau à rouvrir.
  expect(isEndedPause(parkActive(detachOnLoad(ended, T0 - 1000, 'local_app1', 'boot-2'), T0 - 500)!.board.runs[0]!)).toBe(true)
  // Deux processus de la même discussion : l'app l'a reprise, le terminal se ferme ensuite ; elle tourne dans l'app.
  const twice = detachOnLoad(ended, T0 - 1000, 'local_app1', 'boot-2')
  expect(isEndedPause(parkActive({ ...twice, boot: 'boot-1' }, T0 - 500)!.board.runs[0]!)).toBe(false)
  // Le même processus revenu à sa discussion après l'avoir quittée : il la tient, pas à rouvrir.
  expect(isEndedPause(detachOnLoad(ended, T0 - 1000, 'local_app1', 'boot-1').runs[0]!)).toBe(false)
  // Sans prise lisible (un processus sans id) : pas une fin prouvée.
  expect(isEndedPause({ ...ended.runs[0]!, claim: undefined } as Run)).toBe(false)
  const { w } = await coo($, on, [parked('Témoin'), back], 'terminal')
  const id = watchId(w)
  const text = await statement($)
  // Témoin : la mission dont la discussion s'est seulement fermée est à rouvrir dans le même relevé.
  expect(text).toMatch(/- mission « Témoin » \(mission id « run-1 »\): [^\n]*night gesture: reopen/)
  expect(text).not.toMatch(/mission « Relancée » \(mission id « run-2 »\): /)
  expect(text).not.toMatch(/claude --bg --resume 'local_app1'/)
  expect(await ask($, [{ mission: 'run-2', watch: id, act: 'reopen' }])).toMatch(/not a mission in auto paused by its dashboard/)
})

test('notée ouverte et en pause pour une autre raison, une mission n’est pas à rouvrir ; une mission en manuel non plus', { timeoutMs: 30000 }, async ($, on) => {
  const quota = { ...parked('Quota', 'run-2', 'session-N'), auto: { onAt: T0 - 30_000, offAt: T0 - 1000, offWhy: AUTO_STOPS.quota } } as unknown as Run
  const manual = { ...stopped('Manuelle'), id: 'run-3', status: 'active', owner: 'session-P', auto: undefined } as unknown as Run
  const { w } = await coo($, on, [parked('Témoin'), quota, manual], 'terminal')
  const id = watchId(w)
  const text = await statement($)
  // Témoin : la mission « discussion fermée » est à rouvrir dans le même relevé.
  expect(text).toMatch(/- mission « Témoin » \(mission id « run-1 »\): [^\n]*night gesture: reopen/)
  expect(text).not.toMatch(/mission « Quota » \(mission id « run-2 »\): /)
  expect(text).not.toMatch(/mission « Manuelle » \(mission id « run-3 »\): /)
  expect(await ask($, [{ mission: 'run-2', watch: id, act: 'reopen' }])).toMatch(/not a mission in auto paused by its dashboard/)
})

test('le résumé du matin : au message de la personne qui arrête la surveillance, ses gestes, puis ce qui l’attend ; une seule fois', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await coo($, on, [stopped('Fermée')], 'terminal')
  const id = watchId(w)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'reopen' }])).toMatch(/reopened;/)
  // Un message d'une autre session n'arrête rien et ne résume rien.
  expect(await statement($)).not.toMatch(/Night summary/)
  const text = await statement($, 'composer')
  expect(text).toMatch(new RegExp(`Night summary \\(« Résumé de la nuit »\\): the night watch ${id} stopped at .* UTC \\(by the user’s message\\)`))
  expect(text).toMatch(/mission « Fermée » \(mission id « run-1 »\): reopen, commande de réouverture lancée par le COO : mission rouverte: written/)
  expect(text).toMatch(/Missions reopened at night \(their command launched\): « Fermée » \(stayed in manual\); whether each is open now is in the missions list below; the user switches on from the Coordination view \(« ⚡ Auto » then « Confirmer »\) the auto of each mission that stayed in manual; never switch it on yourself\./)
  expect(text).not.toMatch(/Night watch \(« Nuit »\): on/)
  // Une seule fois.
  expect(await statement($, 'composer')).not.toMatch(/Night summary/)
})

test('le résumé du matin : arrêtée à son heure de fin, il attend le premier message de la personne', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on, [stopped('Fermée')])
  const id = watchId(w)
  // L'heure de fin avancée à 3 s après l'allumage : la relecture de 5 s l'arrête « ended ».
  for (const p of Object.keys(w.files).filter(p => p.endsWith('.nuit.json'))) w.files[p] = JSON.stringify({ ...JSON.parse(w.files[p]!), until: JSON.parse(w.files[p]!).at + 3000 })
  for (const k of Object.keys(w.mem).filter(k => k.startsWith('coo-night:'))) {
    const raw = w.mem[k]
    const watch = typeof raw === 'string' ? JSON.parse(raw) : (raw as { at: number })
    w.mem[k] = { ...watch, until: watch.at + 3000 }
  }
  await settle(clock, 12)
  expect(journal(w).filter(l => l.act === 'stop').map(l => l.watch)).toEqual([id])
  expect(await statement($)).not.toMatch(/Night summary/)
  const text = await statement($, 'composer')
  expect(text).toMatch(new RegExp(`Night summary .*the night watch ${id} stopped at .* UTC \\(at its end time\\)`))
  expect(text).toMatch(/reopen, refusé par l’app : pour le matin: refused/)
  expect(await statement($, 'composer')).not.toMatch(/Night summary/)
})

test('le résumé du matin : arrêtée par « Arrêter », il attend le premier message de la personne ; un journal illisible le dit', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on, [stopped('Fermée')])
  await settle(clock, 6)
  expect(await press($, 'coo-night-stop')).toBeDefined()
  await settle(clock, 1)
  expect(await statement($)).not.toMatch(/Night summary/)
  const text = await statement($, 'composer')
  expect(text).toMatch(/Night summary .*\(by « Arrêter »\)/)
  expect(text).toMatch(/reopen, refusé par l’app : pour le matin: refused/)
  // Une autre surveillance, son journal devenu illisible : le résumé le dit.
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
  for (const p of Object.keys(w.files).filter(p => p.endsWith('.nuit-journal.jsonl'))) w.files[p] = '{coupé'
  for (const k of Object.keys(w.mem).filter(k => k.startsWith('coo-night-log:'))) w.mem[k] = '{coupé'
  const unread = await statement($, 'composer')
  expect(unread).toMatch(/night journal could not be read/)
})
