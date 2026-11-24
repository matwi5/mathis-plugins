/**
 * Les discussions de managers à fermer, chez le COO : la liste n'est jamais gardée, elle se recalcule à chaque relevé
 * et à chaque appel de contrôle, du fichier des missions et des traces de fermeture du fichier de coordination
 * (spec de la mission « Fin de mission sans gestes », section « 2. Discussions à fermer »).
 */

import type { ArchivePath, Run } from '../types'
import { isTime } from './basics.ts'
import { missionSessionId } from './closing.ts'
import type { CoordEntry } from './coordination.ts'
import { archiveMarkOf } from './model.ts'

/**
 * Au plus, les discussions que nomme la section « discussions à fermer » d'un relevé ; un contrôle juge sur la liste sans
 * plafond, mais n'en reçoit que `UNMARKED_MAX` ids par appel.
 */
export const TO_CLOSE_MAX = 30

/**
 * Au plus, les discussions de missions archivées sans marque que nomme la demande unique (le constat du 13/11/2026 en
 * comptait 58 sur un poste) ; celles d'au-delà ne sont jamais proposées, et la demande dit combien.
 */
export const UNMARKED_MAX = 100

/** Une discussion à fermer : son id de session, et les missions archivées qui la désignent (id, titre brut, date et chemin de l'archivage). */
export type ToClose = { session: string; runs: { id: string; title: string; at: number; by?: ArchivePath }[] }

/** Un id de session de l'app (`local_…`) ; tout autre est lu comme celui du terminal. */
const isAppId = (id: string): boolean => id.startsWith('local_')

/**
 * Les discussions à fermer d'après le fichier des missions (`runs`) et les entrées bien formées du fichier de
 * coordination (`entries`), vues de la discussion `here` (le COO) : chaque mission archivée, pas active, qui porte une marque
 * d'archivage lisible (`archiveMarkOf` ; `unmarked` : au contraire, seulement celles qui n'en ont pas, la demande
 * unique), dont la discussion se désigne (`missionSessionId` : `bornIn` puis `owner`, un id en forme, jamais celle
 * d'ici, jamais une discussion que nomme une autre mission non archivée), de la même forme d'id qu'ici (un id `local_…`
 * seulement depuis une discussion dont l'id l'est aussi ; les ids notés sont en pratique ceux du transcript, des UUID,
 * sur les deux surfaces), et sans trace de fermeture datée de son archivage ou après (une trace d'une autre session,
 * ou datée dans le futur, ne fait que retenir). Deux missions d'une même discussion la
 * nomment une fois. Dans l'ordre du fichier, `max` au plus (`TO_CLOSE_MAX` par défaut : le texte du relevé ; un
 * contrôle, qui juge si une discussion est encore à fermer, passe `Infinity`) ; `only` : seules ces missions sont
 * retenues, avant le plafond (une mission qu'on vient d'archiver n'est jamais coupée par des discussions plus anciennes).
 */
export const discussionsToClose = (runs: readonly Run[], entries: readonly CoordEntry[], here: string, unmarked = false, only?: ReadonlySet<string>, max = TO_CLOSE_MAX): ToClose[] => {
  // Une discussion que nomme une mission pas vraiment archivée (sans date d'archivage lisible, ou archivée mais
  // redevenue active : un clic posé sur une copie qui ignorait une reprise) la tient encore : jamais listée.
  const isDone = (r: Run): boolean => isTime(r.archivedAt) && r.status !== 'active'
  const held = new Set(runs.filter(r => !isDone(r)).flatMap(r => [r.bornIn, r.owner].filter((id): id is string => typeof id === 'string')))
  const out = new Map<string, ToClose>()
  for (const run of runs) {
    if (!isDone(run) || (only !== undefined && !only.has(run.id))) continue
    const by = archiveMarkOf(run)
    if ((by === undefined) !== unmarked) continue
    const session = missionSessionId(run, runs, here)
    if (typeof session !== 'string' || held.has(session) || isAppId(session) !== isAppId(here)) continue
    const at = run.archivedAt as number
    if (entries.some(e => e.kind === 'discussion' && e.run === run.id && e.at >= at)) continue
    const one = { id: run.id, title: run.title, at, ...(by !== undefined ? { by } : {}) }
    const got = out.get(session)
    if (got) got.runs.push(one)
    else if (out.size < max) out.set(session, { session, runs: [one] })
  }
  return [...out.values()]
}

/**
 * Les discussions à fermer d'après les deux copies du fichier des missions : celle d'ici, relue et fusionnée (`local`), et
 * celle du fichier commun (`stored`, null quand il ne se relit pas : rien). Seules les missions que les deux listent pour
 * la même discussion comptent : un archivage pas encore écrit dans le fichier, ou une reprise que la copie d'ici ne voit
 * pas encore, ne fait rien fermer. La date d'archivage gardée est la plus récente des deux. `only` et `max` : comme pour
 * `discussionsToClose`.
 */
export const discussionsToCloseBoth = (local: readonly Run[], stored: readonly Run[] | null, entries: readonly CoordEntry[], here: string, unmarked = false, only?: ReadonlySet<string>, max = TO_CLOSE_MAX): ToClose[] => {
  if (stored === null) return []
  const there = new Map(discussionsToClose(stored, entries, here, unmarked, only, max).flatMap(d => d.runs.map(r => [`${d.session} ${r.id}`, r.at] as const)))
  return discussionsToClose(local, entries, here, unmarked, only, max).flatMap(d => {
    const runs = d.runs.flatMap(r => {
      const at = there.get(`${d.session} ${r.id}`)
      return at === undefined ? [] : [{ ...r, at: Math.max(at, r.at) }]
    })
    return runs.length > 0 ? [{ session: d.session, runs }] : []
  })
}

/** La fin de la demande unique (`coordinate.unmarked`) : le oui tapé de la personne, son non, ou aucune discussion encore là. */
export const UNMARKED_ANSWERS = ['yes', 'no', 'none'] as const
export type UnmarkedAnswer = (typeof UNMARKED_ANSWERS)[number]

/**
 * Deux listes de discussions à fermer réunies (celles des missions marquées et, pendant le tour du oui à la demande
 * unique, celles des missions sans marque) : une discussion que les deux nomment l'est une fois, avec les missions des
 * deux, chacune une fois.
 */
export const mergeToClose = (a: readonly ToClose[], b: readonly ToClose[]): ToClose[] => {
  const out = new Map(a.map(d => [d.session, { session: d.session, runs: [...d.runs] }]))
  for (const d of b) {
    const got = out.get(d.session)
    if (got) got.runs.push(...d.runs.filter(r => !got.runs.some(x => x.id === r.id)))
    else out.set(d.session, { session: d.session, runs: [...d.runs] })
  }
  return [...out.values()]
}
