// flow-board : la file d'écriture du registre des agents de la session.
//
// Un fichier par session, `~/.claude/flow-board/agents/<session>.json` (`$.store` en secours),
// écrit par cette session seule (Q7) et lu par l'onglet Agents. Pendant un parcours comme sans.

import { atom, read, update } from 'claude-code'
import type { Board, RegistryPart, SessionRegistry } from '../types'
import { markRebuildNeeded } from './catch-up.ts'
import { erasedRuns, readTraces } from './erase-run.ts'
import { applyTraces } from './erase.ts'
import { activeRun, delegatedTitle } from './model.ts'
import { claudeHome, quietly, sessionId, sessionRoot } from './register.tsx'
import { PARTS_MAX, emptyRegistry, joinRegistry, mergeRegistry, noteCarried, parseOwnRegistry, parsePart, registrySlug, splitRegistry, withHeader } from './registry.ts'

/** Les atomes lus ou mis à jour ici : le moteur veut leur déclaration dans le fichier qui les lit. */
const boardAtom = atom({ plugin: 'flow-board', key: 'board' } as const, null)

const REGISTRY_REF = { plugin: 'flow-board', key: 'agents' } as const
export const registryAtom = atom(REGISTRY_REF, null)
/**
 * Les clés des sous-agents que ce processus a vus partir : les seuls que la liste du moteur peut
 * clore (S9). Dans l'état de la session, qui survit à /reload-plugins ; jamais sur le disque.
 */
export const ownAtom = atom({ plugin: 'flow-board', key: 'agentsOwn' } as const, [] as string[])
/**
 * Le suivi en défaut, que l'onglet dit (S11, R2) : `true`, une écriture du registre a été refusée
 * (fichier trop gros, disque) ; `'lost'`, un changement n'a pas pu s'appliquer à l'état.
 */
export const registryAlertAtom = atom({ plugin: 'flow-board', key: 'agentsAlert' } as const, false as boolean | 'lost')
export const registryKey = (session: string, part = 0): string => (part === 0 ? `agents:${session}` : `agents:${session}:${part}`)

/** Le dossier du registre, `~/.claude/flow-board/agents` ; null quand le dossier de Claude ne se déduit pas. */
export function registryDir($: any): string | null {
  const home = claudeHome($)
  return home ? `${home}/flow-board/agents` : null
}

/** Le fichier d'un morceau du registre d'une session (R1) : `<session>.json`, puis `<session>.1.json`… */
export function registryPath($: any, session: string, part = 0): string | null {
  const dir = registryDir($)
  const slug = registrySlug(session)
  return dir && slug ? `${dir}/${slug}${part === 0 ? '' : `.${part}`}.json` : null
}

export let registrySaveTimer: { cancel: () => void } | null = null

type ReadPiece = { ok: boolean; value: unknown; isAbsent: boolean }

/**
 * Un morceau du registre tel qu'il est enregistré : le fichier s'il existe, sinon `$.store`.
 * `ok` faux : la relecture a échoué (fichier occupé, droits). Un fichier absent dont l'ancien
 * stockage répond par une erreur est absent, pas en erreur (R3) : il se crée.
 */
export async function readPiece($: any, session: string, part: number): Promise<ReadPiece> {
  const path = registryPath($, session, part)
  let isThere = false
  let isKnown = path === null
  if (path) {
    try {
      isThere = await $.fs.exists(path)
      isKnown = true
    } catch {
      // Dossier hors d'atteinte : l'ancien stockage prend le relais.
    }
    if (isThere) {
      try {
        return { ok: true, value: String(await $.fs.read(path)), isAbsent: false }
      } catch {
        return { ok: false, value: null, isAbsent: false }
      }
    }
  }
  // Sans fichier, le registre a pu être écrit dans `$.store` (écriture du fichier refusée).
  try {
    const value = await $.store.get(registryKey(session, part))
    return { ok: true, value: value ?? null, isAbsent: value === undefined || value === null }
  } catch {
    return { ok: isKnown, value: null, isAbsent: isKnown }
  }
}

/**
 * `count` : le nombre de morceaux trouvés, que la prochaine écriture ne descend pas (R1) ;
 * `isWhole` : l'en-tête s'est lu (sinon `value` ne tient que des morceaux, le repli de S8).
 */
type ReadRegistry = { ok: boolean; value: SessionRegistry | null; placed: Map<string, number>; count: number; isWhole: boolean; isBroken?: boolean }

/**
 * Le registre enregistré de la session, morceaux réunis (R1). `ok` faux : une relecture a échoué
 * (fichier occupé, droits), à ne pas confondre avec un contenu illisible, qui rend `value: null`
 * (S8 : il sera réécrit) ou saute le morceau. Au-delà du nombre que dit l'en-tête, les morceaux
 * qui existent se lisent aussi : un morceau né d'une écriture coupée avant l'en-tête, qui l'aurait
 * compté, garde ce qui y est monté.
 */
export async function readRegistry($: any, session: string): Promise<ReadRegistry> {
  const failed: ReadRegistry = { ok: false, value: null, placed: new Map(), count: 1, isWhole: false }
  const first = await readPiece($, session, 0)
  if (!first.ok) return failed
  const head = parseOwnRegistry(first.value, session)
  const parts: (RegistryPart | null)[] = []
  for (let i = 1; i < PARTS_MAX; i++) {
    const piece = await readPiece($, session, i)
    if (!piece.ok) return failed
    if (piece.isAbsent && i >= (head?.parts ?? 1)) break
    const part = parsePart(piece.value)
    parts.push(part?.part === i ? part : null)
  }
  const count = parts.length + 1
  // Un en-tête là mais illisible (écriture coupée) : sa session le reconstruira depuis son transcript (rattrapage, catch-up.ts).
  const isBroken = head === null && !first.isAbsent
  // En-tête illisible (S8) : il sera réécrit, mais les morceaux lisibles comptent déjà.
  const base = head ?? (parts.some(p => p !== null) ? emptyRegistry(session, '', 0) : null)
  if (!base) return { ok: true, value: null, placed: new Map(), count, isWhole: false, isBroken }
  const joined = joinRegistry(base, parts)
  return { ok: true, value: joined.reg, placed: joined.placed, count, isWhole: head !== null && parts.every(p => p !== null), isBroken }
}

/**
 * Écrit un morceau : le fichier, sinon `$.store` ; faux quand les deux le refusent. Un morceau
 * après le premier ne se replie pas dans `$.store` quand son fichier existe ailleurs : la lecture
 * prendrait l'ancien fichier, et ce qui y est monté disparaîtrait.
 */
async function writePiece($: any, session: string, part: number, value: SessionRegistry | RegistryPart): Promise<boolean> {
  const path = registryPath($, session, part)
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(value))
      await lockRegistryDir($)
      return true
    } catch {
      // Repli sur `$.store`, pour le premier morceau seulement.
      if (part > 0) return false
    }
  }
  try {
    await $.store.set(registryKey(session, part), value)
    return true
  } catch {
    return false
  }
}

/**
 * Écrit le registre en morceaux (R1), du dernier au premier : une unité qui monte d'un morceau
 * est en double un instant plutôt que perdue. Faux quand un morceau est refusé partout.
 */
export async function writeRegistry($: any, reg: SessionRegistry, placed: ReadonlyMap<string, number>, minParts: number): Promise<boolean> {
  const { head, parts } = splitRegistry(reg, placed, undefined, Math.max(minParts, reg.parts ?? 1))
  // Un morceau refusé arrête tout : ceux d'avant gardent ce qui serait monté dans le refusé.
  for (const part of [...parts].reverse()) if (!(await writePiece($, reg.session, part.part, part))) return false
  return writePiece($, reg.session, 0, head)
}

/**
 * Le dossier du registre fermé aux autres comptes une fois par processus (F2) ; rien sous Windows
 * ni sans commande. Noté fait une fois réussi seulement (F6) : un échec se retente à l'écriture suivante.
 */
let isRegistryLocked = false
let isRegistryLocking = false
export async function lockRegistryDir($: any) {
  if (isRegistryLocked || isRegistryLocking) return
  const dir = registryDir($)
  if (!dir || /^[a-z]:/i.test(dir)) {
    isRegistryLocked = true
    return
  }
  isRegistryLocking = true
  try {
    isRegistryLocked = (await $.process.run(['chmod', '700', dir], { timeoutMs: 10_000 })).exitCode === 0
  } catch {
    // Commande absente ou refusée : retentée à l'écriture suivante.
  } finally {
    isRegistryLocking = false
  }
}

/** Le registre de cette session : celui de l'état, sinon celui du fichier, sinon un neuf. */
export async function ensureRegistry($: any): Promise<SessionRegistry> {
  const current: SessionRegistry | null = await read($, registryAtom)
  if (current) return current
  // L'id lu à l'instant : après un /clear, la discussion suivante a le sien, donc son propre fichier.
  let session = ''
  await quietly(async () => {
    const id = await $.session.id()
    if (typeof id === 'string') session = id
  })
  if (session === '') session = await sessionId($)
  const now = await $.clock.now()
  const got = await readRegistry($, session)
  if (got.isBroken) markRebuildNeeded()
  const read0 = got.value
  // Un en-tête illisible relu par ses seuls morceaux n'a pas de racine : celle de la session.
  const loaded = read0 ? (read0.root === '' ? { ...read0, root: await sessionRoot($) } : read0) : emptyRegistry(session, await sessionRoot($), now)
  await update($, registryAtom, reg => reg ?? loaded)
  return (await read($, registryAtom)) ?? loaded
}

/**
 * Toutes les écritures de l'état du registre passent par cette file, une à la fois (R2) : les hooks
 * d'outils, de requêtes et de fins ne se disputent plus la même version. Une tâche de la file
 * n'attend jamais une autre tâche de la file.
 */
export let registryQueue: Promise<unknown> = Promise.resolve()
const inRegistryQueue = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = registryQueue.then(job, job)
  registryQueue = run.catch(() => undefined)
  return run
}

/**
 * Applique une transition pure au registre, par la file (R2), puis l'enregistre bientôt
 * (`isSaved` faux : un changement venu du disque, déjà enregistré). Un changement qui ne
 * s'applique toujours pas se dit dans l'onglet au lieu de se perdre en silence.
 */
export function commitRegistry($: any, change: (reg: SessionRegistry) => SessionRegistry | null, isSaved = true): Promise<void> {
  return inRegistryQueue(async () => {
    await ensureRegistry($)
    for (let attempt = 0; attempt < 5; attempt++) {
    const { value, version } = await $.state.get(REGISTRY_REF)
    if (!value) return
    const next = change(value)
    if (!next) return
    if ((await $.state.set(REGISTRY_REF, next, { ifVersion: version })).isSet) {
    if (isSaved) scheduleRegistrySave($)
    return
    }
    }
    await update($, registryAlertAtom, alert => alert || 'lost')
    })
}

/** Ce processus a vu partir ce sous-agent. */
export function ownAgent($: any, key: string) {
  return update($, ownAtom, own => (own.includes(key) ? own : [...own, key]))
}

/** Sous la charge de la frise, l'attente d'une écriture ne dépasse pas ce délai. */
const REGISTRY_SAVE_MAX_MS = 5_000
/** L'échéance posée au premier changement en attente, jamais repoussée. */
let registryDueTimer: { cancel: () => void } | null = null

/**
 * Au rythme des parcours : 600 ms après le dernier changement. Les `turn.step` et les appels
 * d'outil des sous-agents en parallèle peuvent se suivre sans répit : l'échéance garantit une
 * écriture au plus REGISTRY_SAVE_MAX_MS après le premier changement en attente.
 */
function scheduleRegistrySave($: any) {
  registrySaveTimer?.cancel()
  const soon: { cancel: () => void } = $.clock.after(600, () => {
    if (registrySaveTimer === soon) void saveRegistryNow($)
  })
  registrySaveTimer = soon
  if (registryDueTimer) return
  const due: { cancel: () => void } = $.clock.after(REGISTRY_SAVE_MAX_MS, () => {
    if (registryDueTimer === due) void saveRegistryNow($)
  })
  registryDueTimer = due
}

/**
 * Relit le fichier, fusionne (S7 : un autre processus de la même session a pu l'écrire), écrit.
 * Un contenu illisible n'apporte rien et se trouve réécrit (S8) ; une relecture en erreur
 * reporte l'écriture au prochain changement (S10). Une écriture refusée se dit une fois (S11).
 * Ce que le fichier apportait rejoint l'état par la file (R2), sans rien écraser de ce qui a
 * changé entre-temps. Une seule écriture à la fois : demandée pendant qu'une autre tourne, elle
 * suit celle-ci.
 */
let registrySaving: Promise<void> | null = null
let isRegistrySaveAgain = false
export async function saveRegistryNow($: any): Promise<void> {
  // L'une des deux minuteries a tiré (ou un /clear) : l'autre n'a plus lieu d'être. Oubliée sans
  // être annulée : annuler une minuterie depuis le rappel d'une autre fait attendre l'horloge des
  // tests une seconde de temps réel par écriture (le test instable du groupe B) ; arrivée à son
  // heure, elle voit qu'elle n'est plus la bonne et ne fait rien.
  registrySaveTimer = null
  registryDueTimer = null
  if (registrySaving) {
    isRegistrySaveAgain = true
    return registrySaving
  }
  registrySaving = (async () => {
    do {
      isRegistrySaveAgain = false
      await saveRegistryOnce($)
    } while (isRegistrySaveAgain)
  })().finally(() => {
    registrySaving = null
  })
  return registrySaving
}

async function saveRegistryOnce($: any) {
  const { value } = await $.state.get(REGISTRY_REF)
  if (!value) return
  const stored = await readRegistry($, value.session)
  if (!stored.ok) return
  const board: Board | null = await read($, boardAtom)
  const patch = {
    // Le titre de la discussion d'abord (hooks classiques), sinon celui du parcours qu'elle porte ou sert.
    title: value.title ?? (board?.delegate ? delegatedTitle(board) : activeRun(board)?.title),
    // Un parcours effacé n'est plus déclaré (S23).
    run: board?.delegate?.run !== undefined && !erasedRuns.has(board.delegate.run) ? board.delegate.run : undefined,
    group: board?.delegate?.run !== undefined && !erasedRuns.has(board.delegate.run) ? board.delegate.group : undefined,
  }
  // S28 : le parcours actif ici et ceux dont elle porte un ticket « en cours », notés dans l'en-tête ;
  // S31 : avec la date de cette écriture, la dernière où elle les portait.
  const carriedNow = board && !board.delegate ? board.runs.filter(r => (r.id === board.activeId && r.status === 'active') || r.tickets.some(t => t.by === value.session)).map(r => r.id).filter(id => !erasedRuns.has(id)) : []
  const noted = await $.clock.now()
  const titled = withHeader(value, patch) ?? value
  const header = noteCarried(titled, carriedNow, noted) ?? (titled === value ? null : titled)
  // S6 : les traces relues avant chaque écriture ; ce qu'elles couvrent sort du fichier et de l'état.
  const traces = await readTraces($)
  const joined = mergeRegistry(header ?? value, stored.value)
  // Les traces d'abord (celle du parcours couvre la session liée qui le déclare), puis le parcours
  // effacé quitte l'en-tête : la fusion, qui garde l'en-tête déjà écrit, ne le retirerait jamais.
  const merged = withoutErasedRun(applyTraces(joined, traces) ?? joined)
  const isWritten = await writeRegistry($, merged, stored.placed, stored.count)
  if (!isWritten && (await read($, registryAlertAtom)) !== true) {
    await update($, registryAlertAtom, () => true)
    await quietly(() => $.ui.toast('Registre des agents : écriture refusée, la suite n’est plus enregistrée'))
  }
  if (merged !== value) await quietly(() => commitRegistry($, reg => {
    const titledReg = withHeader(reg, patch) ?? reg
    const joined = mergeRegistry(noteCarried(titledReg, carriedNow, noted) ?? titledReg, merged)
    const next = withoutErasedRun(applyTraces(joined, traces) ?? joined)
    return next === reg ? null : next
  }, false))
}

/** Le registre sans le parcours effacé qu'il déclarait (S23), ni son groupe ; tel quel sinon. */
const withoutErasedRun = (reg: SessionRegistry): SessionRegistry => {
  if (reg.run === undefined || !erasedRuns.has(reg.run)) return reg
  const next = { ...reg }
  delete next.run
  delete next.group
  return next
}
