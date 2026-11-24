/**
 * La mémoire du rangement dans la discussion du COO : les choses que son Claude a déclarées remises, la tâche donnée en
 * tête de son dernier relevé, le jugement de la fin de son tour, et ce que le bloc « Projet » dit du rangement. Rien
 * n'est gardé ailleurs qu'en mémoire : un rechargement des plugins, ou une autre discussion qui prend le siège, repart
 * à vide (une chose remise est alors redonnée une fois). Ni moteur ni fichier.
 *
 * Invariant : « Une tâche n'est jamais dite faite sans une relecture réussie, à l'instant, de ce qui la prouve ; une
 * chose remise n'écrit aucune trace et reste due ; et ce jugement n'envoie aucun message et n'écrit rien de plus que ce
 * que la surveillance des boîtes écrit déjà aujourd'hui (la marque « recopiée » d'une déclaration). »
 */

import { headedStatement, headVerdict, tidyUpOf, type HeadFresh, type HeadTask, type Headed, type RangementState, type TidyUp } from './rangement.ts'
import type { CooStatement } from './coo.ts'
import { isSessionId } from './closing.ts'
import { TO_CLOSE_MAX } from './discussions.ts'

/** Les discussions (ids de session) et les missions (ids) déclarées remises. */
const postponedSessions = new Set<string>()
const postponedMissions = new Set<string>()
/** Un message tapé par la personne a demandé de lever les remises : elles se lèvent au prochain relevé bien relu. */
let isLiftAsked = false
/** La tâche donnée en tête du dernier relevé bien relu, jusqu'à son jugement ; null sans tâche. */
let head: HeadTask | null = null
/** La génération de la tête : chaque relevé en pose une nouvelle, et un jugement d'une tête plus ancienne ne change rien. */
let headGen = 0
/** Le jugement de la dernière fin de tour ; null : pas de jugement (rien en tête, ou une lecture ratée). */
let verdict: 'done' | 'not-done' | null = null
/** Ce que le bloc « Projet » dit du rangement, d'après la dernière relecture réussie, et son heure ; null avant elle. */
let tidyUp: TidyUp | null = null
let tidyUpAt = 0
/** Le siège tenu quand la mémoire s'est remplie (qui, depuis quand) : un autre siège la vide. */
let seat = ''

/**
 * Le siège du COO tel que la discussion le tient à l'instant (`by@at`) : quand il change (une autre discussion l'a pris
 * entre-temps, même si celle-ci le reprend), la mémoire repart à vide, comme après un rechargement.
 */
export const holdSeat = (key: string): void => {
  if (key === seat) return
  resetRangementMemory()
  seat = key
}

/** Note des discussions déclarées remises (ids déjà contrôlés par l'appelant) ; deux fois : sans effet de plus. */
export const postponeSessions = (ids: readonly string[]): void => {
  for (const id of ids) postponedSessions.add(id)
}

/** Note une mission dont le relevé est déclaré remis (déclaration déjà contrôlée par l'appelant). */
export const postponeMission = (id: string): void => {
  postponedMissions.add(id)
}

/**
 * Demande de lever toutes les remises : au message tapé par la personne (sa réponse attendue a pu arriver), la chose
 * remise revient en tête ; elles se lèvent au prochain relevé bien relu (une lecture ratée les garde), et le Claude du
 * COO la remet de nouveau si elle attend encore.
 */
export const liftPostponed = (): void => {
  isLiftAsked = true
}

/** Les remises du moment, telles que le calcul des tâches dues les lit. */
export const postponedNow = (): NonNullable<RangementState['postponed']> => ({ sessions: new Set(postponedSessions), missions: new Set(postponedMissions) })

/**
 * Les listes d'un relevé, telles que `headedNow` les reçoit : `toClose` porte toutes les discussions encore à fermer,
 * sans plafond (elles comptent et gardent les remises ; `headedNow` plafonne celles du texte de la tâche).
 */
export type HeadedState = Omit<RangementState, 'postponed'>

/**
 * Le relevé avec sa tête (`headedStatement`), les remises du moment passées au calcul. `isRead` : les listes viennent
 * d'une relecture réussie (fichier de coordination relu) ; alors seulement les remises demandées levées se lèvent, la
 * tête se note pour le jugement de fin de tour, les remises qui ne sont plus dues s'oublient, et le bloc « Projet » se
 * met à jour (à l'heure `at`). Une lecture ratée ne note aucune tête (la fin de ce tour ne juge rien : jamais la tête
 * d'un relevé plus ancien) et ne change rien des remises. `isClick` : un tour d'un clic ou d'une livraison, sans tâche en
 * tête (ni tête notée), le reste comme ailleurs.
 */
export const headedNow = (s: CooStatement, state: HeadedState, root: unknown, isRead: boolean, at = 0, isClick = false): Headed => {
  if (isRead && isLiftAsked) {
    postponedSessions.clear()
    postponedMissions.clear()
    isLiftAsked = false
  }
  const all = state.toClose
  // Le texte de la tâche nomme `TO_CLOSE_MAX` discussions au plus, prises après les remises et parmi celles qui se
  // ferment (id de session en forme) : ni des remises ni des ids hors forme en tête de liste ne cachent les suivantes.
  let open = 0
  const shown = all.filter(d => postponedSessions.has(d.session) || (isSessionId(d.session) && open++ < TO_CLOSE_MAX))
  const withPostponed = { ...state, toClose: shown, postponed: postponedNow() }
  const headed = headedStatement(s, withPostponed, root, isClick)
  verdict = null
  headGen += 1
  head = isRead ? headed.head : null
  if (isRead) {
    const sessions = new Set(all.map(d => d.session))
    const missions = new Set(state.toGlean.map(g => g.id))
    for (const id of [...postponedSessions]) if (!sessions.has(id)) postponedSessions.delete(id)
    for (const id of [...postponedMissions]) if (!missions.has(id)) postponedMissions.delete(id)
    tidyUp = tidyUpOf({ ...state, toClose: all, postponed: postponedNow() })
    tidyUpAt = at
  }
  return { ...headed, tidyUp: tidyUpOf({ ...state, toClose: all, postponed: postponedNow() }) }
}

/** La tête à juger à la fin d'un tour, copiée à son entrée : la tâche, sa génération, et les remises de ce moment. */
export type HeadSnapshot = { task: HeadTask; gen: number; postponed: NonNullable<RangementState['postponed']> }

/** La tête du dernier relevé bien relu, pas encore jugée, à copier avant tout `await` de la fin du tour ; null sans tête. */
export const headSnapshot = (): HeadSnapshot | null => (head === null ? null : { task: head, gen: headGen, postponed: postponedNow() })


/**
 * Le jugement de la fin du tour, sur la relecture fraîche (`fresh`), avec les remises copiées à l'entrée du tour : noté
 * en mémoire et rendu, la tête consommée (un tour suivant sans relevé bien relu ne la rejuge pas). `tidy` : « Ce qui
 * t'attend » d'après la même relecture, quand elle a réussi en entier (`tidyUpOf` sur ses listes), noté à l'heure `at`.
 * Un relevé composé entre-temps (une autre génération : un message en file) : rien n'est noté, et le jugement est null.
 */
export const judgeHead = (snap: HeadSnapshot, fresh: HeadFresh, tidy: TidyUp | null, at = 0): 'done' | 'not-done' | null => {
  if (snap.gen !== headGen) return null
  verdict = headVerdict(snap.task, fresh, snap.postponed)
  head = null
  if (tidy !== null) {
    tidyUp = tidy
    tidyUpAt = at
  }
  return verdict
}

/** Le dernier jugement de fin de tour (null : aucun). */
export const verdictNow = (): 'done' | 'not-done' | null => verdict

/** Ce que le bloc « Projet » dit du rangement ; null avant la première relecture réussie. */
export const tidyUpNow = (): TidyUp | null => tidyUp

/**
 * Ce que le bloc « Projet » montre du rangement : le compte tiré des listes que la surveillance tient à jour (`live`, relevées à
 * l'heure `liveAt` ; null quand le fichier de coordination n'est pas relu), sauf quand un relevé ou une fin de tour a
 * relu plus tard (la fin du tour arrivée avant la surveillance suivante) ; sans l'un ni l'autre, rien.
 */
export const tidyUpShown = (live: TidyUp | null, liveAt: number): TidyUp | null => (tidyUp !== null && (live === null || tidyUpAt > liveAt) ? tidyUp : live)

/** Vide la mémoire : au changement de siège, et pour les tests, qui chargent ce module une fois pour plusieurs mondes. */
export const resetRangementMemory = (): void => {
  postponedSessions.clear()
  postponedMissions.clear()
  isLiftAsked = false
  head = null
  headGen += 1
  verdict = null
  tidyUp = null
  tidyUpAt = 0
}
