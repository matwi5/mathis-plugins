// Le faux moteur des tests du fichier de coordination et des retenues entre missions : le fichier commun
// des missions (ou `$.store`), le fichier de coordination (au fichier comme dans `$.store`), ses copies
// mises de côté, et les envois à une autre discussion. Un module d'aide, pas un fichier de test.

import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, CooSeat, Run } from '../types'

export const TOOL = 'mcp__flow-board__flow'
export const KEY = 'board:'
export const COO = 'flow-board:coo'
export const PLUGIN = 'flow-board'
export const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

export const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')
/** Le fichier de coordination, quel que soit son nom (le nom de ce projet sur ce poste), hors copies mises de côté. */
export const isCoordFile = (path: string): boolean => path.includes('/flow-board/coordination/') && path.endsWith('.json') && !path.includes('feuille-de-route') && !path.includes('.illisible-')
export const isCoordKey = (key: string): boolean => key.startsWith('coo-coordination:') && !key.includes(':illisible:')

/**
 * Le moteur sous le plugin, comme `coo-siege.test.ts` : le fichier commun des missions quand le mod sait
 * où est ~/.claude (`disk`), `$.store` sinon (`mem`) ; le fichier de coordination, au fichier comme dans
 * `$.store` (`coord`) ; ses copies mises de côté (`asides`) ; les envois à une autre discussion (`sends`).
 */
export const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const disk: { board?: string; isUsed: boolean; unwritable?: boolean; unreadable?: boolean } = { isUsed: false }
  /** Les messages que le mod soumet (consigne de l'auto, vague de groupes), et les commandes qu'il lance. */
  const prompts: string[] = []
  const runs: string[] = []
  /** Ce que le mod met dans le prompt sans l'envoyer (une commande, une demande de lancement). */
  const fills: string[] = []
  /** Les notifications que le mod envoie (\`$.ui.notify\`). */
  const notices: string[] = []
  const coord: { text?: string; unread: boolean; throws: boolean; writes: string[] } = { unread: false, throws: false, writes: [] }
  const asides: Record<string, string> = {}
  const files: Record<string, string> = {}
  const ids = { now: 'session-A' }
  const sends: { to: unknown; text: string }[] = []
  const deliver = { ok: true }
  const commands: string[] = []
  /** `drop` : le prochain message soumis est refusé (comme un hook qui l'écarte). */
  const submit = { drop: false }
  /** Les toasts du mod. */
  const toasts: string[] = []
  /** Joué à chaque relecture du fichier de coordination (pour une écriture croisée d'une autre discussion à ce moment-là). */
  const probe: { onCoordRead?: () => void; onBoardWrite?: (text: string) => void; refuseBoard?: (text: string) => boolean; refuseStore?: (key: string) => boolean } = {}
  on('session.end', () => ({ sessionId: ids.now }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    if (submit.drop) return { text: e.text, drop: 'refusé' } as any
    prompts.push(e.text)
    return { text: e.text, context: e.context }
  })
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('ui.notify', (_$: unknown, e: { text: string }) => {
    notices.push(e.text)
    return { value: undefined }
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: ids.now }))
  on('session.send', (_$: unknown, e: { to: unknown; text: string }) => {
    sends.push({ to: e.to, text: e.text })
    return (deliver.ok ? { isDelivered: true } : { isDelivered: false, reason: 'refused in auto mode' }) as any
  })
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (isCoordKey(e.key)) {
      probe.onCoordRead?.()
      if (coord.throws) throw new Error('EBUSY')
      if (coord.unread) return { value: 'pas un fichier' }
      return { value: coord.text === undefined ? undefined : JSON.parse(coord.text) }
    }
    if (e.key === KEY && disk.unreadable) throw new Error('EIO')
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (isCoordKey(e.key)) {
      coord.text = JSON.stringify(e.value)
      coord.unread = false
      coord.writes.push(coord.text)
    } else if (e.key.includes(':illisible:')) asides[e.key] = String(e.value)
    else if (e.key === KEY && (disk.unwritable || probe.refuseBoard?.(JSON.stringify(e.value)))) throw new Error('EROFS')
    else if (probe.refuseStore?.(e.key)) throw new Error('EROFS')
    else {
      mem[e.key] = JSON.parse(JSON.stringify(e.value))
      if (e.key === KEY) probe.onBoardWrite?.(JSON.stringify(e.value))
    }
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('store.delete', (_$: unknown, e: { key: string }) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => {
    if (isCoordFile(e.path)) probe.onCoordRead?.()
    // Un fichier du projet posé par son chemin relatif (« travail/… ») : le moteur le reçoit résolu depuis le dossier de travail.
    const isProjectFile = Object.keys(files).some(k => !k.startsWith('/') && e.path.endsWith(`/${k}`))
    return { value: isBoardFile(e.path) ? disk.board !== undefined : isCoordFile(e.path) ? coord.unread || coord.text !== undefined : e.path in files || e.path in asides || isProjectFile } as any
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (disk.unreadable || disk.board === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: disk.board } as any
    }
    if (isCoordFile(e.path)) {
      if (coord.throws) throw new Error(`EBUSY ${e.path}`)
      if (coord.unread) return { value: '{"v":1,"root":"","entr' } as any
      if (coord.text === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: coord.text } as any
    }
    // Un fichier posé par la fin de son chemin (« travail/… », « flow-board/rapports/… ») : le premier dont le chemin finit ainsi.
    const key = e.path in files ? e.path : Object.keys(files).find(k => !k.startsWith('/') && e.path.endsWith(`/${k}`))
    if (key === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: files[key] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (disk.unwritable || probe.refuseBoard?.(e.text)) throw new Error(`EROFS ${e.path}`)
      disk.board = e.text
      probe.onBoardWrite?.(e.text)
    } else if (isCoordFile(e.path)) {
      coord.text = e.text
      coord.unread = false
      coord.writes.push(e.text)
    } else if (e.path.includes('.illisible-')) asides[e.path] = e.text
    else files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', () => ({ value: [] }) as any)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('command.run', (_$: unknown, e: { command: string }) => {
    if (e.command === COO) commands.push(e.command)
    else runs.push(e.command)
    return { text: '' }
  })
  return { mem, disk, coord, asides, files, ids, sends, deliver, probe, prompts, runs, fills, notices, submit, toasts }
}
export type World = ReturnType<typeof world>

export const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
export const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
/** Le board enregistré : dans le fichier commun s'il sert, sinon dans `$.store`. */
export const stored = (w: World): Board => (w.disk.isUsed && w.disk.board !== undefined ? JSON.parse(w.disk.board) : w.mem[KEY]) as Board
/** Ce qu'une autre discussion écrit dans le fichier des missions. */
export const writeBoard = (w: World, change: (b: Board) => Board) => {
  const base = stored(w) ?? { ...emptyBoard('', 'projet'), deleted: [] }
  const next = change(base)
  w.mem[KEY] = next
  w.disk.board = JSON.stringify(next)
}
export const seatOf = (by: string, at: number): CooSeat => ({ by, at, seenAt: at })
export const missionOfB = (now: number, status: Run['status'] = 'active'): Run => ({ ...newRun('implement', now, 'Mission de B'), status, ...(status === 'active' ? { owner: 'session-B' } : {}) })
export const entries = (w: World): any[] => (w.coord.text === undefined ? [] : JSON.parse(w.coord.text).entries)
export const coordFile = (list: unknown[]) => JSON.stringify({ v: 1, root: '', entries: list })

export const openCoo = async ($: any, clock: { advance: (ms: number) => Promise<void> }): Promise<string> => {
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 4)
  return (await loading).text
}
