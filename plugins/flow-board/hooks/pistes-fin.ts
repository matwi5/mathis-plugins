/**
 * Les pistes d'une mission « Pistes de rétro » finie, que le relevé du siège du COO finit lui-même (pur) : où en est
 * la mission (`pistesMissionEnd`), ce que le relevé fera de chacune (`planPistesFinish`), l'écriture qui l'applique
 * après les boîtes (`applyPistesFinish`), et ce que le relevé en dit (`finishedLinesOf`) ; de même, une nouvelle carte
 * pour des pistes « validée » dont la carte a disparu (`orphanCardPlans`, `applyOrphanCards`, `orphanLinesOf`). Le mod
 * (`register.tsx` : `finishPistesMissions`) fait les lectures, pose la carte et écrit la liste.
 *
 * Invariant (validé par Mathis) : « Le COO ne sort une piste de « en ticket » ou « en exécution » que pour une mission
 * finie dont aucun groupe n'est chez un worker ; il ne la dit faite que si un ticket fait la nomme ; aucune piste ne
 * quitte la liste ni ne change de texte. » Pour la nouvelle carte, celui de la liste d'attente (validé par Mathis) :
 * « Une écriture d'une rétro ou du COO n'efface ni ne change jamais en silence la piste d'une autre ; une piste ne
 * quitte jamais le fichier, et une piste en exécution ne change plus. », lu ainsi : la carte d'une piste ne change
 * jamais en silence, et jamais celle d'une piste qu'une mission ou un lancement porte encore.
 */

import type { Run } from '../types'
import { clip, sameTicket } from './basics.ts'
import { neutralInPrompt } from './closing.ts'
import { isRecordStale, liveLaunchOf, pistesCardFolder, runOfCard, sameFolder, soundCard, soundRunLaunch, type LaunchRecord } from './launch.ts'
import { finishMissionPistes, namedOfLot, opMark, pistesOf, recardPistes, type BoxedOp, type Piste, type TicketLink, type Waitlist } from './pistes.ts'
import { pistesBackCardId } from './retro-coo.ts'

/** Où en est une mission pour le relevé qui finit ses pistes. */
export type PistesMissionEnd = 'finished' | 'erased' | 'out' | 'open' | 'unknown'

/** Les statuts des tickets d'une mission, à comparer entre deux lectures (ce qui décide « faite »). */
const ticketsPrintOf = (r: Run): string => JSON.stringify(r.tickets.map(t => [t.id, t.status]))

/**
 * Où en est une mission « Pistes de rétro » pour le relevé qui finit ses pistes, sur les deux copies du fichier des
 * missions relues : `finished` (close ou archivée dans chaque copie qui la porte, aucun groupe chez un worker, les
 * mêmes statuts de tickets partout), `erased` (absente des deux copies, sa trace ou sa pierre tombale vue ici),
 * `out` (finie, un groupe encore chez un worker), `open` (en cours, en pause, ou des copies qui divergent),
 * `unknown` (absente sans trace d'effacement : rien, jamais traitée comme effacée).
 */
export const pistesMissionEnd = (id: string, copies: readonly (readonly Run[])[], erased: ReadonlySet<string>): PistesMissionEnd => {
  const found = copies.flatMap(runs => runs.filter(r => r.id === id))
  if (found.length === 0) return erased.has(id) ? 'erased' : 'unknown'
  if (found.some(r => r.status !== 'done' && r.archivedAt === undefined)) return 'open'
  if (found.some(r => ticketsPrintOf(r) !== ticketsPrintOf(found[0]!))) return 'open'
  if (found.some(r => (r.groups ?? []).some(g => g.linked !== undefined))) return 'out'
  return 'finished'
}

/** Une carte nommée par un lancement gardé encore valable (pas périmé), par son id ou son dossier. */
export const isCardInLaunch = (records: readonly LaunchRecord[], card: string, folder: string, now: number): boolean => records.some(r => (r.card === card || sameFolder(r.folder, folder)) && !isRecordStale(r, now))

/** Un texte relu cité dans le relevé : neutralisé, borné. */
const quoted = (text: string): string => `« ${neutralInPrompt(clip(text, 80))} »`
/** Une liste d'ids pour le relevé : 10 au plus, et le compte du reste. */
const idsText = (ids: readonly string[]): string => `${ids.slice(0, 10).map(quoted).join(', ')}${ids.length > 10 ? ` and ${ids.length - 10} more` : ''}`

/**
 * Les missions que le relevé regarde : celles qui portent encore des pistes « en ticket » ou « en exécution », et
 * celles dont la carte de lancement vivant porte encore des pistes « validée » sans mission.
 */
export const pistesFinishCandidates = (pistes: readonly Piste[], runs: readonly Run[]): string[] => {
  const held = new Set(pistes.flatMap(p => ((p.state === 'ticket' || p.state === 'running') && p.mission !== undefined ? [p.mission] : [])))
  for (const r of runs) {
    const l = liveLaunchOf(r)
    if (l && pistes.some(p => p.state === 'validated' && p.mission === undefined && p.card === l.card)) held.add(r.id)
  }
  return [...held]
}

/** Ce que le relevé fera d'une mission finie ou effacée. */
export type PistesFinishPlan = { mission: string; end: 'finished' | 'erased'; doneIds: Set<string>; oldCard?: string; keep: Set<string>; card: string; tickets?: string; isCardless?: true }

/**
 * Le plan du relevé, sur la liste et les deux copies relues : pour chaque mission candidate finie ou effacée, ce
 * qu'il en fera, ou la ligne qui dit pourquoi rien (`left`). `lots` : les lignes « Pistes : » relues des tickets de
 * chaque mission finie (null : le dossier ne se lit pas) ; `pendingBy` et `isWhole` : ce que le dernier passage des
 * boîtes a laissé ; `isTaken` : une carte déjà lancée, nommée par un lancement gardé ou tenue par un clic. Une mission
 * effacée rend ses pistes « en ticket », jamais celles « en exécution » (un worker les tient peut-être).
 */
export const planPistesFinish = (ctx: {
  pistes: readonly Piste[]
  copies: readonly (readonly Run[])[]
  erased: ReadonlySet<string>
  candidates: readonly string[]
  lots: ReadonlyMap<string, { links: TicketLink[]; isComplete: boolean } | null>
  pendingBy: readonly string[]
  isWhole: boolean
  isTaken: (card: string) => boolean
}): { plans: PistesFinishPlan[]; left: string[] } => {
  const { pistes } = ctx
  const runs = ctx.copies.flat()
  const plans: PistesFinishPlan[] = []
  const left: string[] = []
  for (const id of ctx.candidates) {
    const end = pistesMissionEnd(id, ctx.copies, ctx.erased)
    if (end === 'unknown') {
      const ids = pistes.filter(p => p.mission === id && (p.state === 'ticket' || p.state === 'running')).map(p => p.id)
      if (ids.length > 0) left.push(`Pistes ${idsText(ids)} are in a ticket of mission ${quoted(id)}, which is in neither copy of the missions file and has no deletion trace here: the dashboard never treats it as deleted, nothing changes. Tell the user if it lasts.`)
      continue
    }
    if (end !== 'finished' && end !== 'erased') continue
    // Une opération de la mission qui attend dans une boîte, ou une boîte illisible : rien, et pas de carte posée pour rien.
    if (!ctx.isWhole || ctx.pendingBy.includes(id)) {
      left.push(`Mission ${quoted(id)} is ${end === 'erased' ? 'deleted' : 'finished'}, but a change of it still waits in a piste box (or a box could not be read): its pistes stay as they are until it is applied (a change whose author the dashboard cannot prove never applies: tell the user if it lasts).`)
      continue
    }
    if (end === 'erased') {
      // Un worker tient peut-être encore une piste « en exécution » : elle reste.
      const keep = new Set(pistes.filter(p => p.mission === id && p.state === 'running').map(p => p.id))
      const backIds = pistes.filter(p => p.mission === id && p.state === 'ticket').map(p => p.id)
      if (keep.size > 0) left.push(`Mission ${quoted(id)} was deleted while its pistes ${idsText([...keep])} were « en exécution »: a worker may still hold them, so they stay as they are. Tell the user if it lasts; nothing changes by itself.`)
      if (backIds.length === 0) continue
      const card = pistesBackCardId(id, backIds)
      if (!ctx.isTaken(card)) plans.push({ mission: id, end, doneIds: new Set(), keep, card })
      else left.push(`Mission ${quoted(id)} was deleted, but the launch card for its pistes given back (${card}) is already launched or being clicked: nothing changed this time.`)
      continue
    }
    const run = runs.find(r => r.id === id)!
    const launch = liveLaunchOf(run)
    const ownIds = pistes.filter(p => (p.mission === id && (p.state === 'ticket' || p.state === 'running')) || (launch !== null && p.state === 'validated' && p.mission === undefined && p.card === launch.card)).map(p => p.id)
    if (!launch) {
      left.push(`Mission ${quoted(id)} is finished, but its launch is no longer readable (lost or out of form): its pistes ${idsText(ownIds)} stay as they are, and nothing will unblock them by itself. Tell the user.`)
      continue
    }
    const read = ctx.lots.get(id) ?? null
    const lot = read ? namedOfLot(pistes, { card: launch.card, mission: id, links: read.links, tickets: run.tickets, isComplete: read.isComplete, sameTicket }) : null
    const unread = !lot ? 'its tickets folder could not be read' : !lot.isAllRead ? 'a ticket file is missing or unreadable (restore it)' : lot.unreadLines.length > 0 ? `the « Pistes : » line of ticket(s) ${lot.unreadLines.join(', ')} is missing or still the template (fill it in the ticket file)` : null
    if (unread !== null || !lot) {
      left.push(`Mission ${quoted(id)} is finished, but its pistes ${idsText(ownIds)} stay as they are: ${unread ?? 'its tickets folder could not be read'}. The dashboard finishes them at the next reading once that is fixed; tell the user.`)
      continue
    }
    // Une piste nommée par plusieurs tickets revient au premier, comme chez la mission : le relevé le dit.
    for (const w of lot.warnings) if (/is already named by ticket/.test(w)) left.push(`Mission ${quoted(id)}: ${w}.`)
    // « Faite » ne vaut que pour une piste « en ticket » ou « en exécution » de la mission : la carte porte exactement les autres.
    const doneIds = new Set([...lot.named].filter(([p, t]) => pistes.some(x => x.id === p && x.mission === id && (x.state === 'ticket' || x.state === 'running')) && run.tickets.some(x => sameTicket(x.id, t) && x.status === 'done')).map(([p]) => p))
    const toCard = ownIds.filter(p => !doneIds.has(p))
    const card = pistesBackCardId(id, toCard)
    if (ctx.isTaken(card)) {
      left.push(`Mission ${quoted(id)} is finished, but the launch card for its pistes given back (${card}) is already launched or being clicked: nothing changed this time.`)
      continue
    }
    // Toutes ses pistes faites : la carte ne portera rien, elle ne se pose pas.
    plans.push({ mission: id, end, doneIds, oldCard: launch.card, keep: new Set(), card, tickets: ticketsPrintOf(run), ...(toCard.length === 0 ? { isCardless: true as const } : {}) })
  }
  return { plans, left }
}

/** Ce qui a décidé un plan, revérifié sur des copies du fichier des missions : la fin, et les statuts des tickets. */
export const finishPlanHolds = (plan: PistesFinishPlan, copies: readonly (readonly Run[])[], erased: ReadonlySet<string>): boolean =>
  pistesMissionEnd(plan.mission, copies, erased) === plan.end && (plan.tickets === undefined || copies.every(rs => rs.filter(r => r.id === plan.mission).every(r => ticketsPrintOf(r) === plan.tickets)))

/** Ce qu'une écriture a fait d'une mission. */
export type PistesFinishResult = { done: string[]; back: string[]; moved: string[] }

/**
 * Les plans appliqués à la liste, après les boîtes, dans la même écriture : chaque plan revérifié sur les copies
 * relues par l'écriture, rien tant qu'une opération de la mission attend sans marque ou qu'une boîte ne se lit pas ;
 * une transition « en exécution » de la boîte d'une mission effacée, même refusée à l'instant, garde sa piste.
 */
export const applyPistesFinish = (
  list: Waitlist,
  plans: readonly PistesFinishPlan[],
  at: number,
  ctx: { copies: readonly (readonly Run[])[]; ops: readonly BoxedOp[]; isWhole: boolean; erased: ReadonlySet<string> },
): { list: Waitlist; viaTicket: Set<string>; results: Map<string, PistesFinishResult> } => {
  const results = new Map<string, PistesFinishResult>()
  const viaTicket = new Set<string>()
  if (!ctx.isWhole) return { list, viaTicket, results }
  let out = list
  for (const plan of plans) {
    if (!finishPlanHolds(plan, ctx.copies, ctx.erased)) continue
    if (ctx.ops.some(o => o.op.by === plan.mission && !out.applied.includes(opMark(o.session, o.op.id)))) continue
    // Mission effacée : ses pistes « en exécution » de la liste relue par l'écriture, et celles qu'une transition de sa boîte y mène, restent.
    const keep = new Set([...plan.keep, ...(plan.end === 'erased' ? [...ctx.ops.filter(o => o.op.by === plan.mission && o.op.op === 'state' && o.op.state === 'running').map(o => o.op.piste), ...pistesOf(out).filter(p => p.mission === plan.mission && p.state === 'running').map(p => p.id)] : [])])
    const res = finishMissionPistes(out, { mission: plan.mission, doneIds: plan.doneIds, card: plan.card, keep, ...(plan.oldCard !== undefined ? { oldCard: plan.oldCard } : {}) }, at)
    out = res.list
    for (const p of res.fromRunning) viaTicket.add(p)
    if (res.done.length + res.back.length + res.moved.length > 0) results.set(plan.mission, { done: res.done, back: res.back, moved: res.moved })
  }
  return { list: out, viaTicket, results }
}

/** Ce que le relevé dit, une fois, de ce que l'écriture a fait : seulement ce que la liste relue après elle montre. */
export const finishedLinesOf = (plans: readonly PistesFinishPlan[], results: ReadonlyMap<string, PistesFinishResult>, after: readonly Piste[] | null): string[] => {
  const lines: string[] = []
  for (const plan of plans) {
    const res = results.get(plan.mission)
    if (!after || !res) continue
    const done = res.done.filter(id => after.some(p => p.id === id && p.state === 'done'))
    const back = res.back.filter(id => after.some(p => p.id === id && p.state === 'validated' && p.card === plan.card))
    const moved = res.moved.filter(id => after.some(p => p.id === id && p.state === 'validated' && p.card === plan.card))
    if (done.length + back.length + moved.length > 0)
      lines.push(
        `Mission ${quoted(plan.mission)} ${plan.end === 'erased' ? 'was deleted' : 'is finished'}: the dashboard closed its pistes —${done.length > 0 ? ` « faite » (a done ticket names them): ${idsText(done)};` : ''}${back.length > 0 ? ` back to « validée »: ${idsText(back)};` : ''}${moved.length > 0 ? ` still « validée », moved off its spent launch card: ${idsText(moved)};` : ''}${back.length + moved.length > 0 ? ` the « validée » ones are on the new launch card « Pistes de rétro » (${plan.card}), ready to launch.` : ''} Tell the user in one line.`,
      )
  }
  return lines
}


/** Des pistes « validée » d'une carte absente, et la nouvelle carte qui les portera. */
export type OrphanCardPlan = { oldCard: string; card: string; ids: string[] }

/**
 * Les pistes « validée », sans mission, dont la carte n'est pas dans la liste des cartes du projet (`cards`, relues
 * par la lecture des cartes ; une entrée hors forme y compte comme une carte illisible) et qu'aucune mission
 * ni aucun lancement en cours ne porte (`isTaken`, qui dit aussi une carte tenue par un clic ; ni aucune piste « en ticket » ou « en exécution », dont la mission est peut-être absente des copies) : une
 * nouvelle carte par carte absente, son id tiré de l'ancienne et de ses pistes (`pistesBackCardId`, préfixe kn). Dans
 * le doute rien : une boîte illisible ou pas relue (`isWhole`), une carte gardée hors forme, une mission au lancement
 * hors forme, un siège pris depuis moins que la vie d'un lancement gardé et sa grâce (`isSeatOld` : un clic « Lancer » d'une autre
 * discussion, gardé dans un autre stockage, est alors consommé ou périmé) ; la liste commitée dans le projet
 * (`where`), où une carte absente ici peut vivre sur un autre poste : rien, et le relevé le dit ; un endroit inconnu :
 * rien.
 */
export const orphanCardPlans = (ctx: { pistes: readonly Piste[]; cards: readonly unknown[]; runs: readonly Run[]; where: string | undefined; isWhole: boolean; isSeatOld: boolean; erased?: ReadonlySet<string>; pending?: readonly string[]; isTaken: (card: string) => boolean }): { plans: OrphanCardPlan[]; left: string[] } => {
  const have = new Set(ctx.cards.map(c => soundCard(c)?.id))
  // Une carte reste à sa mission tant qu'une de ses pistes « en ticket » ou « en exécution » la porte, ou une piste d'une
  // mission absente des copies sans trace d'effacement (état inconnu ; sans `erased`, une mission absente se lit effacée).
  const isUnknown = (m: string): boolean => ctx.erased !== undefined && !ctx.erased.has(m) && !ctx.runs.some(r => r.id === m)
  const held = new Set(ctx.pistes.flatMap(p => (p.card !== undefined && p.mission !== undefined && (p.state === 'ticket' || p.state === 'running' || isUnknown(p.mission)) ? [p.card] : [])))
  const byCard = new Map<string, string[]>()
  const kept = new Map<string, string[]>()
  for (const p of ctx.pistes)
    if (p.state === 'validated' && p.mission === undefined && p.card !== undefined && !have.has(p.card)) {
      const to = held.has(p.card) ? kept : byCard
      to.set(p.card, [...(to.get(p.card) ?? []), p.id])
    }
  for (const m of [byCard, kept]) for (const card of [...m.keys()]) if (ctx.isTaken(card)) m.delete(card)
  if (byCard.size + kept.size === 0 || !ctx.isWhole || !ctx.isSeatOld || have.has(undefined) || ctx.runs.some(r => r.launch !== undefined && soundRunLaunch(r.launch) === null)) return { plans: [], left: [] }
  // Une carte qu'une mission absente des copies retient encore : rien, et le relevé le dit.
  const keptLines = [...kept].map(([card, ids]) => `Pistes ${idsText(ids)} are « validée » on a launch card no longer in the list of cards (${quoted(card)}), still held by a piste of a mission that is in a ticket, running, or absent from the missions file without a deletion trace: they keep that card meanwhile. Tell the user if it lasts.`)
  if (ctx.where === 'repo') return { plans: [], left: [...(byCard.size > 0 ? [`Pistes ${idsText([...byCard.values()].flat())} are « validée » on a launch card that is not in this computer's list of cards; the retro waitlist lives in the project, so that card may live in another computer's COO: the dashboard gives them no new card. Tell the user if it lasts.`] : []), ...keptLines] }
  if (ctx.where !== 'poste' && ctx.where !== 'unasked') return { plans: [], left: [] }
  const plans = [...byCard].map(([oldCard, ids]) => ({ oldCard, ids, card: pistesBackCardId(oldCard, ids, 'kn') }))
  // Une piste qu'une opération sans marque vise (`pending`, au dernier passage des boîtes) : pas de carte posée pour rien.
  const waiting = (p: OrphanCardPlan) => p.ids.filter(id => ctx.pending?.includes(id))
  return {
    plans: plans.filter(p => !ctx.isTaken(p.card) && waiting(p).length === 0),
    left: [
      ...plans.filter(p => ctx.isTaken(p.card)).map(p => `The new launch card for pistes ${idsText(p.ids)} (${p.card}) is already launched or being clicked: nothing changed this time.`),
      ...plans.filter(p => !ctx.isTaken(p.card) && waiting(p).length > 0).map(p => `Pistes ${idsText(p.ids)} are « validée » on a launch card no longer in the list of cards (${quoted(p.oldCard)}), but a change of ${idsText(waiting(p))} still waits in a piste box: they keep that card until it is applied (a change whose author the dashboard cannot prove never applies). Tell the user if it lasts.`),
      ...keptLines,
    ],
  }
}

/** Une ancienne carte que porte désormais une mission des copies relues : ses pistes ne changent plus de carte. */
export const orphanCardHolds = (plan: OrphanCardPlan, copies: readonly (readonly Run[])[]): boolean => runOfCard(copies.flat(), plan.oldCard, pistesCardFolder(plan.oldCard)) === undefined

/**
 * Les plans des cartes absentes appliqués à la liste, après les boîtes et les missions finies, dans la même écriture :
 * chaque plan revérifié sur la liste, les copies et l'endroit relus par l'écriture (`orphanCardPlans` recalculé : seul
 * un plan rendu à l'identique s'applique) ; rien quand une boîte ne se lit pas ; une carte dont une piste est visée par
 * une opération encore sans marque ne bouge pas du tout (une seule carte pour toutes ses pistes), et le relevé le dit
 * (`left`). Rend les pistes passées sur chaque nouvelle carte.
 */
export const applyOrphanCards = (
  list: Waitlist,
  plans: readonly OrphanCardPlan[],
  at: number,
  ctx: { copies: readonly (readonly Run[])[]; ops: readonly BoxedOp[]; isWhole: boolean; where?: string; cards: readonly unknown[]; isSeatOld: boolean; erased?: ReadonlySet<string>; isTaken: (card: string) => boolean },
): { list: Waitlist; moved: Map<string, string[]>; left: string[] } => {
  const moved = new Map<string, string[]>()
  const left: string[] = []
  const again = new Set(orphanCardPlans({ ...ctx, pistes: pistesOf(list), runs: ctx.copies.flat(), where: ctx.where }).plans.map(p => p.card))
  let out = list
  for (const plan of plans) {
    if (!again.has(plan.card) || !orphanCardHolds(plan, ctx.copies)) continue
    const waiting = plan.ids.filter(id => ctx.ops.some(o => o.op.piste === id && !out.applied.includes(opMark(o.session, o.op.id))))
    if (waiting.length > 0) {
      left.push(`Pistes ${idsText(plan.ids)} are « validée » on a launch card no longer in the list of cards (${quoted(plan.oldCard)}), but a change of ${idsText(waiting)} still waits in a piste box: they keep that card until it is applied. Tell the user if it lasts.`)
      continue
    }
    const res = recardPistes(out, plan, at)
    out = res.list
    if (res.moved.length > 0) moved.set(plan.card, res.moved)
  }
  return { list: out, moved, left }
}

/** Ce que le relevé dit, une fois, des pistes passées sur une nouvelle carte : seulement ce que la liste relue montre. */
export const orphanLinesOf = (plans: readonly OrphanCardPlan[], moved: ReadonlyMap<string, string[]>, after: readonly Piste[] | null): string[] =>
  plans.flatMap(plan => {
    const ids = (moved.get(plan.card) ?? []).filter(id => after?.some(p => p.id === id && p.state === 'validated' && p.card === plan.card))
    return ids.length > 0 ? [`Pistes ${idsText(ids)} were « validée » on a launch card no longer in the list of cards (${quoted(plan.oldCard)}), which no mission or launch carries: they are on the new launch card « Pistes de rétro » (${plan.card}), ready to launch. Tell the user in one line.`] : []
  })
/** Utilisé par le mod pour le contrôle d'une carte : son dossier, tiré de son id. */
export const backCardTaken = (runs: readonly Run[], records: readonly LaunchRecord[], card: string, now: number): boolean =>
  runOfCard(runs, card, pistesCardFolder(card)) !== undefined || isCardInLaunch(records, card, pistesCardFolder(card), now)
