// Le siège du COO : la discussion qui coordonne les missions du projet sur ce poste (le COO,
// directeur des opérations). Un champ du fichier des missions, que chaque discussion fusionne
// (`mergeBoards`) : il n'y a qu'un titulaire à la fois, et la discussion qui l'a perdu n'écrit plus
// rien comme COO.
//
// Module pur, sans import du modèle : `model.ts` l'importe pour la fusion et pour refuser une
// mission dans la discussion du COO.
//
// Invariant : « Jamais deux discussions n'écrivent comme COO du même projet sur le même poste. Celle
// qui a perdu le siège n'écrit plus rien : ni fichier de coordination, ni feuille de route, ni
// décision relayée, ni lancement. Une consigne qu'elle a écrite reste en vigueur, et le nouveau
// titulaire la reprend telle quelle. »

import type { CooSeat } from '../types'
import { isTime } from './basics.ts'
import { isSafeId } from './closing.ts'

// Une prise du siège (`CooSeat`) : qui (`by`, l'id de la discussion), quand (`at`), vue vivante pour la
// dernière fois (`seenAt`) et, une fois libérée par son titulaire, quand (`releasedAt`). Une libération
// garde la prise qu'elle clôt : elle ne touche jamais la prise d'une autre discussion.
export type { CooSeat }

/** Un siège dont le titulaire ne s'est pas montré depuis plus longtemps est libre (comme `ORPHAN_MS`). */
export const SEAT_STALE_MS = 30 * 60 * 1000
/** Le titulaire se montre au moins aussi souvent, même sans rien écrire d'autre. */
export const SEAT_REFRESH_MS = 5 * 60 * 1000

/** Le message d'une écriture de COO refusée parce que le fichier des missions ne s'est pas lu. */
export const SEAT_UNREAD = 'Siège du COO illisible : rien n’est écrit, réessaie.'

/** La tolérance d'une date future, comme celle des missions (`clampFuture`) : au-delà, la date ne se croit pas. */
const FUTURE_MS = 60_000

/** Un siège bien formé, relu d'un fichier que d'autres discussions écrivent. */
export const isSeat = (v: unknown): v is CooSeat => {
  if (v === null || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (
    isSafeId(s.by) &&
    isTime(s.at) &&
    isTime(s.seenAt) &&
    (s.releasedAt === undefined || isTime(s.releasedAt))
  )
}

/** Un siège bien formé dont une date passe `now` de plus d'une minute (horloge recalée, fichier retouché). */
export const isSeatAhead = (v: unknown, now: number): boolean =>
  isSeat(v) && (v.at > now + FUTURE_MS || v.seenAt > now + FUTURE_MS || (v.releasedAt ?? 0) > now + FUTURE_MS)

/**
 * Le siège relu, réduit à ses champs ; rien s'il est mal formé (il ne s'applique jamais, sans être
 * effacé). Avec `now`, une date au-delà d'une minute dans le futur est ramenée à `now` : sinon le siège
 * gagnerait toute prise et ne se périmerait jamais.
 */
export const soundSeat = (v: unknown, now?: number): CooSeat | undefined => {
  if (!isSeat(v)) return undefined
  const clamp = (t: number): number => (now !== undefined && t > now + FUTURE_MS ? now : t)
  const at = clamp(v.at)
  return { by: v.by, at, seenAt: Math.max(clamp(v.seenAt), at), ...(v.releasedAt !== undefined ? { releasedAt: clamp(v.releasedAt) } : {}) }
}

/** La prise la plus récente l'emporte ; à égalité de date, l'id le plus grand, pour que toutes les discussions tranchent pareil. */
const isNewerTake = (a: CooSeat, b: CooSeat): boolean => a.at > b.at || (a.at === b.at && a.by > b.by)

/**
 * Fusion de deux copies du siège : la prise la plus récente l'emporte ; dans une même prise, la
 * libération l'emporte et `seenAt` garde le plus récent. Commutative, associative et idempotente :
 * deux discussions qui fusionnent les mêmes copies, dans n'importe quel ordre, finissent d'accord.
 */
export const mergeSeat = (a: unknown, b: unknown): CooSeat | undefined => {
  const x = soundSeat(a)
  const y = soundSeat(b)
  if (!x) return y
  if (!y) return x
  if (x.by !== y.by || x.at !== y.at) return isNewerTake(x, y) ? x : y
  const releasedAt = x.releasedAt === undefined ? y.releasedAt : y.releasedAt === undefined ? x.releasedAt : Math.min(x.releasedAt, y.releasedAt)
  return { by: x.by, at: x.at, seenAt: Math.max(x.seenAt, y.seenAt), ...(releasedAt !== undefined ? { releasedAt } : {}) }
}

/** Le titulaire du siège à `now` : personne quand il est libéré, mal formé ou abandonné depuis plus de 30 minutes. */
export const seatHolder = (seat: unknown, now: number): string | null => {
  const s = soundSeat(seat)
  if (!s || s.releasedAt !== undefined || now - s.seenAt > SEAT_STALE_MS) return null
  return s.by
}

/** Le siège vu de la discussion `session` : à elle, à une autre, ou libre. */
export const seatState = (seat: unknown, session: string | undefined, now: number): 'mine' | 'other' | 'free' => {
  const holder = seatHolder(seat, now)
  if (holder === null) return 'free'
  return session !== undefined && holder === session ? 'mine' : 'other'
}

/** Une prise neuve par la discussion `session` (« ↻ Reprendre ici », ou un siège libre). */
export const takeSeat = (session: string, now: number): CooSeat => ({ by: session, at: now, seenAt: now })

/** Le siège rafraîchi par son titulaire ; rien quand il n'est plus à elle. */
export const refreshSeat = (seat: unknown, session: string, now: number): CooSeat | null => {
  const s = soundSeat(seat)
  if (!s || seatState(s, session, now) !== 'mine') return null
  return { ...s, seenAt: Math.max(s.seenAt, now) }
}

/** Le siège libéré par son titulaire (fin de la discussion) ; rien quand il n'est plus à elle. */
export const releaseSeat = (seat: unknown, session: string, now: number): CooSeat | null => {
  const s = soundSeat(seat)
  if (!s || seatState(s, session, now) !== 'mine') return null
  return { ...s, seenAt: Math.max(s.seenAt, now), releasedAt: now }
}

/**
 * Le fichier ne porte pas la prise `seat` (une écriture croisée l'a recouverte d'une prise plus
 * ancienne) : la discussion qui la tient la réécrit, sinon les deux se croiraient titulaires.
 */
export const isSeatBehind = (fileSeat: unknown, seat: unknown): boolean => {
  const s = soundSeat(seat)
  if (!s) return false
  const f = soundSeat(fileSeat)
  return !f || f.by !== s.by || f.at !== s.at
}
