/**
 * Le compte rendu d'un groupe déposé par le manager : quand l'outil flow
 * manque au worker, celui-ci écrit son compte rendu dans un fichier de son worktree et en donne le chemin au
 * manager, qui l'envoie par `{"reportPath": "<chemin>", "group": "<id>"}`. Le mod le lit avec les gardes de
 * `readReportPath` (register.tsx), le garde entier dans un fichier du relais (`managerReportSession`) et pose sur
 * le lien de l'envoi une marque, sa date et sa longueur (`GroupLink.managerReport`), jamais son texte.
 *
 * Invariant, fixé par la personne qui porte la mission (« relais-repli ») : un compte rendu déposé par le
 * manager pour un groupe ne remplace jamais celui que le worker a déposé lui-même, ne s'écrit jamais pour une
 * mission effacée, et ne se lit que dans le worktree noté de ce groupe.
 */

import type { Board, ClosedLink, GroupLink, ManagerReport, Relay, Run, TicketGroup } from '../types'
import { clip, clone, isTime, log, sentGroupOf, shownGroupId } from './basics.ts'
import { isNotedWorktree, isWorktreePath, repoDir } from './closing.ts'
import { earlierOf } from './link.ts'
import { relayForGroup } from './relay.ts'

/** Le plus long compte rendu déposé, en signes : celui de `readReportPath` (`REPORT_PATH_MAX`). */
const DEPOSIT_MAX = 200_000

/**
 * Le nom de « session » du fichier du relais qui garde le texte entier d'un dépôt du manager : il prend la place de
 * l'id de session dans `<parcours>.<session>.report.md` (`reportPath` de register.tsx), sans pouvoir être celui
 * d'un worker (un UUID ou un id `local_…`). Recalculé depuis l'id du groupe et la date du dépôt, jamais gardé.
 */
export const managerReportSession = (groupId: string, at: number): string => `manager-${groupId}-${at}`

/** La marque d'un dépôt relue du fichier des missions : une date et une longueur en forme, sinon rien. */
const readManagerReport = (value: unknown): ManagerReport | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { at, length } = value as Record<string, unknown>
  return isTime(at) && typeof length === 'number' && Number.isInteger(length) && length > 0 && length <= DEPOSIT_MAX ? { at, length } : undefined
}

/** L'envoi qu'un dépôt vise : celui en cours (`linked`), sinon le dernier rendu (`delegated`). */
const currentSend = (g: TicketGroup): GroupLink | undefined => {
  const link = g.linked ?? g.delegated
  return link !== null && typeof link === 'object' ? link : undefined
}

/** Ce qu'un dépôt vise, une fois ses gardes passées : le groupe, son envoi, et la seule racine où lire le fichier. */
export type DepositTarget = { group: TicketGroup; link: GroupLink; worktree: string }

/**
 * Les gardes d'un dépôt avant toute lecture de fichier, une raison par forme refusée (en anglais, pour la réponse de
 * l'outil) :
 * - un groupe absent du plan, ou jamais envoyé à un worker ;
 * - un envoi qui a déjà un dépôt du manager (le premier reste) ;
 * - un relais qui ne se relit pas en entier (`isRelayWhole` faux), ou qui porte un compte rendu du worker de cet
 *   envoi, même coupé : le dépôt ne le remplace jamais ;
 * - un worktree qui n'est pas noté pour cet envoi (nom absent, hors forme ou en conflit) ou une racine de projet
 *   inconnue : sans nom noté, rien ne se lit (le nom recalculé depuis le titre n'est pas celui du lancement).
 */
export const depositTarget = (run: Run, rawGroup: unknown, relay: Relay | null, isRelayWhole: boolean, root: string): DepositTarget | { why: string } => {
  const group = sentGroupOf(run, rawGroup)
  if (!group) return { why: `no group ${shownGroupId(typeof rawGroup === 'string' ? clip(rawGroup, 30) : rawGroup)} in the plan` }
  const link = currentSend(group)
  if (!link) return { why: `group ${shownGroupId(group.id)} was never sent to a worker` }
  const was = readManagerReport(link.managerReport)
  if (link.managerReport !== undefined) return { why: `you already deposited a report for this send of group ${shownGroupId(group.id)}${was ? ` (${new Date(was.at).toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''}: the first one stays` }
  if (!isRelayWhole) return { why: 'the relay of the mission could not be read in full, so a report left by the worker could not be ruled out' }
  if (relayForGroup(relay, group, run.groups, link)?.report !== undefined) return { why: `the worker of group ${shownGroupId(group.id)} left its own report in the relay: it stays, and nothing replaces it` }
  if (link.worktreeClash !== undefined || !isNotedWorktree(link.worktreeName, group.id, link.seq)) return { why: `no worktree noted at the launch of this send of group ${shownGroupId(group.id)}, so no folder to read it from` }
  const repo = repoDir(root)
  const worktree = `${repo}/.claude/worktrees/${link.worktreeName}`
  if (repo === '' || !isWorktreePath(worktree, root)) return { why: 'the project folder is unknown, so no worktree to read it from' }
  return { group, link, worktree }
}

/**
 * Pose la marque du dépôt sur l'envoi visé, dans la mission reçue (un clone) : seulement le même envoi (même date,
 * même nom de worktree noté) que celui dont le fichier a été lu, et seulement s'il n'a pas déjà un dépôt. Vrai quand
 * la marque est posée ; faux sinon (l'envoi a changé ou un autre dépôt est arrivé entre la lecture et l'écriture).
 */
const depositReport = (run: Run, groupId: string, linkAt: number, worktreeName: string, mark: ManagerReport): boolean => {
  const g = (run.groups ?? []).find(x => x !== null && typeof x === 'object' && x.id === groupId)
  if (!g) return false
  const key = g.linked?.at === linkAt ? 'linked' : g.linked === undefined && g.delegated?.at === linkAt ? 'delegated' : undefined
  const link = key ? g[key] : undefined
  if (!key || !link || link.worktreeName !== worktreeName || link.managerReport !== undefined) return false
  g[key] = { ...link, managerReport: mark }
  return true
}

/** Ce que la discussion de la mission a lu et gardé pour un dépôt, avant d'écrire sa marque (`read` : le chemin résolu du fichier lu, sous le worktree noté). */
export type Deposit = { runId: string; groupId: string; linkAt: number; worktreeName: string; mark: ManagerReport; read: string }

/**
 * Le board avec la marque du dépôt posée (`depositReport`) et une ligne au journal, sur une copie ; null quand la
 * mission n'y est plus ou que l'envoi visé a changé, ou qu'un autre dépôt y est déjà : rien n'est alors posé.
 */
export const withDeposit = (board: Board, d: Deposit, now: number): Board | null => {
  const b = clone(board)
  const run = b.runs.find(r => r !== null && typeof r === 'object' && r.id === d.runId)
  // Revérifié à l'instant d'écrire : une mission que cette discussion ne tient plus ne reçoit aucune marque.
  if (!run || run.owner !== b.session || b.delegate || !depositReport(run, d.groupId, d.linkAt, d.worktreeName, d.mark)) return null
  run.updatedAt = Math.max(run.updatedAt, now)
  log(run, now, '⇩', `Compte rendu du groupe ${shownGroupId(d.groupId)} déposé par le manager (son worker n’avait plus l’outil flow)`, 'info')
  return b
}

/**
 * La date du dépôt du manager pour un envoi : une marque en forme, sinon rien. Ne regarde ni le relais ni la session :
 * `groupReportOf` de model.ts l'appelle après sa garde sur la session notée, et seulement quand le relais n'a aucun
 * compte rendu du worker pour cet envoi.
 */
export const managerReportAt = (link: { managerReport?: unknown } | undefined): number | undefined => readManagerReport(link?.managerReport)?.at

/**
 * La fusion de deux copies d'une même mission garde la plus récente ; un dépôt du manager présent dans l'une des deux
 * reste, le plus ancien quand les deux en ont un (le premier dépôt reste, comme à l'envoi). Le même envoi se retrouve
 * dans l'autre copie par sa date d'envoi (`at`), où qu'il soit (`linked`, `delegated`, `earlier`) ; une marque hors
 * forme de l'autre copie n'est pas reprise.
 */
export const keepManagerReports = (kept: Run, other: Run | undefined): Run => {
  if (!other || !Array.isArray(kept.groups)) return kept
  const isLink = (x: unknown): x is ClosedLink => x !== null && typeof x === 'object'
  let changed = false
  const groups = kept.groups.map(g => {
    if (!isLink(g)) return g
    const was = other.groups?.find(x => isLink(x) && x.id === g.id)
    if (!was) return g
    const theirs = [was.linked, was.delegated, ...earlierOf(was.delegated)].filter(isLink)
    const noted = <L extends ClosedLink>(link: L): L => {
      let next = link
      for (const t of theirs.filter(x => x.at === link.at)) {
        const mark = readManagerReport(t.managerReport)
        if (!mark) continue
        const mine = readManagerReport(next.managerReport)
        if (mine === undefined || mark.at < mine.at) next = { ...next, managerReport: mark }
      }
      return next
    }
    const linked = isLink(g.linked) ? noted(g.linked) : g.linked
    let delegated = isLink(g.delegated) ? noted(g.delegated) : g.delegated
    if (isLink(delegated) && Array.isArray(delegated.earlier)) {
      const earlier = delegated.earlier.map(e => (isLink(e) ? noted(e) : e))
      if (earlier.some((e, i) => e !== delegated!.earlier![i])) delegated = { ...delegated, earlier }
    }
    if (linked === g.linked && delegated === g.delegated) return g
    changed = true
    return { ...g, ...(linked !== undefined ? { linked } : {}), ...(delegated !== undefined ? { delegated } : {}) }
  })
  return changed ? { ...kept, groups } : kept
}

/** Les dépôts du manager gardés par une mission, sur chaque lien de chaque groupe : leur nom de fichier, pour l'effacement. */
export const managerReportSessions = (run: Run): string[] => {
  const isLink = (x: unknown): x is ClosedLink => x !== null && typeof x === 'object'
  const out: string[] = []
  for (const g of Array.isArray(run.groups) ? run.groups : []) {
    if (!isLink(g) || typeof (g as TicketGroup).id !== 'string') continue
    const t = g as TicketGroup
    for (const l of [t.linked, t.delegated, ...earlierOf(t.delegated)].filter(isLink)) {
      const mark = readManagerReport(l.managerReport)
      if (mark) out.push(managerReportSession(t.id, mark.at))
    }
  }
  return out
}
