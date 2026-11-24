// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { closingRepo, missionSessionId, missionSessionsArchiveText } from '../hooks/closing.ts'
import { closeDelivered, emptyBoard, newRun } from '../hooks/model.ts'
import { retroCardId } from '../hooks/retro-coo.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'
import { pressAny } from './page-coo.ts'

// Archiver une mission par un clic remet au Claude du COO la procédure de fermeture de sa discussion : au terminal,
// claude stop puis claude rm par l'id court de l'entrée de claude agents ; dans l'app, archive_session ; le clic vaut
// accord, rien ne se demande ; une seule demande pour « ✓ Tout archiver (n) ».

const T0 = 900_000_000
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const UUID2 = '1c7a2d3f-4e5b-4c6d-9e0f-1a2b3c4d5e6f'
const LOCAL = 'local_4f2a9c'
const REPO = '/Users/moi/projet'

/** Une mission au rapport validé, sa phase « Version et push » à faire, en pause : prête à livrer. */
const validated = (now: number, title: string): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  return { ...run, phases: [done, report, pending], cursor: 1, status: 'paused', reportValidatedAt: now - 40_000, updatedAt: now - 1_000 } as Run
}

/** La même, close comme livrée par le COO, née dans la discussion `bornIn`. */
const delivered = (now: number, title: string, bornIn?: string): Run => {
  const run = { ...validated(now, title), ...(bornIn !== undefined ? { bornIn } : {}) }
  const board: Board = { ...emptyBoard('', 'projet'), runs: [run] }
  return closeDelivered(board, run.id, now - 500, { version: '0.80.0', push: 'main' })!.board.runs[0]!
}

/** Le texte, rendu non nul. */
const textOf = (all: { title: string; id?: string }[], repo: string | null = REPO): string => {
  const text = missionSessionsArchiveText(all, repo)
  expect(text).not.toBeNull()
  return text ?? ''
}

test('terminal : contrôle à l’instant d’abord, puis l’entrée au sessionId exact, claude stop puis claude rm par son id court, sans option ni nom', () => {
  const text = textOf([{ title: '« A »', id: UUID }])
  expect(text).toContain(`la discussion de la mission « A » (id de session ${UUID})`)
  expect(text).toContain('cette mission est archivée')
  expect(text).not.toContain('livrée')
  // Le clic vaut accord : rien ne se demande.
  expect(text).toContain('Mon clic d’archivage vaut mon accord pour fermer cette discussion : ne me le demande pas.')
  expect(text).not.toContain('demande-le-moi')
  // Le siège d'abord, puis le contrôle à l'instant, avant tout arrêt.
  expect(text).toContain('Si ta dernière ligne « COO seat » dit que tu ne tiens plus le siège, ne ferme rien')
  expect(text).toContain(`{"coordinate": {"toClose": ["${UUID}"]}}`)
  expect(text).toContain('seules celles que sa réponse rend se ferment, ne touche à aucune autre')
  expect(text.indexOf('"toClose"')).toBeLessThan(text.indexOf('claude stop'))
  // L'entrée exacte, ses cas, l'id court.
  expect(text).toContain('prends l’entrée dont le "sessionId" est exactement cet id ; aucune : absente, rien à faire (si l’outil archive_session est ici')
  expect(text).toContain('à la main si elle est encore là) ; plus d’une : rien, dis-le')
  // Dans l'app, un UUID que claude agents ne liste pas est peut-être une discussion de l'app : rendue absente, mais dite.
  expect(text).toContain('rends-la absente avec "why": "introuvable au terminal" et dis-moi en une ligne de l’archiver à la main si elle est encore là')
  // Seule une session au repos se ferme : tout autre status la remet à plus tard (un tour ou une tâche en cours).
  expect(text).toContain('Une entrée qui a encore un "pid" doit porter "status": "idle" et pas "state": "working" ("state": "blocked" d’une session qui a fini ne compte pas) : tout autre status (busy, absent, autre), ou "state": "working", la remet à plus tard, sans compte rendu pour elle')
  expect(text).toContain(`si son "cwd" (un \\ lu comme /) n’est pas exactement « ${REPO} », la racine du dépôt : claude stop <id> si elle a encore un "pid", jamais claude rm (il supprimerait son worktree), puis, l’entrée relue sans "pid", état « arrêtée seulement ».`)
  expect(text).toContain(`Si son "cwd" est exactement cette racine : claude stop <id> si elle a encore un "pid", puis, l’entrée relue sans "pid", claude rm <id> sans aucune option, état « fermée »`)
  // Une entrée déjà arrêtée ne passe à claude rm qu'à la racine du dépôt : jamais dans un worktree (A10).
  expect(text.match(/passe directement à claude rm/g)?.length).toBe(1)
  expect(text).toContain('une entrée à la racine du dépôt déjà sans "pid" passe directement à claude rm')
  expect(text).toContain('<id> est le champ "id" de cette entrée (lettres, chiffres, _ et -, sans - en tête, sinon rien)')
  expect(text).toContain('jamais le sessionId complet, jamais un nom ni un titre')
  expect(text).toContain('Si claude stop refuse, ou que l’entrée garde son "pid" après lui, remets-la à plus tard')
  // Sa propre discussion : jamais, avant toute étape.
  expect(text.indexOf('Jamais la discussion où tu tournes, même si son id correspond, au terminal comme dans l’app.')).toBeLessThan(text.indexOf('(1)'))
  // Jamais d'option, même suggérée par un refus ; un refus : arrêtée seulement.
  expect(text).toContain('Si claude rm refuse, l’état est « arrêtée seulement », avec la raison du refus ; n’ajoute jamais d’option à claude rm, même si son refus en suggère une')
  expect(text).not.toContain('--discard-unpushed')
  expect(text).not.toContain('--force')
  // Déjà arrêtée : directement claude rm ; absente : rendue absente.

  // Le compte rendu, en JSON valide, puis la ligne à la personne.
  expect(text).toContain('{"coordinate": {"discussionsClosed": [{"session": "<id de session>", "state": "<état>", "why": "<raison>"}]}}')
  expect(text).toContain('"state" vaut "closed" (fermée), "stopped" (arrêtée seulement), "app" (archivée dans l’app) ou "absent" (absente)')
  expect(text).toContain('aucune pour une discussion remise à plus tard')
  expect(text).toMatch(/Puis dis-moi en une ligne ce qui a été fermé, arrêté seulement, archivé dans l’app, absent ou laissé\.$/)
  expect(text.startsWith('/')).toBe(false)
})

test('app : archive_session, le clic cité comme accord, sans ligne de demande ; jamais la discussion où tourne le COO', () => {
  const text = textOf([{ title: '« A »', id: LOCAL }])
  expect(text).toContain(`(id de session ${LOCAL})`)
  expect(text).toContain('Pour un id local_…, dans l’app : archive-la par l’outil archive_session de l’app, avec une raison (« flow-board : mission archivée, discussion fermée »), en citant mon clic d’archivage dans le tableau de bord comme mon accord pour cette discussion, sans ligne de demande')
  expect(text).toContain('si l’app refuse, ou qu’il n’y a pas d’outil archive_session ici, remets-la à plus tard, dis-le en une ligne')
  expect(text).toContain('Jamais la discussion où tu tournes, même si son id correspond, au terminal comme dans l’app.')
  // L'ancienne rédaction (« au terminal, rien », l'accord demandé, la recherche par titre) a disparu.
  expect(text).not.toContain('ne fais rien et n’en dis rien')
  expect(text).not.toContain('l’outil d’archivage de l’app demande mon accord')
  expect(text).not.toContain('par le titre exact')
})

test('deux missions nées dans la même discussion : elle n’est nommée qu’une fois, avec les deux titres', () => {
  const text = textOf([{ title: '« A »', id: UUID }, { title: '« B »', id: UUID }])
  expect(text).toContain(`la discussion de la mission « A » ou « B » (id de session ${UUID})`)
  expect(text.split(UUID).length).toBe(3) // une fois nommée, une fois dans l'appel de contrôle
  expect(text).toContain('ces missions sont archivées')
  expect(text).toContain('sa discussion est à fermer')
})

test('plusieurs discussions : une seule demande, qui les nomme toutes et les contrôle toutes', () => {
  const text = textOf([{ title: '« A »', id: UUID }, { title: '« B »', id: LOCAL }, { title: '« C »', id: UUID2 }])
  expect(text).toContain(`« A » (id de session ${UUID}) ; la discussion de la mission « B » (id de session ${LOCAL}) ; la discussion de la mission « C » (id de session ${UUID2})`)
  expect(text).toContain(`{"coordinate": {"toClose": ["${UUID}", "${LOCAL}", "${UUID2}"]}}`)
  expect(text).toContain('leurs discussions sont à fermer')
  expect(text).toContain('Mon clic d’archivage vaut mon accord pour fermer chacune de ces discussions')
})

test('un id hors forme, un gabarit non rempli ou un id absent n’entrent ni dans le texte ni dans une commande', () => {
  expect(missionSessionsArchiveText([{ title: '« A »' }], REPO)).toBeNull()
  expect(missionSessionsArchiveText([{ title: '« A »', id: 'abc"; rm -rf ~' }], REPO)).toBeNull()
  expect(missionSessionsArchiveText([{ title: '« A »', id: '<id de session>' }], REPO)).toBeNull()
  expect(missionSessionsArchiveText([], REPO)).toBeNull()
  // Mêlé à un id valide : seul celui-là est nommé ; les trois missions archivées sont comptées.
  const text = textOf([{ title: '« A »', id: 'abc"; rm -rf ~' }, { title: '« B »', id: '<id>' }, { title: '« C »', id: UUID }])
  expect(text).not.toContain('rm -rf')
  expect(text).not.toContain('<id>"')
  expect(text).not.toContain('« A »')
  expect(text).not.toContain('« B »')
  // Trois missions archivées, une seule discussion nommée.
  expect(text).toContain('ces missions sont archivées dans le tableau de bord ; sa discussion est à fermer')
  expect(text).toContain(`{"coordinate": {"toClose": ["${UUID}"]}}`)
})

test('la racine du dépôt : celle d’un worktree remonte au dépôt ; hors forme, claude stop seul pour toutes', () => {
  expect(closingRepo('/Users/moi/projet')).toBe('/Users/moi/projet')
  expect(closingRepo('/Users/moi/projet/.claude/worktrees/groupe-x')).toBe('/Users/moi/projet')
  expect(closingRepo('C:\\proj')).toBe('C:/proj')
  for (const bad of ['', 'relatif/projet', '/a\nb', '/a « b »', '/a/$(x)', '/a/`x`', 42, undefined]) expect(closingRepo(bad)).toBeNull()
  const text = textOf([{ title: '« A »', id: UUID }], null)
  expect(text).toContain('la racine du dépôt n’est pas sûre ici : pour chacune, claude stop <id> si elle a encore un "pid", jamais claude rm (il supprimerait son worktree), puis, l’entrée relue sans "pid", état « arrêtée seulement »')
  expect(text).not.toContain('pas exactement « ')
  // Aucune branche ne mène à claude rm.
  expect(text).not.toContain('claude rm <id>')
  expect(text).not.toContain('passe directement à claude rm')
})

test('la demande refusée à l’envoi : rien n’est perdu, le toast dit que le COO la fermera à son prochain tour, et le relevé suivant la porte', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  writeBoard(w, x => ({ ...x, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.submit.drop = true
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: `coo-card-archive-${retroCardId(a.id)}` })
  await view.unmount()
  await settle(clock, 2)
  w.submit.drop = false
  expect(stored(w).runs.find(r => r.id === a.id)!.archivedAt).toBeDefined()
  const toast = w.toasts.find(t => t.includes('La demande de fermer sa discussion n’est pas partie')) ?? ''
  expect(toast).toContain('Le COO fermera sa discussion à son prochain tour.')
  expect(toast).not.toContain('à la main')
  expect(toast).not.toContain('reclique')
  // Le relevé suivant porte la discussion.
  const next = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(next).toContain('Discussions to close')
  expect(next).toContain(`(id de session ${UUID})`)
})

test('de bout en bout : le clic archive, la demande part, le contrôle rend la discussion, le compte rendu écrit la trace, et le relevé suivant ne la porte plus', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  writeBoard(w, x => ({ ...x, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: `coo-card-archive-${retroCardId(a.id)}` })
  await view.unmount()
  await settle(clock, 2)
  const asks = w.prompts.slice(before).filter(t => t.includes('"toClose"'))
  expect(asks.length).toBe(1)
  expect(asks[0]).toContain(`la discussion de la mission « Mission A » (id de session ${UUID})`)
  const call = async (input: unknown) => String(((await $.tool.call({ tool: 'mcp__flow-board__flow', coordinate: input } as any)) as any).result)
  expect(await call({ toClose: [UUID] })).toContain(`Discussions still to close: "${UUID}"`)
  expect(await call({ discussionsClosed: [{ session: UUID, state: 'closed' }] })).toContain('Recorded: 1 discussion(s)')
  const next = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(next).toContain('COO statement')
  expect(next).not.toContain('Discussions to close')
})

test('l’écriture de « ✓ Tout archiver (2) » différée : le toast dit que le COO fermera les seules discussions que la liste des discussions à fermer rend', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  // Née dans une discussion encore au travail sur une autre mission : jamais nommée, même au toast.
  const b = delivered(T0, 'Mission B', LOCAL)
  const busy = { ...newRun('implement', T0, 'Autre'), owner: LOCAL }
  writeBoard(w, x => ({ ...x, runs: [a, b, busy] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.probe.refuseBoard = text => text.includes('Mission archivée')
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  w.probe.refuseBoard = undefined
  const toast = w.toasts.find(t => t.includes('L’archivage n’est peut-être pas encore écrit')) ?? ''
  expect(toast).toContain('Le COO fermera sa discussion à son prochain tour.')
  expect(toast).not.toContain('à la main')
  expect(w.prompts.slice(before).some(t => t.includes('"toClose"'))).toBe(false)
})

test('l’id passé : bornIn, puis owner, le premier en forme ; jamais celui d’ici ni celui d’une autre mission non archivée', () => {
  const run = delivered(T0, 'M')
  expect(missionSessionId(run, [run], LOCAL)).toBeUndefined()
  expect(missionSessionId({ ...run, bornIn: 'pas-un-id', owner: UUID }, [run], LOCAL)).toBe(UUID)
  expect(missionSessionId({ ...run, bornIn: UUID, owner: 'local_autre' }, [run], LOCAL)).toBe(UUID)
  // La discussion d'ici (le COO) : jamais nommée, même par son titre.
  expect(missionSessionId({ ...run, bornIn: LOCAL }, [run], LOCAL)).toBeNull()
  // Partagée avec une mission encore au travail : jamais nommée ; avec une mission archivée, si.
  const other = { ...newRun('implement', T0, 'Autre'), owner: UUID }
  expect(missionSessionId({ ...run, bornIn: UUID }, [run, other], LOCAL)).toBeNull()
  expect(missionSessionId({ ...run, bornIn: UUID }, [run, { ...other, status: 'done', archivedAt: T0 }], LOCAL)).toBe(UUID)
  // Archivée mais redevenue active, ou sans date d'archivage lisible : elle tient encore la discussion.
  expect(missionSessionId({ ...run, bornIn: UUID }, [run, { ...other, archivedAt: T0 }], LOCAL)).toBeNull()
  expect(missionSessionId({ ...run, bornIn: UUID }, [run, { ...other, status: 'done', archivedAt: null } as unknown as Run], LOCAL)).toBeNull()
})

test('« ✓ Tout archiver (2) » : une seule demande au Claude du COO, qui ne nomme que la discussion à l’id sûr', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  const b = delivered(T0, 'Mission B')
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.every(r => r.archivedAt !== undefined)).toBe(true)
  const asks = w.prompts.slice(before).filter(t => t.includes('"toClose"'))
  expect(asks.length).toBe(1)
  expect(asks[0]).toContain(`la discussion de la mission « Mission A » (id de session ${UUID})`)
  expect(asks[0]).toContain(`{"coordinate": {"toClose": ["${UUID}"]}}`)
  // Sans id sûr, la discussion de B n'est ni nommée ni cherchée par son titre.
  expect(asks[0]).not.toContain('Mission B')
})

test('rien d’archivé (liste changée) : aucune demande d’archiver une discussion', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  writeBoard(w, x => ({ ...x, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.probe.onBoardRead = () => {
    w.probe.onBoardRead = undefined
    writeBoard(w, x => ({ ...x, runs: [...x.runs, delivered(T0, 'Mission C')] }))
  }
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: `coo-card-archive-${retroCardId(a.id)}` })
  await view.unmount()
  await settle(clock, 2)
  expect(w.toasts.some(t => t.includes("La liste a changé depuis : rien n'est archivé"))).toBe(true)
  expect(stored(w).runs.find(r => r.id === a.id)!.archivedAt).toBeUndefined()
  expect(w.prompts.slice(before).some(t => t.includes('"toClose"'))).toBe(false)
})

test('le clic met ses discussions en tête de la tâche des fermetures : 30 discussions plus anciennes en attente ne coupent pas la sienne, 30 au plus, et le contrôle la rend', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const old = Array.from({ length: 30 }, (_, i) => {
    const r = delivered(T0, `Ancienne ${i}`, `${String(i).padStart(8, '0')}-3d4a-4b5c-8d9e-0f1a2b3c4d5e`)
    return { ...r, archivedAt: T0 - 20_000, archivedBy: { by: 'clic', at: T0 - 20_000 } } as Run
  })
  const a = delivered(T0, 'Mission A', UUID)
  writeBoard(w, x => ({ ...x, runs: [...old, a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: `coo-card-archive-${retroCardId(a.id)}` })
  await view.unmount()
  await settle(clock, 2)
  const asks = w.prompts.slice(before).filter(t => t.includes('"toClose"'))
  expect(asks.length).toBe(1)
  // La tâche « fermetures » du pas à pas : la discussion du clic d'abord, puis les plus anciennes, 30 au plus (la 30e attend).
  expect(asks[0]).toContain(`{"coordinate": {"toClose": ["${UUID}", `)
  expect(asks[0]).toContain('Ancienne 28')
  expect(asks[0]).not.toContain('Ancienne 29')
  // Les appels que la demande dicte, rejoués : le contrôle la rend, le compte rendu écrit sa trace.
  const call = async (input: unknown) => String(((await $.tool.call({ tool: 'mcp__flow-board__flow', coordinate: input } as any)) as any).result)
  expect(await call({ toClose: [UUID] })).toContain(`Discussions still to close: "${UUID}"`)
  expect(await call({ discussionsClosed: [{ session: UUID, state: 'closed' }] })).toContain('Recorded: 1 discussion(s)')
})

test('une mission archivée que la liste ne rend pas (discussion de l’autre surface) : aucune demande, et le toast ne promet rien', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  // Le COO tourne au terminal (session-A) : une discussion de l'app ne se ferme pas d'ici.
  const a = delivered(T0, 'Mission A', LOCAL)
  writeBoard(w, x => ({ ...x, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: `coo-card-archive-${retroCardId(a.id)}` })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === a.id)!.archivedAt).toBeDefined()
  expect(w.prompts.slice(before).some(t => t.includes('"toClose"'))).toBe(false)
  expect(w.toasts.some(t => t.includes('Le COO fermera'))).toBe(false)
})

test('l’écriture différée de deux missions nées dans la même discussion : le toast parle d’une seule discussion', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  const b = delivered(T0, 'Mission B', UUID)
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.probe.refuseBoard = text => text.includes('Mission archivée')
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  w.probe.refuseBoard = undefined
  const toast = w.toasts.find(t => t.includes('L’archivage n’est peut-être pas encore écrit')) ?? ''
  expect(toast).toContain('Le COO fermera sa discussion à son prochain tour.')
  expect(toast).not.toContain('leurs discussions')
})
