/**
 * Les discussions d'une mission, pour la section « Contexte et coût » du compte rendu : la ligne des faits qui donne au
 * récap de stats-board ses arguments (`--discussions <rôle>:<id>,…` et `--since`), et nomme par leur seul rôle les
 * discussions sans id utilisable, que le rapport dit « non mesurée ». Le contrat est celui de `--discussions` dans le
 * skill du récap (`stats-board:recap`) : rôle `manager`, `diagnostic` ou `worker-<id du groupe>`, id entier préféré à
 * l'id court, `--since` à la veille UTC du début.
 *
 * Invariant : une valeur lue dans le fichier de la mission ne paraît dans la ligne que si elle a la forme d'un id à
 * donner au récap (un uuid, ou 8 chiffres hexadécimaux) ou d'un id de groupe (`isGroupId`) ; toute autre valeur n'y est
 * jamais recopiée, même en partie. Ces formes (chiffres hexadécimaux, tirets, lettres et chiffres ASCII, « : » et « , »)
 * n'ont aucun signe qu'un shell POSIX interprète ; sous PowerShell, la virgule sépare des arguments : la valeur de
 * `--discussions` s'y passe entre guillemets. Rien n'est écrit.
 */

import type { Run } from '../types'
import { isTime, shownGroupId } from './basics.ts'
import { isGroupId } from './closing.ts'
import { sendsOf } from './link.ts'

/**
 * Un id de discussion entier : la forme stricte d'un uuid (`SESSION_UUID` de recap.mjs) ; le récap accepte aussi l'id
 * court (`SHORT_ID`), seulement pour un envoi de groupe ici : `DISCUSSION_ID` de recap.mjs est l'union des deux.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** L'id court d'un worker : les 8 premiers chiffres hexadécimaux de son uuid. */
const SHORT_ID = /^[0-9a-f]{8}$/i

const DAY_MS = 86_400_000

/** Une valeur relue d'un fichier partagé qui est un objet (ni `null`, ni une liste). */
const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x)

/** Un champ relu compte dès qu'il porte une valeur : seuls `undefined` et `null` valent un champ absent. */
const isPresent = (x: unknown): boolean => x !== undefined && x !== null

/**
 * L'id utilisable d'un envoi : son `closing.sessionId` en forme d'uuid quand il commence par sa `session` (ou qu'elle
 * manque), sinon sa `session` en forme d'uuid ou d'id court (D3) : un id de fermeture qui ne prolonge pas l'id noté à
 * l'envoi (une erreur de copie du manager) n'est pas pris ; aucun pour un envoi marqué `sessionClash` (toute valeur
 * relue compte), ni pour toute autre forme.
 */
const sendId = (link: Record<string, unknown>): string | null => {
  // Toute valeur relue compte, `null` et `false` compris, comme pour la fermeture (`isSessionClash` de closing.ts).
  if (link.sessionClash !== undefined) return null
  const closing = link.closing
  const session = link.session
  if (isObject(closing) && isUuid(closing.sessionId) && (typeof session !== 'string' || closing.sessionId.toLowerCase().startsWith(session.toLowerCase())))
    return closing.sessionId
  return typeof session === 'string' && (UUID.test(session) || SHORT_ID.test(session)) ? session : null
}

/** `--since` : le jour UTC de la veille du début de la mission (D2), ou rien pour un début hors forme. */
const sinceOf = (startedAt: unknown): string | null => {
  if (!isTime(startedAt) || startedAt < DAY_MS) return null
  const day = new Date(startedAt - DAY_MS).toISOString().slice(0, 10)
  // Au-delà de l'an 9999, `toISOString` rend une année signée : hors de la forme que le récap accepte.
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/**
 * La ligne des faits du compte rendu qui donne les discussions de la mission : `manager` pour `bornIn` puis `owner`
 * (une fois quand ils sont égaux ; quand le worker de diagnostic tient la mission, `owner` est le sien, et le
 * manager est alors `handoff.from`, la discussion qui la lui a passée), `worker-<id du groupe>` pour chaque envoi de
 * chaque groupe (ordre de `sendsOf`), `diagnostic` pour `handoff.by` ; puis, par leur rôle seul et leur nombre, les
 * discussions sans id utilisable.
 */
export const missionDiscussionsLine = (run: Run): string => {
  const pairs: string[] = []
  // Un couple déjà donné : le même rôle et le même id, sans la casse de l'id (deux groupes `A` et `a` restent deux rôles).
  const given = new Set<string>()
  const missing = new Map<string, number>()
  // Un id court et l'id entier qu'il commence désignent la même discussion : le récap n'en ferait qu'une ligne.
  const add = (role: string, id: string) => {
    const low = id.toLowerCase()
    if ([...given].some(key => key.startsWith(`${role}:`) && (key.slice(role.length + 1).startsWith(low) || low.startsWith(key.slice(role.length + 1))))) return
    given.add(`${role}:${low}`)
    pairs.push(`${role}:${id}`)
  }
  const miss = (role: string) => missing.set(role, (missing.get(role) ?? 0) + 1)
  const r = run as unknown as Record<string, unknown>

  const handoff = r.handoff
  // La mission tenue par le worker de diagnostic (`owner` sur lui, passage ouvert ou fermé sans que `owner` change) :
  // la discussion active est la sienne, et le manager est celle qui la lui a passée.
  const isHeld = isObject(handoff) && isPresent(handoff.by) && r.owner === handoff.by
  const managers = [r.bornIn, isHeld ? handoff.from : r.owner].filter(isPresent)
  for (const id of managers.filter((x, i) => managers.indexOf(x) === i)) {
    if (isUuid(id)) add('manager', id)
    else miss('manager')
  }

  const groups: unknown[] = Array.isArray(r.groups) ? r.groups : []
  for (const g of groups) {
    if (!isObject(g)) continue
    const role = isGroupId(g.id) ? `worker-${shownGroupId(g.id)}` : 'worker'
    for (const { link } of sendsOf(g as never)) {
      // Relu du fichier : un lien ou une entrée de `earlier` qui n'est pas un objet n'est pas un envoi.
      if (!isObject(link)) continue
      const id = role === 'worker' ? null : sendId(link)
      if (id) add(role, id)
      else miss(role)
    }
  }

  if (isObject(handoff) && isPresent(handoff.by)) {
    if (isUuid(handoff.by)) add('diagnostic', handoff.by)
    else miss('diagnostic')
  }

  const since = sinceOf(r.startedAt)
  const head = "- Discussions of the mission, for the report's « Contexte et coût » section: "
  const args =
    pairs.length > 0
      ? `recap arguments « --discussions ${pairs.join(',')}${since ? ` --since ${since}` : ''} » (copy them as they are, add no id).`
      : 'no discussion with a usable id.'
  const without =
    missing.size > 0
      ? ` Without a usable id (name each « non mesurée (sans id utilisable) » in the report): ${[...missing].map(([role, n]) => (n > 1 ? `${role} (${n})` : role)).join(', ')}.`
      : ''
  return `${head}${args}${without}`
}
