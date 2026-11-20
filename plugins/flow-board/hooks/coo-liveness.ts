// Le signal de vie vu du COO (la nuit : `livenessNowOf`, lu à l'instant, et la mémoire des missions en auto
// proposées « à rouvrir »). À chaque veille du siège (5 s) et à chaque relevé du COO, le verdict de chaque mission non archivée, de statut actif, qui a un titulaire, lu par `readVerdicts` (`liveness.ts`), et gardé
// en mémoire de la discussion du COO jusqu'à la relecture suivante pour la vue Coordination et le relevé. Rien n'est
// écrit : ni fichier, ni `$.store` ; une relecture qui échoue rend « inconnu », sans garder le verdict d'avant.

import { readVerdicts } from './liveness.ts'
import type { Liveness } from './liveness.ts'
import type { Board } from '../types'

/** Les verdicts de la dernière relecture, par id de mission (seuls ceux qui ne sont pas « inconnu »). */
let verdicts = new Map<string, Liveness>()

/** Les missions dont le COO lit le verdict : non archivées, de statut actif, avec un titulaire (une chaîne non vide). */
const askedOf = (board: Board) => board.runs.filter(r => r.archivedAt === undefined && r.status === 'active' && typeof r.owner === 'string' && r.owner !== '')

/** Le verdict gardé d'une mission, « inconnu » sans relecture. */
export const livenessOf = (runId: string): Liveness => verdicts.get(runId) ?? 'unknown'

/** Les verdicts des missions de `board` lus à l'instant, sans rien garder (seuls ceux qui ne sont pas « inconnu »). */
async function readNow($: any, home: string | null, board: Board, now: number): Promise<Map<string, Liveness>> {
  const runs = askedOf(board)
  let read: Liveness[]
  try {
    read = await readVerdicts($, home, runs.map(r => ({ owner: r.owner as string, claim: r.claim })), now)
  } catch {
    read = runs.map(() => 'unknown')
  }
  const out = new Map<string, Liveness>()
  runs.forEach((r, i) => {
    if (read[i] !== 'unknown') out.set(r.id, read[i]!)
  })
  return out
}

/**
 * Le verdict de chaque mission de `board` lu à l'instant (la nuit, `nightBlocksNow`), pas la valeur gardée pour la
 * vue : pour chaque mission non archivée et pas close, celui de la discussion que la commande de réouverture
 * relancerait (`owner`, sinon `bornIn`, comme `nightReopensNow`) ; « inconnu » pour une mission que la lecture ne juge pas.
 */
export async function livenessNowOf($: any, home: string | null, board: Board, now: number): Promise<(runId: string) => Liveness> {
  const runs = board.runs
    .filter(r => r.archivedAt === undefined && r.status !== 'done')
    .map(r => ({ id: r.id, owner: typeof r.owner === 'string' && r.owner !== '' ? r.owner : typeof r.bornIn === 'string' ? r.bornIn : '', claim: r.claim }))
    .filter(r => r.owner !== '')
  let read: Liveness[]
  try {
    read = await readVerdicts($, home, runs, now)
  } catch {
    read = runs.map(() => 'unknown')
  }
  const out = new Map(runs.map((r, i) => [r.id, read[i] ?? 'unknown'] as const))
  return runId => out.get(runId) ?? 'unknown'
}

/**
 * Relit les verdicts des missions de `board` (le dossier de Claude Code `home`, celui de `claudeHome`) à l'heure `now`
 * et les garde ; vrai quand un verdict gardé a changé (la vue se redessine alors).
 */
export async function refreshLiveness($: any, home: string | null, board: Board, now: number): Promise<boolean> {
  const next = await readNow($, home, board, now)
  const isChanged = JSON.stringify([...next]) !== JSON.stringify([...verdicts])
  verdicts = next
  return isChanged
}

/**
 * Les missions en auto que ce mod du COO a proposées « à rouvrir » sur un verdict « arrêtée », par surveillance
 * (`<surveillance>:<mission>`), en mémoire de la discussion seulement : la note de la réouverture les accepte (spec § 3).
 * Perdues à un `/reload-plugins` : la note est alors refusée.
 */
const proposedHere = new Set<string>()

/** Retient les blocages « à rouvrir » d'une mission en auto (`isAuto`) que la surveillance `watch` propose. */
export const noteAutoReopens = (watch: string, blocks: readonly { mission: string; act: string; isAuto?: true }[]): void => {
  for (const b of blocks) if (b.act === 'reopen' && b.isAuto) proposedHere.add(`${watch}:${b.mission}`)
}

/** Cette mission en auto a été proposée « à rouvrir » sur « arrêtée » pendant la surveillance `watch`. */
export const isAutoReopenProposed = (watch: string, mission: string): boolean => proposedHere.has(`${watch}:${mission}`)

/** Oublie les verdicts gardés (le siège perdu, le board illisible) ; vrai quand il y en avait. */
export const clearLiveness = (): boolean => {
  const had = verdicts.size > 0
  verdicts = new Map()
  return had
}
