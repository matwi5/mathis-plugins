// La lecture et l'écriture de la liste des cartes du projet (sa forme et la garde : `hooks/cards-list.ts`) : un fichier
// du poste à côté du fichier de coordination (à défaut `$.store`), écrit par le seul titulaire du siège, par une seule
// écriture (`writeCards`), sur le modèle de la table des numéros : le siège relu, la liste relue, le changement calculé
// sur elle et gardé (`keepsCards`), le siège relu une dernière fois, la liste relue encore et restée le texte lu, puis
// l'écriture ; les écritures d'une discussion se suivent. Les cartes ne suivent plus la discussion : la discussion qui
// reprend le siège les relit telles quelles. Hors de `register.tsx`, que le moteur ne lit plus au-delà de 1 Mio.

import { atom, read, update } from 'claude-code'

import type { Board } from '../types'
import { applyCardChange, cardsListFile, keepsCards, parseCardsList, type CardChange, type CardWriteState } from './cards-list.ts'
import { cardStateOf, hasRetro, isRetroCardDue, retroOf, sameFolder, soundCard, type LaunchCard } from './launch.ts'
import { claudeHome, coordinationName, isSettingMissing, normRoot, readMissionReport, seatForWrite } from './register.tsx'
import { retroCard, retroCardId } from './retro-coo.ts'

/** Le board de cette discussion, lu seulement (le moteur ne suit une source d'état que déclarée dans le module qui la lit). */
const boardAtom = atom({ plugin: 'flow-board', key: 'board' } as const, null as Board | null)
/**
 * L'ancien état des cartes : celles que chaque discussion du COO gardait pour elle avant la liste des cartes du projet.
 * Jamais écrit ni vidé : il reste lisible pour sa copie dans la liste (`copyOldCards`).
 */
const oldCardsAtom = atom({ plugin: 'flow-board', key: 'cooCards' } as const, [] as unknown[])
/**
 * La marque « copié » de l'ancien état (décisions A2, C5) : posée une fois, par la discussion elle-même, quand chaque
 * carte copiée se retrouve dans la liste relue ; jamais retirée, gardée à `/reload-plugins`. Posée, l'ancien état
 * n'est plus jamais recopié.
 */
const copiedAtom = atom({ plugin: 'flow-board', key: 'cooCardsCopied' } as const, false as boolean)

/** La liste des cartes d'un projet sur ce poste ; null sans dossier de Claude (`$.store` alors). */
function cardsPath($: any, root: string): string | null {
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.cartes.json` : null
}
const cardsStoreKey = (root: string): string => `coo-cards:${normRoot(root)}`

/**
 * La liste relue : lue (ses entrées, ses cartes en forme, et si une entrée hors forme est gardée, jamais montrée ni
 * effacée), absente (aucune carte ; la première écriture la crée) ou illisible (lecture ratée, texte qui n'est pas la
 * liste de ce projet : rien ne s'y écrit). Le texte relu va avec (l'écriture vérifie qu'il n'a pas changé).
 */
export type CardsRead = { state: 'read' | 'absent' | 'unread'; cards: LaunchCard[]; hasUnsound: boolean; raw: unknown[]; text?: string }

/** Une lecture sans carte, des tableaux neufs à chaque fois (rien de partagé entre deux lectures). */
const empty = () => ({ cards: [] as LaunchCard[], hasUnsound: false, raw: [] as unknown[] })

/** La liste relue au fichier (ou dans `$.store`) du projet de racine `root`. */
export async function readCardsAt($: any, root: string): Promise<CardsRead> {
  let text: string
  try {
    const path = cardsPath($, root)
    if (path) {
      // `exists` répond faux aussi sur un droit refusé : seule une absence que confirme le plus proche dossier listable
      // sous celui de Claude vaut liste vide (comme la table des numéros) ; sinon, une lecture ratée (rien n'est réécrit).
      if (!(await $.fs.exists(path))) return { state: (await isSettingMissing($, claudeHome($)!, path)) ? 'absent' : 'unread', ...empty() }
      text = String(await $.fs.read(path))
    } else {
      const raw = await $.store.get(cardsStoreKey(root))
      if (raw === undefined || raw === null) return { state: 'absent', ...empty() }
      text = JSON.stringify(raw)
    }
  } catch {
    return { state: 'unread', ...empty() }
  }
  const raw = parseCardsList(text, normRoot(root))
  if (raw === null) return { state: 'unread', ...empty(), text }
  const cards: LaunchCard[] = []
  let hasUnsound = false
  for (const c of raw) {
    const s = soundCard(c)
    if (s) cards.push(s)
    else hasUnsound = true
  }
  return { state: 'read', cards, hasUnsound, raw, text }
}

/** La seule lecture des cartes : la liste du projet de cette discussion, relue à l'instant (sans board : illisible). */
export async function readCards($: any): Promise<CardsRead> {
  const board: Board | null = await read($, boardAtom)
  return board ? readCardsAt($, board.root) : { state: 'unread', ...empty() }
}

/** Les cartes en forme de la liste (`readCards`) ; aucune quand elle ne se lit pas. */
export async function cardsHere($: any): Promise<LaunchCard[]> {
  return (await readCards($)).cards
}

/**
 * Les cartes relues telles que les lit le plan des cartes disparues (`orphanCardPlans`, qui ne voit une carte qu'en
 * forme) : une entrée hors forme gardée y compte comme une carte illisible (`null`), et le plan ne fait alors rien.
 */
export const orphanCardsOf = (got: CardsRead): unknown[] => (got.hasUnsound ? [...got.cards, null] : got.cards)

/** Ce qu'une écriture des cartes a donné (`CardWriteState`), avec les ids des cartes ajoutées, remplacées, retirées ou réécrites. */
export type CardWrite = { state: CardWriteState; changed: string[] }

/** Les écritures des cartes de cette discussion, une à la fois et dans l'ordre : chacune relit la liste que la précédente a écrite. */
let cardsChain: Promise<unknown> = Promise.resolve()
/** Met `run` à la suite des écritures des cartes de cette discussion. */
const queued = <T>(run: () => Promise<T>): Promise<T> => {
  const next = cardsChain.then(run, run)
  cardsChain = next.catch(() => undefined)
  return next
}

const no = (state: CardWriteState): CardWrite => ({ state, changed: [] })

/** L'écriture elle-même, hors de la file (`writeCards` et la copie de l'ancien état l'appellent depuis la file). */
async function writeNow($: any, change: CardChange): Promise<CardWrite> {
  const seat = await seatForWrite($)
  if (!seat.ok) return no(seat.why === 'unread' ? 'board-unread' : 'not-seat')
  const root = seat.local.root
  const got = await readCardsAt($, root)
  if (got.state === 'unread') return no('unread')
  const out = applyCardChange(got.raw, change)
  if (out === null) return no('stale')
  if (out.changed.length === 0) return no('none')
  if (!keepsCards(got.raw, out.list, new Set(out.changed))) return no('refused')
  // Le siège relu une dernière fois, puis la liste : une reprise ou une autre écriture pendant ce temps arrête tout.
  const last = await seatForWrite($)
  if (!last.ok) return no(last.why === 'unread' ? 'board-unread' : 'not-seat')
  const again = await readCardsAt($, root)
  if (again.state !== got.state || again.text !== got.text) return no('changed')
  const file = cardsListFile(normRoot(root), out.list)
  try {
    const path = cardsPath($, root)
    if (path) await $.fs.write(path, JSON.stringify(file))
    else await $.store.set(cardsStoreKey(root), file)
  } catch {
    return no('failed')
  }
  return { state: 'ok', changed: out.changed }
}

/**
 * La copie de l'ancien état dans la liste (décisions A2, C5, C6), hors de la file : rien quand il est marqué « copié » ;
 * ses cartes en forme qui ne sont dans la liste ni par leur id ni par leur dossier y sont ajoutées (la liste gagne ;
 * une entrée hors forme de l'ancien état n'est pas copiée et y reste) ; la liste relue, la marque n'est posée que si
 * chaque carte copiée s'y retrouve. Un ancien état sans carte en forme est marqué sans écriture. Rend `ok` une fois
 * marqué, sinon l'état qui l'a arrêté (siège, liste illisible ou changée, écriture ratée, marque ratée : `unmarked`) : tout se retente
 * au relevé suivant, sans doublon. L'ancien état n'est jamais écrit.
 */
async function copyNow($: any): Promise<CardWriteState> {
  try {
    if ((await read($, copiedAtom)) === true) return 'ok'
    const old = await read($, oldCardsAtom)
    const sound = (Array.isArray(old) ? old : []).map(soundCard).filter((c): c is LaunchCard => c !== null)
    if (sound.length > 0) {
      const seat = await seatForWrite($)
      if (!seat.ok) return seat.why === 'unread' ? 'board-unread' : 'not-seat'
      const got = await readCardsAt($, seat.local.root)
      if (got.state === 'unread') return 'unread'
      const ids = new Set(got.raw.map(e => (e !== null && typeof e === 'object' ? (e as { id?: unknown }).id : undefined)))
      // Ni dans la liste, ni en double dans l'ancien état lui-même (par id, puis par dossier) : la première gagne.
      const missing: LaunchCard[] = []
      for (const c of sound) if (!ids.has(c.id) && ![...got.cards, ...missing].some(k => k.id === c.id || sameFolder(k.folder, c.folder))) missing.push(c)
      if (missing.length > 0) {
        // `none` : les cartes arrivées entre-temps (une autre écriture) ; la relecture qui suit juge si elles y sont.
        const out = await writeNow($, { kind: 'add', cards: missing })
        if (out.state !== 'ok' && out.state !== 'none') return out.state
        const again = await readCardsAt($, seat.local.root)
        if (again.state !== 'read' || !missing.every(c => again.cards.some(k => k.id === c.id))) return again.state === 'unread' ? 'unread' : 'changed'
      }
    }
  } catch {
    return 'failed'
  }
  // Les cartes copiées (ou rien à copier) : seule la marque reste à poser ; ratée, l'état le dit (`unmarked`).
  try {
    await update($, copiedAtom, () => true)
    return (await read($, copiedAtom)) === true ? 'ok' : 'unmarked'
  } catch {
    return 'unmarked'
  }
}

/** La copie de l'ancien état, à son tour dans la file (en tête du relevé du titulaire) ; `ok` une fois marqué. */
function copyOldCards($: any): Promise<CardWriteState> {
  return queued(() => copyNow($))
}

/**
 * La copie gardée du dernier texte illisible de la liste, en mémoire du module : une copie par texte relu, pour cette
 * racine ; oubliée dès que la liste se relit (un même texte cassé de nouveau a sa nouvelle copie).
 */
let cardsAside: { root: string; text: string; place: string } | null = null

/**
 * La copie d'une liste illisible (décision C3), gardée à côté et jamais supprimée : une par texte relu, sur le poste
 * (`.illisible-<date>`), ou dans `$.store` sans dossier de Claude (clé `…:illisible:<date>`). Le même texte relu ne
 * fait pas de seconde copie ; une écriture ratée ne change rien d'autre (rien ne s'écrit dans la liste). Rend où elle est.
 */
async function keepCardsAside($: any, root: string, text: string): Promise<string | undefined> {
  if (cardsAside?.root === root && cardsAside.text === text) return cardsAside.place
  try {
    const now = await $.clock.now()
    const path = cardsPath($, root)
    let place = path ? `${path}.illisible-${now}` : `${cardsStoreKey(root)}:illisible:${now}`
    // Une copie d'avant à la même milliseconde (une horloge qui se répète) n'est jamais écrasée : un suffixe la contourne,
    // cent essais au plus (au-delà, la copie compte comme pas écrite).
    for (let n = 2; path ? await $.fs.exists(place) : (await $.store.get(place)) != null; n++) {
      if (n > 100) throw new Error('aside')
      place = path ? `${path}.illisible-${now}-${n}` : `${cardsStoreKey(root)}:illisible:${now}-${n}`
    }
    if (path) await $.fs.write(place, text)
    else await $.store.set(place, text)
    cardsAside = { root, text, place }
  } catch {
    cardsAsideFailed = { root, text }
    return undefined
  }
  cardsAsideFailed = null
  return cardsAside?.place
}
/** Le dernier texte illisible, pour sa racine, dont la copie n'a pas pu s'écrire (réessayée au relevé suivant). */
let cardsAsideFailed: { root: string; text: string } | null = null

/**
 * Le relevé des cartes du titulaire du siège, à chaque relevé : une liste illisible a sa copie gardée à côté (son texte,
 * quand il a pu se lire), puis l'ancien état est copié (`copyOldCards`). Rend l'état de cette copie : `ok` une fois
 * marqué, et seulement alors le relevé pose des cartes.
 */
export async function surveyCards($: any): Promise<CardWriteState> {
  // La copie « illisible » isolée : une erreur à elle n'empêche pas la copie de l'ancien état.
  try {
    const board: Board | null = await read($, boardAtom)
    if (board) {
      const got = await readCardsAt($, board.root)
      // Dans la file des écritures des cartes : deux relevés qui se chevauchent ne font pas deux copies du même texte.
      const text = got.text
      if (got.state === 'unread' && text !== undefined) await queued(() => keepCardsAside($, board.root, text))
      else if (got.state !== 'unread') cardsAside = cardsAsideFailed = null
    }
  } catch {
    // Rien : la copie se refait au relevé suivant.
  }
  return copyOldCards($)
}

/**
 * La liste illisible telle que la vue et le relevé la disent : l'endroit de la liste, et celui de sa copie gardée s'il y
 * en a une ; sans copie (`noCopy`) : `read`, la lecture a raté (aucun texte à copier) ; `write`, son écriture a raté (réessayée à
 * chaque relevé) ; `pending`, pas encore gardée (au prochain relevé du titulaire).
 */
export type CardsUnread = { path: string; aside?: string; noCopy?: 'read' | 'write' | 'pending' }

/**
 * Ce que la vue et le relevé du COO reçoivent des cartes : les cartes en forme de la liste relue ; illisible, aucune
 * carte, et l'endroit de la liste et de sa copie (celle du texte relu à l'instant, gardée par le relevé).
 */
export async function cardsCtx($: any): Promise<{ cards: LaunchCard[]; cardsUnread?: CardsUnread }> {
  const board: Board | null = await read($, boardAtom)
  if (!board) return { cards: [] }
  const got = await readCardsAt($, board.root)
  if (got.state !== 'unread') return { cards: got.cards }
  // Une lecture ratée après une copie gardée de cette liste : la copie gardée reste montrée.
  const aside = cardsAside && cardsAside.root === board.root && (got.text === undefined || cardsAside.text === got.text) ? cardsAside.place : undefined
  const noCopy = aside ? undefined : got.text === undefined ? 'read' : cardsAsideFailed?.root === board.root && cardsAsideFailed.text === got.text ? 'write' : 'pending'
  return { cards: [], cardsUnread: { path: cardsPath($, board.root) ?? cardsStoreKey(board.root), ...(aside ? { aside } : {}), ...(noCopy ? { noCopy } : {}) } }
}

/** Les cartes en forme de la liste, ou null quand elle ne se lit pas : un lecteur qui décide s'abstient alors. */
export async function cardsOrNull($: any): Promise<LaunchCard[] | null> {
  const got = await readCards($)
  return got.state === 'unread' ? null : got.cards
}

/** L'ancien état de cette discussion est-il marqué « copié » ? Tant qu'il ne l'est pas, le relevé ne pose aucune carte (D2). */
export async function isOldCopied($: any): Promise<boolean> {
  try {
    return (await read($, copiedAtom)) === true
  } catch {
    return false
  }
}

/**
 * La seule écriture des cartes, par le seul titulaire du siège : l'ancien état d'abord copié (`copyNow` ; sinon rien,
 * avec l'état qui l'a arrêté), le siège relu, la liste relue (illisible : rien), le changement calculé sur elle (sa
 * condition jugée sur les cartes relues), la garde (`keepsCards` : aucune carte non visée ne disparaît ni ne revient),
 * le siège relu une dernière fois, la liste relue encore et restée le texte lu, puis l'écriture. Rien n'est tenu pour
 * fait hors de `ok`.
 */
export function writeCards($: any, change: CardChange): Promise<CardWrite> {
  return queued(async () => {
    const copied = await copyNow($)
    return copied === 'ok' ? writeNow($, change) : no(copied)
  })
}

/**
 * Pose la carte de rétro de chaque mission livrée qui n'en a pas encore, sauf une mission qui est elle-même une rétro
 * (sa première phase est `retro`, lancée par le COO ou à la main) : pas de rétro d'une rétro, elle n'a que sa ligne
 * « livrée » et « ✓ Archiver ». Aucune autre carte ne part (plus de plafond des cartes). Rend le nombre de cartes posées.
 */
export async function offerRetros($: any, ids: readonly string[]): Promise<number> {
  const board: Board | null = await read($, boardAtom)
  if (!board) return 0
  const now = await $.clock.now()
  const fresh: LaunchCard[] = []
  for (const id of ids) {
    const run = board.runs.find(r => r.id === id)
    if (!run || run.phases[0]?.skill === 'retro' || retroOf(run) || hasRetro(board.runs, id)) continue
    const kept = await readMissionReport($, id)
    fresh.push(retroCard(run, kept && kept !== 'unread' ? kept.text : null, now))
  }
  if (fresh.length === 0) return 0
  // La carte de rétro de même id encore prête est remplacée par la neuve ; une carte en lancement ou lancée reste telle
  // quelle (sa marque de lancement n'est pas perdue) ; aucune autre carte ne part. La liste pas écrite : aucune posée.
  const out = await writeCards($, { kind: 'put', cards: fresh, keep: old => cardStateOf(old, board.runs, now).kind !== 'ready' })
  $.ui.invalidate('ui.render')
  return out.state === 'ok' ? out.changed.length : 0
}

/**
 * À chaque relevé du siège : la carte de rétro de toute mission qui y a droit (`isRetroCardDue` : close, pas archivée,
 * ni une rétro ni une mission qui a déjà la sienne), livrée ou non, quand elle manque ; une carte qui manque à la liste
 * des cartes revient ainsi seule. Une carte déjà là n'est ni doublée ni remise à neuf ; une carte déduite ne fait partir
 * aucune autre carte. Rend le nombre de cartes posées.
 */
export async function offerDueRetros($: any, board: Board): Promise<number> {
  if (!(await isOldCopied($))) return 0
  // La liste illisible : aucune carte due posée (C8), et aucun rapport relu pour rien.
  const here = await cardsOrNull($)
  if (!here) return 0
  const have = new Set(here.map(c => c.id))
  const due = board.runs.filter(r => isRetroCardDue(r, board.runs) && !have.has(retroCardId(r.id)))
  if (due.length === 0) return 0
  const now = await $.clock.now()
  const fresh: LaunchCard[] = []
  for (const run of due) {
    const kept = await readMissionReport($, run.id)
    fresh.push(retroCard(run, kept && kept !== 'unread' ? kept.text : null, now))
  }
  // Relue à l'écriture : une carte posée entre-temps (une livraison) n'est pas doublée.
  const added = (await writeCards($, { kind: 'add', cards: fresh })).changed.length
  if (added > 0) $.ui.invalidate('ui.render')
  return added
}
