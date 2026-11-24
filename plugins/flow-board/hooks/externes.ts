// Un bloqueur externe qui nomme le ticket d'une autre mission (« <dossier>/<numéro> ») : sa forme, sa notation,
// sa fusion entre deux copies, la relecture de son fichier et sa levée. Le manager n'avait aucun moment où il relit
// une ligne `Status:` (seuls les workers le font, sur leurs propres outils) : la relecture se fait dans la
// discussion qui porte la mission, au passage de 5 s qui suit une lecture réussie du fichier des missions.
//
// Invariant (validé par le porteur le 21/11/2026) :
// « Un bloqueur externe qui nomme un ticket d'une autre mission ne se lève seul que lorsque le fichier de ce ticket,
// lu dans `travail/<dossier>/issues/` sous la racine du projet, dit « fait » ; le ticket nommé ne change plus une fois
// noté ; un bloqueur levé ne redevient à faire que par un envoi explicite "status": "todo" ou par sa tâche Asana
// décochée, et n'est jamais effacé hors de l'effacement de la mission. »

import type { Board, ExternalBlocker, Run } from '../types'
import { activeRun, clip, clone, isTime, log, normRoot, type Outcome, noFx, sameTicket, TEXT_MAX } from './basics.ts'
import { asciiJson } from './closing.ts'
import { isFolderName, liveLaunchOf, sameFolder } from './launch.ts'
import { localTicketChange } from './relay.ts'

/** La forme d'un ticket nommé : un dossier de `travail/` (`isFolderName`), une barre, un numéro de 1 à 4 chiffres. */
const TICKET_REF = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\/(\d{1,4})$/

/**
 * Un ticket nommé en forme, « <dossier>/<numéro> » : le dossier en lettres, chiffres et tirets (`isFolderName` : ni
 * « / », ni « .. », 60 signes au plus), le numéro en chiffres ASCII. Revérifié à chaque lecture et à la fusion : la
 * valeur se relit du fichier des missions, que d'autres discussions écrivent, et entre dans un chemin.
 */
export const isNamedTicket = (v: unknown): v is string => {
  if (typeof v !== 'string') return false
  const m = TICKET_REF.exec(v)
  return m !== null && isFolderName(m[1])
}

/** Le dossier et le numéro d'un ticket nommé en forme, sinon null. */
const ticketRefParts = (v: unknown): { folder: string; number: string } | null => {
  if (!isNamedTicket(v)) return null
  const m = TICKET_REF.exec(v)!
  return { folder: m[1]!, number: m[2]! }
}

/** La date où le ticket a été noté, quand elle est lisible ; sinon la plus tardive (elle perd toute fusion). */
const ticketTime = (x: ExternalBlocker): number => (isTime(x.ticketAt) ? x.ticketAt : Number.POSITIVE_INFINITY)

/** Ce qu'un envoi fait du ticket nommé d'un bloqueur : les champs à poser (aucun quand rien ne change), ou le refus dit. */
export type TicketNoting = { fields: Pick<ExternalBlocker, 'ticket' | 'ticketAt'>; refusal: string | null }

/**
 * Le ticket nommé par un envoi, face au bloqueur gardé (`was`, absent pour un bloqueur neuf) : noté au premier envoi,
 * daté ; le même renvoyé ne change rien ; un autre, ou un envoi sur un ticket gardé illisible, est refusé (le ticket
 * nommé ne change plus une fois noté) ; hors forme, refusé, rien n'est lu. Refusé aussi quand l'id du bloqueur est
 * celui d'un ticket du lot (`openBlockers` le lirait comme ce ticket, jamais comme le bloqueur) ou que le dossier
 * est celui de la mission elle-même, sans la casse (`sameFolder`), quand elle le connaît (`ownFolder` : celui de son
 * lancement par le COO, tant qu'il n'est pas perdu ; une mission ouverte sans lancement ne connaît pas le sien). Chaque
 * refus nomme le bloqueur et dit pourquoi, en anglais (la réponse de l'outil).
 */
export const noteTicket = (was: ExternalBlocker | undefined, id: string, raw: unknown, now: number, ctx: { isLotId: boolean; ownFolder?: string }): TicketNoting => {
  const none: TicketNoting = { fields: {}, refusal: null }
  if (raw === undefined || raw === null) return none
  const name = asciiJson(clip(id, 60))
  const parts = ticketRefParts(raw)
  if (!parts)
    return { fields: {}, refusal: `${name}: "ticket" not recorded, it must be "<folder>/<number>" (the folder of travail/<folder>/issues/, letters, digits and dashes; the number, 1 to 4 digits), not ${asciiJson(clip(String(raw), 60))}; nothing was read` }
  if (ctx.isLotId) return { fields: {}, refusal: `${name}: "ticket" not recorded, this id is also a ticket of this lot (its blockedBy would read that ticket, never the blocker): give the blocker another id` }
  if (ctx.ownFolder !== undefined && sameFolder(parts.folder, ctx.ownFolder)) return { fields: {}, refusal: `${name}: "ticket" not recorded, ${asciiJson(parts.folder)} is the folder of this mission itself: a ticket of the lot goes in blockedBy as its own id` }
  if (was !== undefined && was.ticket !== undefined) {
    if (was.ticket === raw) return none
    return { fields: {}, refusal: `${name}: "ticket" not changed, this blocker already names ${isNamedTicket(was.ticket) ? asciiJson(was.ticket) : 'a ticket that cannot be read'}: the named ticket never changes once noted` }
  }
  return { fields: { ticket: raw as string, ticketAt: now }, refusal: null }
}

/**
 * Le fichier du ticket nommé peut-il encore lever ce bloqueur : à faire, un ticket nommé en forme, jamais levé par son
 * fichier ni rouvert (`isFileSpent`).
 */
export const isFileLiftable = (x: unknown): x is ExternalBlocker & { ticket: string } =>
  x !== null && typeof x === 'object' && typeof (x as ExternalBlocker).id === 'string' && (x as ExternalBlocker).status === 'todo' && isNamedTicket((x as ExternalBlocker).ticket) && (x as ExternalBlocker).isFileSpent !== true

/**
 * Le ticket nommé et sa marque à la fusion de deux copies d'un même bloqueur (`merged`, déjà fusionné pour son statut,
 * et `theirs`, l'autre copie) : la marque `isFileSpent` est unie (jamais retirée) ; un ticket en forme absent d'ici
 * revient de l'autre copie ; deux tickets différents : le plus tôt noté reste (une date lisible l'emporte sur son
 * absence, à égalité le plus petit dans l'ordre du texte), dans les deux ordres ; le même : la date la plus ancienne.
 * Un ticket gardé hors forme cède à un ticket en forme de l'autre copie.
 */
export const keepTicket = (merged: ExternalBlocker, theirs: ExternalBlocker): ExternalBlocker => {
  let out = merged
  if (theirs.isFileSpent === true && out.isFileSpent !== true) out = { ...out, isFileSpent: true }
  if (!isNamedTicket(theirs.ticket)) return out
  const dated = (x: ExternalBlocker) => (isTime(x.ticketAt) ? { ticketAt: x.ticketAt } : {})
  const bare = (x: ExternalBlocker): ExternalBlocker => {
    const y = { ...x }
    delete y.ticketAt
    return y
  }
  if (!isNamedTicket(out.ticket)) return { ...bare(out), ticket: theirs.ticket, ...dated(theirs) }
  if (out.ticket === theirs.ticket) return ticketTime(theirs) < ticketTime(out) ? { ...out, ticketAt: theirs.ticketAt } : out
  const isTheirsFirst = ticketTime(theirs) < ticketTime(out) || (ticketTime(theirs) === ticketTime(out) && theirs.ticket < out.ticket)
  return isTheirsFirst ? { ...bare(out), ticket: theirs.ticket, ...dated(theirs) } : out
}

/** La date où le ticket d'un bloqueur a été noté est au-delà de la tolérance (plus d'une minute dans le futur). */
export const isTicketAtAhead = (x: ExternalBlocker, now: number): boolean => isTime(x.ticketAt) && x.ticketAt > now + 60_000

/** Un bloqueur sans la date de son ticket quand elle est au-delà de la tolérance (`clampFuture`) : elle ne gagne alors aucune fusion. */
export const withoutFutureTicketAt = (x: ExternalBlocker, now: number): ExternalBlocker => {
  if (!isTicketAtAhead(x, now)) return x
  const y = { ...x }
  delete y.ticketAt
  return y
}

/** Ce que la relecture d'un ticket nommé a trouvé. */
export type TicketRead =
  | { ticket: string; state: 'done' }
  | { ticket: string; state: 'open'; status: string }
  | { ticket: string; state: 'missing' | 'several' | 'unreadable' | 'outside' | 'toolarge' }

/** Au-delà de cette taille, le fichier d'un ticket nommé n'est jamais lu (il serait relu toutes les 5 s) : « toolarge ». */
export const TICKET_FILE_BYTES = 256 * 1024

/** Une relecture des tickets nommés qui ne rend pas la main dans ce délai ne lève rien (un fichier qui bloque la lecture). */
const TICKET_READ_MS = 3000

/** La relecture en cours, tant qu'elle n'a pas rendu la main : une seule à la fois, même au-delà de son délai. */
let ticketReading: Promise<TicketRead[]> | null = null

/** Une relecture d'avant n'a pas encore rendu la main : aucune autre ne part, et rien ne se lève par fichier d'ici là. */
export const isTicketReadHeld = (): boolean => ticketReading !== null

/**
 * `readNamedTickets` dans un délai (`TICKET_READ_MS`), une seule à la fois : null quand le délai passe, ou qu'une
 * relecture d'avant n'a pas encore rendu la main (un fichier remplacé entre ses contrôles par un tube ou un lien vers un
 * fichier sans fin, que le moteur suivrait : il ne peut pas lire sans suivre un lien). Null ne lève rien.
 */
export async function readNamedTicketsWithin($: any, root: string, tickets: readonly string[]): Promise<TicketRead[] | null> {
  if (ticketReading !== null) return null
  const reading = readNamedTickets($, root, tickets)
  ticketReading = reading
  reading.then(
    () => {
      if (ticketReading === reading) ticketReading = null
    },
    () => {
      if (ticketReading === reading) ticketReading = null
    },
  )
  return Promise.race([reading, new Promise<null>(resolve => $.clock.after(TICKET_READ_MS, () => resolve(null)))])
}

/**
 * Relit le fichier de chaque ticket nommé : `travail/<dossier>/issues/<numéro>-*.md` sous la racine (`root`, celle de
 * la mission). Le dossier `issues` se résout d'abord (liens suivis), et doit être celui de la racine résolue ; il se
 * liste et se lit ensuite par ce chemin résolu, jamais par celui d'avant (un lien posé entre-temps sur un dossier du
 * chemin n'est pas suivi). Une seule entrée de type fichier dont le numéro vaut celui du ticket (zéros de tête compris,
 * un lien symbolique écarté), un fichier ordinaire de 256 Kio au plus, le même avant et après la lecture (chemin résolu,
 * pas un lien, même taille et même date) ; le statut lu par la ligne `Status:` et son vocabulaire (`localTicketChange`).
 * Aucun ou plusieurs fichiers, une lecture qui lève, un fichier changé pendant la lecture ou trop grand, un dossier ou
 * un fichier qui sort de la racine : rien n'est levé, et la lecture le dit. Un ticket hors forme n'est pas lu. Limite :
 * le moteur suit un lien à la lecture ; un fichier remplacé par un lien entre le contrôle d'avant et la lecture est lu,
 * puis écarté par le contrôle d'après (rien n'est levé) ; un tube qui bloque la lecture est borné par
 * `readNamedTicketsWithin`.
 */
export async function readNamedTickets($: any, root: string, tickets: readonly string[]): Promise<TicketRead[]> {
  const base = normRoot(root)
  const out: TicketRead[] = []
  let realRoot: string | null | undefined
  for (const ticket of [...new Set(tickets)]) {
    const parts = ticketRefParts(ticket)
    if (!parts || base === '') continue
    try {
      if (realRoot === undefined) realRoot = (await $.fs.stat(base, { resolve: true }).catch(() => null))?.realPath ?? null
      const resolved = (await $.fs.stat(`${base}/travail/${parts.folder}/issues`, { resolve: true }).catch(() => null))?.realPath
      if (typeof resolved !== 'string') {
        out.push({ ticket, state: 'missing' })
        continue
      }
      if (typeof realRoot !== 'string') {
        out.push({ ticket, state: 'unreadable' })
        continue
      }
      const dir = `${normRoot(realRoot)}/travail/${parts.folder}/issues`
      if (normRoot(resolved) !== dir) {
        out.push({ ticket, state: 'outside' })
        continue
      }
      const wanted = String(Number(parts.number))
      const files = ((await $.fs.list(dir)) as { name?: unknown; kind?: unknown }[]).filter(f => {
        const m = typeof f?.name === 'string' ? /^(\d{1,4})-[^\\/]+\.md$/.exec(f.name) : null
        return m !== null && String(Number(m[1])) === wanted
      })
      const regular = files.filter(f => f.kind === 'file')
      if (files.length > 1 || regular.length > 1) {
        out.push({ ticket, state: 'several' })
        continue
      }
      if (regular.length === 0) {
        out.push({ ticket, state: files.length === 0 ? 'missing' : 'outside' })
        continue
      }
      const path = `${dir}/${String(regular[0]!.name)}`
      // Le fichier, résolu avant et après la lecture : le même fichier ordinaire, à sa place, ni lien ni changé.
      const same = (s: { kind?: unknown; isLink?: unknown; realPath?: unknown } | null | undefined) => s?.kind === 'file' && s.isLink !== true && typeof s.realPath === 'string' && normRoot(s.realPath) === path
      const before = await $.fs.stat(path, { resolve: true })
      if (!same(before)) {
        out.push({ ticket, state: 'outside' })
        continue
      }
      if (typeof before.size !== 'number' || before.size > TICKET_FILE_BYTES) {
        out.push({ ticket, state: typeof before.size === 'number' ? 'toolarge' : 'unreadable' })
        continue
      }
      const text = await $.fs.read(path)
      const after = await $.fs.stat(path, { resolve: true })
      if (!same(after) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || typeof text !== 'string' || text.length > TICKET_FILE_BYTES) {
        out.push({ ticket, state: 'unreadable' })
        continue
      }
      const change = typeof text === 'string' ? localTicketChange(path, text) : null
      out.push(change?.status === 'done' ? { ticket, state: 'done' } : { ticket, state: 'open', status: change?.status ?? 'unknown' })
    } catch {
      out.push({ ticket, state: 'unreadable' })
    }
  }
  return out
}

/** Les tickets nommés des bloqueurs que leur fichier peut encore lever, dans la mission active de cette discussion. */
export const liftableTickets = (board: Board | null): string[] => {
  const run = board && !board.delegate ? activeRun(board) : undefined
  if (!run || !Array.isArray(run.externals)) return []
  return [...new Set(run.externals.filter(isFileLiftable).map(x => x.ticket))]
}

/**
 * La levée par les fichiers relus (`reads`), sur le board tel qu'il est à l'instant d'écrire : chaque bloqueur que son
 * fichier peut encore lever (`isFileLiftable`, revérifié ici) et dont le ticket nommé est lu « fait » passe « done »,
 * daté, marqué `isFileSpent`, et le journal le dit comme une levée envoyée. Null quand rien ne change.
 */
export const liftByTickets = (board: Board, runId: string, reads: readonly TicketRead[], now: number): Outcome => {
  const done = new Set(reads.filter(r => r.state === 'done').map(r => r.ticket))
  const run0 = activeRun(board)
  if (done.size === 0 || board.delegate || !run0 || run0.id !== runId || !Array.isArray(run0.externals)) return null
  if (!run0.externals.some(x => isFileLiftable(x) && done.has(x.ticket))) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.externals = run.externals!.map(x => {
    if (!isFileLiftable(x) || !done.has(x.ticket)) return x
    const name = typeof x.name === 'string' && x.name !== '' ? x.name : clip(x.id, TEXT_MAX)
    log(run, now, '✓', `Dépendance externe levée : ${name}`, 'ok')
    return { ...x, name, status: 'done' as const, statusAt: now, isFileSpent: true as const }
  })
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Les tickets nommés qu'un appel envoie (`externals`) et que le bloqueur visé (même id, `sameTicket`) porte après
 * l'appel : seuls ceux-là se relisent pour la réponse (un ticket refusé n'est pas lu, même si un autre bloqueur le porte).
 */
export const ticketsToRead = (run: Run | null | undefined, sent: unknown): string[] => {
  const kept = run && Array.isArray(run.externals) ? run.externals : []
  const out: string[] = []
  for (const x of Array.isArray(sent) ? sent : []) {
    if (x === null || typeof x !== 'object') continue
    const { id, ticket } = x as { id?: unknown; ticket?: unknown }
    if (typeof id !== 'string' || !isNamedTicket(ticket)) continue
    if (kept.some(k => k !== null && typeof k === 'object' && typeof k.id === 'string' && sameTicket(k.id, id) && k.ticket === ticket)) out.push(ticket)
  }
  return [...new Set(out)]
}

/** L'id d'un ticket du lot, au sens de `openBlockers` (`sameTicket`). */
export const isLotTicketId = (run: Run, id: string): boolean => run.tickets.some(t => sameTicket(t.id, id))

/** Le dossier de la mission elle-même, quand elle le connaît (son lancement par le COO, pas perdu) ; sinon aucun. */
export const ownFolderOf = (run: Run): string | undefined => liveLaunchOf(run)?.folder

/**
 * Ce que la réponse de l'outil dit des tickets nommés envoyés par cet appel, relus aussitôt : levé, à faire (le statut
 * lu), ou ce qui empêche de le lire ; et qu'un bloqueur déjà rouvert ne se lève plus par son fichier. `isHeld` : une
 * relecture d'avant n'a pas rendu la main (`isTicketReadHeld`), si bien qu'aucune ne repart toutes les 5 s : la réponse
 * le dit, au lieu de promettre une relecture. Vide sans envoi.
 */
export const ticketReadsText = (run: Run | null | undefined, sent: readonly string[], reads: readonly TicketRead[], isHeld = false): string => {
  if (!run || sent.length === 0) return ''
  const parts: string[] = []
  for (const ticket of [...new Set(sent)]) {
    const blocker = (Array.isArray(run.externals) ? run.externals : []).find(x => x !== null && typeof x === 'object' && x.ticket === ticket)
    if (!blocker || !isNamedTicket(ticket)) continue
    const r = reads.find(x => x.ticket === ticket)
    const where = `travail/${ticketRefParts(ticket)!.folder}/issues/${ticketRefParts(ticket)!.number}-*.md`
    if (blocker.status === 'done') parts.push(`${asciiJson(ticket)}: lifted`)
    else if (blocker.isFileSpent === true) parts.push(`${asciiJson(ticket)}: this blocker was reopened, its ticket file no longer lifts it; send "status": "done" when it is`)
    else if (!r && isHeld) parts.push(`${asciiJson(ticket)}: ${where} could not be read: an earlier read of a ticket file has not returned (a file that blocks reading), and nothing is lifted by file until it does or the mod reloads; send "status": "done" when it is`)
    else if (!r || r.state === 'unreadable') parts.push(`${asciiJson(ticket)}: ${where} could not be read now; flow-board reads it again every 5 s`)
    else if (r.state === 'done') parts.push(`${asciiJson(ticket)}: its file says done, lifted within 5 s`)
    else if (r.state === 'open') parts.push(`${asciiJson(ticket)}: its Status line reads ${r.status}, still to do; flow-board lifts it when it says fait`)
    else if (r.state === 'missing') parts.push(`${asciiJson(ticket)}: no file ${where} under the project root, still to do; check the folder and number`)
    else if (r.state === 'several') parts.push(`${asciiJson(ticket)}: several files match ${where}, still to do; it is never lifted while more than one matches`)
    else if (r.state === 'toolarge') parts.push(`${asciiJson(ticket)}: ${where} is over ${TICKET_FILE_BYTES / 1024} KiB, never read, still to do; send "status": "done" when it is`)
    else parts.push(`${asciiJson(ticket)}: ${where} is not a plain file under the project root (a link, or a folder outside it), still to do; it is never read there`)
  }
  return parts.length === 0 ? '' : ` · Named tickets: ${parts.join('; ')}.`
}
