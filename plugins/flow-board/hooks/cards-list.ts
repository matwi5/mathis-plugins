// La liste des cartes d'un projet : les cartes de lancement du COO (proposées par son Claude, de rétro, « Pistes de
// rétro »), gardées sur le poste à côté du fichier de coordination, hors de toute discussion, et écrites par la seule
// discussion qui tient le siège du COO. `cards-store.ts` la lit (`readCardsAt`) et l'écrit (`writeCards`, seule écriture) ; ce module dit sa forme, le changement
// qu'une écriture fait, et la garde qui refuse une écriture qui ferait disparaître ou revenir une carte non visée.
//
// Invariant : « La liste des cartes d'un projet n'est écrite que par la discussion qui tient le siège du COO. Une
// écriture n'y fait jamais disparaître ni revenir une carte qu'elle ne visait pas, et une liste qui ne se lit pas n'est
// jamais réécrite. »

import type { Run } from '../types'
import { clip } from './basics.ts'
import { asciiJson } from './closing.ts'
import { CARDS_ORDER_MAX, isCardId, isOrdinaryCard, soundCard, type LaunchCard } from './launch.ts'

/**
 * La version écrite de la liste. La version 2 (entrées et rang des cartes) se lit comme la 1 ; toute écriture écrit la
 * 2, que le mod d'avant ne lit pas, donc ne réécrit jamais (il perdrait les champs qu'il ne connaît pas). Une autre
 * version ne se lit pas (illisible, jamais réécrite). Une liste de version 1 que rien n'écrit reste telle quelle.
 */
const CARDS_LIST_V = 2
/** Les versions lues. */
const CARDS_LIST_READ: readonly unknown[] = [1, CARDS_LIST_V]

/** Le fichier écrit de la liste : sa version, la racine du projet et ses entrées, dans l'ordre de leur pose. */
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
  if (!CARDS_LIST_READ.includes(file.v) || file.root !== root || !Array.isArray(file.cards)) return null
  return file.cards
}

/** Le fichier écrit pour ces entrées. */
export const cardsListFile = (root: string, cards: readonly unknown[]): CardsListFile => ({ v: CARDS_LIST_V, root, cards: [...cards] })

/**
 * Un changement des cartes, avec la carte qu'il vise : `add` ajoute les cartes dont l'id n'est pas déjà là ; `put`
 * remplace la carte de même id (ou l'ajoute), à la fin, sauf une carte gardée que `keep` retient (elle reste, et la
 * nouvelle n'entre pas) ; `remove` retire les cartes en forme que `which` vise ; `set` réécrit sur place la carte en
 * forme d'id `id` ; `rank` (l'envoi de l'ordre du COO) donne le rang 1 à n aux cartes `ids`, dans cet ordre, retire le
 * rang de toute autre carte qui en porte un, et ne change rien d'autre. Une carte que `put` ou `set` réécrit garde le
 * rang de la carte relue à l'écriture (jamais celui de la carte lue plus tôt) : seul `rank` le change (invariant B2).
 * `expect`, quand il est donné, est la condition du changement, jugée sur les cartes en forme relues juste avant
 * l'écriture, avec les missions du siège relu (`runs`) : fausse, rien n'est écrit (une carte lue plus tôt a changé depuis).
 */
export type CardChange = { expect?: (cards: readonly LaunchCard[], runs: readonly Run[]) => boolean } & (
  | { kind: 'add'; cards: readonly LaunchCard[] }
  | { kind: 'put'; cards: readonly LaunchCard[]; keep?: (old: LaunchCard) => boolean }
  | { kind: 'remove'; which: (card: LaunchCard) => boolean }
  | { kind: 'set'; id: string; card: LaunchCard }
  | { kind: 'rank'; ids: readonly string[] }
)

/** La carte écrite à la place d'une carte relue de même id : le rang de la carte relue, et lui seul. */
const keepingRank = (card: LaunchCard, fresh: LaunchCard | null | undefined): LaunchCard => {
  const { rank: _, ...rest } = card
  return fresh?.rank !== undefined ? { ...rest, rank: fresh.rank } : rest
}

/**
 * Le changement calculé sur les entrées relues, fonction pure : la liste écrite et les ids des cartes ajoutées,
 * remplacées, retirées, réécrites ou rangées ; null quand sa condition (`expect`, jugée sur les cartes relues et les
 * missions `runs`) n'est plus vraie. Une entrée hors forme reste telle quelle, à sa place. `put` et `set` gardent le rang
 * de la carte relue (`keepingRank`) ; `rank` pose le rang 1 à n des cartes nommées et retire celui des autres cartes en
 * forme, sans rien changer d'autre (un rang hors forme d'une carte non nommée reste tel quel).
 */
export const applyCardChange = (list: readonly unknown[], change: CardChange, runs: readonly Run[] = []): { list: unknown[]; changed: string[] } | null => {
  const sound = list.map(c => soundCard(c))
  if (change.expect && !change.expect(sound.flatMap(s => (s ? [s] : [])), runs)) return null
  const freshOf = (id: string) => sound.find(s => s?.id === id)
  if (change.kind === 'add') {
    const present = new Set(sound.map(s => s?.id))
    const fresh = change.cards.filter(c => !present.has(c.id))
    return { list: [...list, ...fresh], changed: fresh.map(c => c.id) }
  }
  if (change.kind === 'put') {
    const kept = new Set(sound.flatMap(s => (s && change.keep?.(s) ? [s.id] : [])))
    const cards = change.cards.filter(c => !kept.has(c.id)).map(c => keepingRank(c, freshOf(c.id)))
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
  if (change.kind === 'rank') {
    // Sur les entrées relues telles quelles : le rang posé ou retiré, tout autre champ intact (un champ inconnu
    // compris) ; une entrée hors forme, et un rang hors forme d'une carte non nommée (il n'est pas un rang), restent tels quels.
    const changed: string[] = []
    const out = list.map((c, i) => {
      const s = sound[i]
      if (!s) return c
      const at = change.ids.indexOf(s.id)
      const raw = c as Record<string, unknown>
      if (at >= 0) {
        if (raw.rank === at + 1) return c
        changed.push(s.id)
        return { ...raw, rank: at + 1 }
      }
      if (s.rank === undefined) return c
      changed.push(s.id)
      const { rank: _, ...rest } = raw
      return rest
    })
    return { list: out, changed }
  }
  const isThere = sound.some(s => s?.id === change.id)
  return { list: list.map((c, i) => (sound[i]?.id === change.id ? keepingRank(change.card, sound[i]) : c)), changed: isThere ? [change.id] : [] }
}

/**
 * La garde propre de l'envoi de l'ordre, à l'écriture : la liste écrite a autant d'entrées que la liste relue, dans le
 * même ordre, et chacune ne diffère de sa version relue que par sa clé `rank` (rang posé, changé ou retiré).
 */
export const keepsAllButRanks = (before: readonly unknown[], after: readonly unknown[]): boolean => {
  const bare = (c: unknown) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) return JSON.stringify(c)
    const { rank: _, ...rest } = c as Record<string, unknown>
    return JSON.stringify(rest)
  }
  return before.length === after.length && before.every((c, i) => bare(c) === bare(after[i]))
}

/**
 * L'ordre que le COO envoie (`raw`), contrôlé sur les cartes relues (`cards`, en forme) : les ids, ou la raison du refus
 * de tout l'envoi, qui nomme chaque id en cause (pas une liste ; vide ou de plus de `CARDS_ORDER_MAX` ids ; un id hors
 * forme ou répété ; une carte absente ; une carte de rétro ou « Pistes de rétro » ; une carte lancée, dite par `isLaunched`).
 */
export const parseCardsOrder = (raw: unknown, cards: readonly LaunchCard[], isLaunched: (card: LaunchCard) => boolean): { ids: string[] } | { refused: string } => {
  if (!Array.isArray(raw)) return { refused: '"order" must be the list of the ids of the ready launch cards, most important first' }
  if (raw.length === 0) return { refused: '"order" is empty: name the ready launch cards, most important first' }
  if (raw.length > CARDS_ORDER_MAX) return { refused: `"order" takes ${CARDS_ORDER_MAX} ids at most; this one has ${raw.length}` }
  // Chaque cause nomme un id déjà neutre : un id en forme (`isCardId`), ou la valeur hors forme passée par `asciiJson`.
  const causes: string[] = []
  raw.forEach((id, i) => {
    if (!isCardId(id)) return void causes.push(`${clip(asciiJson(id), 40)} is not a card id`)
    if (raw.indexOf(id) !== i) return void causes.push(`${id} is repeated`)
    const card = cards.find(c => c.id === id)
    if (!card) return void causes.push(`${id} is not a card of the list`)
    if (!isOrdinaryCard(card)) return void causes.push(`${id} is a retro or « Pistes de rétro » card, which has no rank`)
    if (isLaunched(card)) causes.push(`${id} is already launched`)
  })
  return causes.length > 0 ? { refused: `${[...new Set(causes)].join('; ')}. Nothing is written` } : { ids: raw as string[] }
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

/**
 * Pourquoi un envoi de l'ordre n'a rien écrit, en anglais pour le Claude du COO (« Nothing is written: <raison> ») : le
 * geste dit est de renvoyer l'ordre, jamais une carte ; les autres raisons sont celles d'une pose.
 */
export const orderWriteWhyEn = (state: CardWriteState): string =>
  state === 'unmarked'
    ? 'the cards from before this version are not marked as taken over yet; send the order again in a moment.'
    : state === 'refused'
      ? 'the write would have changed more than the ranks of the cards.'
      : state === 'changed'
        ? 'the list of cards changed meanwhile; send the order again.'
        : cardWriteWhyEn(state)

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
