// La marque « discussion nommée par flow-board » : une clé de `$.store` par discussion, écrite par elle seule,
// qui retient que flow-board lui a donné son nom. Une discussion marquée n'est plus jamais nommée par
// flow-board, même par une autre mission née chez elle après la suppression ou l'élagage de la première.
//
// Invariant : « Une discussion que flow-board a nommée n'est jamais renommée par flow-board, et la marque qui le
// retient n'est jamais effacée ni réécrite avec un autre titre par flow-board. »
//
// Cycle de vie : écrite quand flow-board décide le nom (le titre en attente posé), au chargement quand le
// tableau montre une mission titrée née dans la discussion, et à la lecture du `launch` d'un appel (avant le
// rattachement, qu'il soit accepté ou refusé) quand l'enregistrement de la carte du COO porte le titre que les hooks
// ont relevé pour la discussion ; jamais réécrite si elle existe ; jamais effacée (ni
// par la suppression d'une mission, ni par « Oublier », ni par l'effacement d'une session : la clé ne suit
// aucune de leurs familles). Lue par la décision de nommer : seule une lecture réussie qui ne rend rien laisse
// nommer ; une marque présente, illisible ou hors forme garde le nom. Une écriture ratée n'est pas rattrapée.

import { clip } from './basics.ts'
import { neutralInPrompt } from './closing.ts'

/** La clé de la marque d'une discussion. Aucun balayage de clés de flow-board ne prend ce préfixe. */
export const discussionNamedKey = (session: string): string => `discussion-named:${session}`

/**
 * La discussion n'a pas de marque : vrai seulement quand la lecture a réussi et ne rend rien. Sans id, ou une
 * lecture qui lève : faux, la discussion garde son nom.
 */
export async function isUnnamed($: any, session: string): Promise<boolean> {
  return (await markState($, session)) === 'absent'
}

/** La marque lue : absente (lecture réussie, rien), présente (toute valeur, même hors forme), ou illisible (lecture qui lève). */
export async function markState($: any, session: string): Promise<'absent' | 'present' | 'unread'> {
  if (session === '') return 'unread'
  try {
    return (await $.store.get(discussionNamedKey(session))) === undefined ? 'absent' : 'present'
  } catch {
    return 'unread'
  }
}

/** Les poses de la marque de ce processus, l'une après l'autre : deux chemins qui liraient la clé absente en même temps
 * (le premier titre, le chargement, un lancement) l'écriraient deux fois, la seconde avec un autre titre. */
let markChain: Promise<void> = Promise.resolve()

/**
 * Pose la marque, le titre donné et sa date, seulement quand une lecture réussie dit qu'elle n'existe pas :
 * une marque présente (même hors forme) n'est jamais réécrite, et une lecture ou une écriture ratée ne fait rien
 * de plus (elle ne lève jamais). Les poses d'un processus passent une à une, chacune relisant la clé juste avant
 * d'écrire.
 */
export async function markNamed($: any, session: string, title: string, now: number): Promise<void> {
  await claimName($, session, title, now)
}

/**
 * Le nom décidé, revérifié dans la file des poses : vrai seulement quand une lecture réussie y trouve la clé absente
 * (la marque est alors posée, et une écriture ratée n'empêche pas le nom), ou une marque déjà là au même titre (le
 * même nom, jamais un autre) ; faux pour une marque d'un autre titre ou hors forme, posée
 * entre-temps par un autre chemin (un lancement, le chargement, un appel parallèle), ou une lecture ratée. Le titre de
 * la discussion ne s'écrit que sur un vrai : la décision prise avant la file ne suffit pas.
 */
export async function claimName($: any, session: string, title: unknown, now: number): Promise<boolean> {
  const next = markChain.then(() => writeMark($, session, title, now))
  // Une pose qui lèverait quand même ne bloque pas les suivantes.
  markChain = next.then(
    () => undefined,
    () => undefined,
  )
  try {
    return await next
  } catch {
    return false
  }
}

async function writeMark($: any, session: string, title: unknown, now: number): Promise<boolean> {
  try {
    const text = typeof title === 'string' ? clip(title.trim(), 70) : ''
    if (session === '' || text === '') return false
    const mark = await $.store.get(discussionNamedKey(session))
    // Déjà posée avec ce même titre (le chargement l'a vue, la mission déjà titrée, avant cette file) : le même nom.
    if (mark !== undefined) return mark !== null && typeof mark === 'object' && (mark as { title?: unknown }).title === text
    try {
      await $.store.set(discussionNamedKey(session), { title: text, at: now })
    } catch {
      // Non rattrapée : seule une nouvelle mission née ici après la disparition de la première pourrait la nommer, une fois.
    }
    return true
  } catch {
    return false
  }
}

/**
 * Le titre d'une carte tel que le lancement l'a posé dans le terminal (`claude --bg -n`) : sans les signes que le
 * shell ne garde pas.
 */
export const shellSafeTitle = (title: string): string =>
  title.normalize('NFC').replace(/[^\p{L}\p{N} .,:_-]/gu, ' ').replace(/\s+/g, ' ').trim() || 'Mission'

/**
 * Le titre relevé de la discussion est celui de la carte : tel quel, tel que l'app l'a reçu (`start_session`),
 * ou tel que le terminal l'a reçu (`-n`). Une simple comparaison : aucun des deux n'entre dans un chemin ni une
 * commande.
 */
export const isCardTitle = (seen: string | undefined, cardTitle: string): boolean => {
  if (seen === undefined || seen.trim() === '' || cardTitle.trim() === '') return false
  const s = seen.trim()
  return s === cardTitle.trim() || s === neutralInPrompt(cardTitle) || s === shellSafeTitle(cardTitle)
}
