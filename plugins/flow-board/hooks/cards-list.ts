// La liste des cartes d'un projet : les cartes de lancement du COO (proposées par son Claude, de rétro, « Pistes de
// rétro »), gardées sur le poste à côté du fichier de coordination, hors de toute discussion, et écrites par la seule
// discussion qui tient le siège du COO. `cards-store.ts` la lit (`readCardsAt`) et l'écrit (`writeCards`, seule écriture) ; ce module dit sa forme, le changement
// qu'une écriture fait, et la garde qui refuse une écriture qui ferait disparaître ou revenir une carte non visée.
//
// Invariant : « La liste des cartes d'un projet n'est écrite que par la discussion qui tient le siège du COO. Une
// écriture n'y fait jamais disparaître ni revenir une carte qu'elle ne visait pas, et une liste qui ne se lit pas n'est
// jamais réécrite. »

import { soundCard, type LaunchCard } from './launch.ts'

/** La version de la liste ; une autre version ne se lit pas (illisible, jamais réécrite). */
const CARDS_LIST_V = 1

/** Le fichier de la liste : sa version, la racine du projet et ses entrées, dans l'ordre de leur pose. */
export type CardsListFile = { v: typeof CARDS_LIST_V; root: string; cards: unknown[] }

/**
 * Les entrées d'une liste relue, ou null quand son texte ne se lit pas comme la liste de ce projet (pas du JSON, une
 * autre version, la racine d'un autre projet, des entrées qui ne sont pas une liste). `root` est déjà normalisée.
 */
export const parseCardsList = (text: string, root: string): unknown[] | null => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const file = raw as Record<string, unknown>
  if (file.v !== CARDS_LIST_V || file.root !== root || !Array.isArray(file.cards)) return null
  return file.cards
}

/** Le fichier écrit pour ces entrées. */
export const cardsListFile = (root: string, cards: readonly unknown[]): CardsListFile => ({ v: CARDS_LIST_V, root, cards: [...cards] })

/**
 * Un changement des cartes, avec la carte qu'il vise : `add` ajoute les cartes dont l'id n'est pas déjà là ; `put`
 * remplace la carte de même id (ou l'ajoute), à la fin, sauf une carte gardée que `keep` retient (elle reste, et la
 * nouvelle n'entre pas) ; `remove` retire les cartes en forme que `which` vise ; `set` réécrit sur place la carte en
 * forme d'id `id`. `expect`, quand il est donné, est la condition du changement, jugée sur les cartes en forme relues
 * juste avant l'écriture : fausse, rien n'est écrit (une carte lue plus tôt a changé depuis).
 */
export type CardChange = { expect?: (cards: readonly LaunchCard[]) => boolean } & (
  | { kind: 'add'; cards: readonly LaunchCard[] }
  | { kind: 'put'; cards: readonly LaunchCard[]; keep?: (old: LaunchCard) => boolean }
  | { kind: 'remove'; which: (card: LaunchCard) => boolean }
  | { kind: 'set'; id: string; card: LaunchCard }
)

/**
 * Le changement calculé sur les entrées relues, fonction pure : la liste écrite et les ids des cartes ajoutées,
 * remplacées, retirées ou réécrites ; null quand sa condition (`expect`) n'est plus vraie. Une entrée hors forme reste
 * telle quelle, à sa place.
 */
export const applyCardChange = (list: readonly unknown[], change: CardChange): { list: unknown[]; changed: string[] } | null => {
  const sound = list.map(c => soundCard(c))
  if (change.expect && !change.expect(sound.flatMap(s => (s ? [s] : [])))) return null
  if (change.kind === 'add') {
    const present = new Set(sound.map(s => s?.id))
    const fresh = change.cards.filter(c => !present.has(c.id))
    return { list: [...list, ...fresh], changed: fresh.map(c => c.id) }
  }
  if (change.kind === 'put') {
    const kept = new Set(sound.flatMap(s => (s && change.keep?.(s) ? [s.id] : [])))
    const cards = change.cards.filter(c => !kept.has(c.id))
    const ids = new Set(cards.map(c => c.id))
    return { list: [...list.filter((_, i) => !ids.has(sound[i]?.id ?? '')), ...cards], changed: cards.map(c => c.id) }
  }
  if (change.kind === 'remove') {
    const changed: string[] = []
    const out = list.filter((_, i) => {
      const s = sound[i]
      const isIt = s !== null && s !== undefined && change.which(s)
      if (isIt) changed.push(s.id)
      return !isIt
    })
    return { list: out, changed }
  }
  const isThere = sound.some(s => s?.id === change.id)
  return { list: list.map((c, i) => (sound[i]?.id === change.id ? change.card : c)), changed: isThere ? [change.id] : [] }
}

/**
 * La garde de l'invariant à l'écriture : hors des cartes visées (`targeted`, leurs ids), la liste écrite garde chaque
 * entrée de la liste relue, telle quelle (hors forme comprise) et dans le même ordre, et n'en ajoute aucune.
 */
export const keepsCards = (before: readonly unknown[], after: readonly unknown[], targeted: ReadonlySet<string>): boolean => {
  const others = (list: readonly unknown[]) =>
    list.flatMap(c => {
      const id = soundCard(c)?.id
      return id !== undefined && targeted.has(id) ? [] : [JSON.stringify(c)]
    })
  const a = others(before)
  const b = others(after)
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/**
 * Ce qu'une écriture des cartes a donné : `ok`, `none` (rien à changer), `stale` (la condition du changement n'est
 * plus vraie sur la liste relue), `not-seat` et `board-unread` (le siège), `unread` (la liste ne se lit pas),
 * `refused` (la garde), `changed` (la liste a changé entre sa relecture et l'écriture), `failed` (l'écriture a raté),
 * `unmarked` (les cartes d'avant la mise à jour copiées, mais leur marque « copié » pas posée : rien d'autre ne s'écrit).
 */
export type CardWriteState = 'ok' | 'none' | 'stale' | 'not-seat' | 'board-unread' | 'unread' | 'refused' | 'changed' | 'failed' | 'unmarked'

/** Pourquoi un clic n'a rien écrit dans la liste des cartes, pour son toast (« ◆ Rien n’est … : <raison>. »). */
export const cardWriteWhy = (state: CardWriteState): string =>
  state === 'not-seat' || state === 'board-unread'
    ? 'ce COO ne tient plus le siège, ou le fichier des missions ne se lit pas'
    : state === 'unread'
      ? 'la liste des cartes ne se lit pas'
      : state === 'failed'
        ? 'la liste des cartes ne s’écrit pas ; réessaie'
        : state === 'unmarked'
          ? 'les cartes d’avant la mise à jour ne sont pas encore marquées reprises ; réessaie dans un instant'
          : state === 'refused'
          ? 'l’écriture aurait fait partir une autre carte'
          : 'la carte a changé entre-temps ; relis-la'

/** Pourquoi une carte proposée n'est pas montrée, en anglais pour le Claude du COO (« No card shown: <raison> »). */
export const cardWriteWhyEn = (state: CardWriteState): string =>
  state === 'not-seat'
    ? 'this discussion does not hold the COO seat.'
    : state === 'board-unread'
      ? 'the missions file could not be read, so the COO seat could not be checked.'
      : state === 'unread'
        ? 'the list of cards cannot be read; nothing is shown or written in it.'
        : state === 'failed'
          ? 'the list of cards could not be written.'
          : state === 'unmarked'
            ? 'the cards from before this version are not marked as taken over yet; propose the card again in a moment.'
            : state === 'refused'
            ? 'the write would have removed another card.'
            : 'the list of cards changed meanwhile; propose the card again.'
