/**
 * Le worker silencieux : chez le manager, un groupe confié à un worker, pas encore rendu, qui n'a pas rendu son compte
 * rendu (ni au relais ni par un dépôt du manager) et ne signale plus rien depuis 30 minutes. Le manager reçoit une note,
 * une fois par silence (la date du dernier signal) : vérifier par ListAgents si le worker tourne encore, et, au repos,
 * lui demander où il en est. Rien n'est gardé sur le disque : le dernier silence signalé tient en mémoire
 * (`register.tsx`).
 */

import type { Relay, Run } from '../types'
import { isTime, shownGroupId } from './basics.ts'
import { managerReportAt } from './depot-manager.ts'
import { relayForGroup } from './relay.ts'

/** Le silence au-delà duquel le manager est prévenu. */
const SILENCE_MS = 30 * 60_000

/** Un groupe dont le worker se tait : son id et la date de son dernier signal (la clé du silence). */
export type SilentWorker = { group: string; lastAt: number }

/**
 * Les groupes en vol dont le worker se tait depuis `SILENCE_MS` à `now`. Le dernier signal est celui que le relais garde
 * pour cet envoi ; sans entrée de relais, l'envoi lui-même, seulement quand une session est notée sur le lien (un worker
 * lancé sans outil flow n'écrit jamais au relais) : sans elle, le worker n'est peut-être pas lancé (demande restée dans
 * le prompt), rien ne mesure son silence. Une date hors forme, ou dans le futur, ne mesure rien. Relais absent ou
 * illisible : aucun.
 */
export const silentWorkers = (run: Run, relay: Relay | null, now: number): SilentWorker[] => {
  if (!relay || !isTime(now)) return []
  const out: SilentWorker[] = []
  for (const g of Array.isArray(run.groups) ? run.groups : []) {
    const link = g?.linked
    if (!link || typeof link !== 'object' || !isTime(link.at) || managerReportAt(link) !== undefined) continue
    const relayed = relayForGroup(relay, g, run.groups, link)
    if (relayed?.report !== undefined) continue
    const lastAt = relayed ? (isTime(relayed.last?.at) ? Math.max(relayed.at, relayed.last!.at) : relayed.at) : typeof link.session === 'string' && link.session !== '' ? link.at : Number.NaN
    if (!isTime(lastAt) || lastAt > now || now - lastAt < SILENCE_MS) continue
    out.push({ group: g.id, lastAt })
  }
  return out
}

/** La note au manager, en anglais (une consigne à Claude), la même dans les deux modes ; en auto, sans attendre. */
export const silenceNote = (silent: readonly SilentWorker[], isAuto: boolean): string => {
  const groups = silent.map(s => `group ${shownGroupId(s.group)} (last signal ${new Date(s.lastAt).toISOString().slice(11, 16)} UTC)`).join(', ')
  return `flow-board: no signal for ${SILENCE_MS / 60_000} minutes from the worker of ${groups}, and no final report in the relay. Check with ListAgents whether it still runs: if it is working, nothing to do. If it is idle, write to it by SendMessage to ask where it stands: to resume its work, or to leave its final report if its tickets are done (it may be waiting for a review to come back).${isAuto ? ' Auto mode: do it now, without waiting for the user.' : ' Then tell the user what you found.'}`
}
