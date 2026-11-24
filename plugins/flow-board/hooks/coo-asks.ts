// Les demandes du tableau de bord au Claude du COO qui gardent une marque contre un second clic, envoyées par le chemin
// des autres demandes de la vue Coordination (refus pendant un tour, refus hors du siège : `cooDo`, `register.tsx`) :
// le bouton « ✦ Proposer les missions » de la ligne « Au départ » (page « Vue d'ensemble »), une consigne fixe sans aucune
// valeur lue ailleurs (`PROPOSE_ASK`) ; le clic « Lancer en auto » d'une carte dont le tour d'intention
// (`travail/<dossier>/demande.md`) manque : la carte reste prête, et une demande qui ne porte que l'id et le dossier de la
// carte, à la forme contrôlée, part au COO (`intentAsk`, `isIntentMissing`).
//
// La marque « demande envoyée » tient en mémoire, dans la discussion du COO, une par demande (le bouton ; chaque
// carte, `intentKey`) : posée au clic, avant l'envoi ; levée par le début d'un tour (`liftAllAsks`), par un envoi qui
// n'est pas parti, ou une minute après le clic.
// Perdue à un rechargement du mod : un clic est de nouveau permis, ce qui ne perd rien.

import { hasIntentTurn, isCardId, isFolderName, type LaunchCard, type LaunchMode } from './launch.ts'

/** La consigne du bouton « ✦ Proposer les missions », mot pour mot : un texte fixe, qui finit par la garde du siège. */
export const PROPOSE_ASK =
  "◆ COO : propose-moi les missions à lancer. Suis la section « Proposer les missions » de tes consignes (/flow-board:coo) : relis les idées « à lancer » et les choses à reprendre « à décider » de la feuille de route, regroupe-les en cartes de lancement, range les cartes prêtes par ordre de priorité, puis dis-moi ce que tu as fait. Pour ce regroupement, ne change le statut d'aucune entrée, ne retire aucune carte et ne lance aucune mission. Si ta dernière ligne « COO seat » dit que tu ne tiens plus le siège, n’écris rien."

/** Le message montré après un clic du bouton dont la consigne est partie. */
export const PROPOSE_SENT = '◆ Demande envoyée au COO : il relit les idées et les choses à reprendre.'
/** Le message montré après un clic « Lancer en auto » dont la demande du tour d'intention est partie. */
export const INTENT_SENT = "◆ Tour d'intention demandé au COO : réponds-lui, puis reclique."

/**
 * La demande du tour d'intention d'une carte, mot pour mot ; null quand l'id ou le dossier n'ont pas leur forme : seules
 * ces deux valeurs, contrôlées, y entrent, jamais le titre de la carte.
 */
export const intentAsk = (id: string, folder: string): string | null =>
  isCardId(id) && isFolderName(folder)
    ? `◆ COO : je veux lancer en auto la carte ${id} (dossier travail/${folder}/), mais son tour d'intention manque. Retrouve-la dans ton relevé par cet id, pose-moi ses trois questions (le but, le périmètre, ce qui est hors sujet), écris mes réponses mot pour mot dans travail/${folder}/demande.md, commite ce fichier par son chemin, puis dis-moi de recliquer « Lancer en auto ». Ne lance rien toi-même. Si ta dernière ligne « COO seat » dit que tu ne tiens plus le siège, n’écris rien.`
    : null

/** La clé de la marque d'une demande du tour d'intention : une par carte. */
export const intentKey = (card: string): string => `intent:${card}`

/**
 * Un fichier existe-t-il ? null quand la question n'a pas de réponse (la lecture lève, ou ne rend ni vrai ni faux). Une
 * déclaration : elle reçoit `$`.
 */
async function existsOrNull($: any, path: string): Promise<boolean | null> {
  try {
    const found: unknown = await $.fs.exists(path)
    return found === true ? true : found === false ? false : null
  } catch {
    return null
  }
}

/**
 * Le tour d'intention d'une carte est-il absent ? Seulement quand la présence de `travail/<dossier>/demande.md` répond
 * « non » et que le dossier `travail/` du projet répond « oui » ; dans tout autre cas (racine inconnue, dossier hors
 * forme, lecture qui lève, `travail/` qui ne se voit pas), non : le clic suit le chemin d'aujourd'hui. Le chemin ne se
 * construit qu'avec un dossier à la forme contrôlée (lettres, chiffres, tirets) : il reste sous `travail/` du projet, et
 * rien n'y est écrit. Limite : `exists` répond « non » aussi sur un droit refusé ; un `demande.md` illisible pour le poste,
 * dans un `travail/` qui se voit, est tenu pour absent (la demande part, et le COO, qui voit le fichier, le dit).
 */
export async function isIntentMissing($: any, root: string, folder: string): Promise<boolean> {
  if (root === '' || !isFolderName(folder)) return false
  const work = `${root.replace(/[\\/]+$/, '')}/travail`
  if ((await existsOrNull($, `${work}/${folder}/demande.md`)) !== false) return false
  return (await existsOrNull($, work)) === true
}

/**
 * Le regard sur le tour d'intention au clic « Lancer en auto » (`launchCard`, après ses refus qui ne marquent rien) : la
 * demande à envoyer au COO quand le clic est en auto, que la carte a un tour d'intention (ni rétro ni « Pistes de
 * rétro » : `hasIntentTurn`) et qu'il est absent (`isIntentMissing`) ; null sinon : le clic suit le chemin d'aujourd'hui.
 */
export async function intentAskFor($: any, root: string, card: Pick<LaunchCard, 'id' | 'start' | 'folder' | 'of'>, mode: LaunchMode): Promise<string | null> {
  if (mode !== 'auto' || !hasIntentTurn(card)) return null
  return (await isIntentMissing($, root, card.folder)) ? intentAsk(card.id, card.folder) : null
}

/** Le message d'un second clic trop rapproché, qui ne part pas. */
const ASK_ALREADY_SENT = '◆ Demande déjà envoyée au COO.'
/** Le message d'un clic pendant un tour (celui des autres gestes de la vue). */
const TURN_OPEN = '◆ Claude travaille : reclique quand il a fini son tour.'
/** Le message d'une demande qui n'est pas partie (celui des autres demandes de la vue). */
const ASK_MISSED = '◆ La demande n’est pas partie : reclique.'

/** La durée d'une marque « demande envoyée » : une minute après le clic. */
const ASK_MARK_MS = 60_000

/** Les marques « demande envoyée », par clé de demande : l'heure du clic. */
const sentAt = new Map<string, number>()

/** Une demande de cette clé est-elle partie il y a moins d'une minute, sans qu'un tour ait commencé depuis ? */
const isAskSent = (key: string, now: number): boolean => {
  const at = sentAt.get(key)
  if (at === undefined) return false
  // Une horloge qui recule de moins d'une minute garde la marque ; d'une minute ou plus, elle la lève, comme une minute écoulée.
  if (Math.abs(now - at) >= ASK_MARK_MS) {
    sentAt.delete(key)
    return false
  }
  return true
}

/** La garde du tour de l'appelant, relue à l'instant d'envoyer : vrai pendant un tour du fil principal. */
type TurnGuard = () => boolean

/**
 * Un tour du fil principal commence : posé dès l'entrée de son `turn.start`, avant ses attentes, et retiré quand la garde
 * « Claude travaille » est posée (`liftAllAsks`) ou à la fin du tour (`noteTurnEnded`, si une écriture du début a levé).
 */
let isTurnStarting = false
export const noteTurnStarting = (): void => {
  isTurnStarting = true
}
export const noteTurnEnded = (): void => {
  isTurnStarting = false
}
/** Un tour du fil principal en train de commencer (son `turn.start` entré, la garde « Claude travaille » pas encore posée). */
export const turnStarting = (): boolean => isTurnStarting

/** Le début d'un tour lève toutes les marques, une fois la garde « Claude travaille » posée (même bloc, `register.tsx`). */
export const liftAllAsks = (): void => {
  sentAt.clear()
  isTurnStarting = false
}

/**
 * Envoie une demande au Claude du COO sous sa marque (l'appelant a vérifié que Claude est au repos et que la discussion
 * tient le siège juste avant, lui passe sa garde du tour et l'heure : rien n'attend ici avant l'envoi) : un clic pendant un tour, ou pendant son début, ne part
 * pas ; un second clic dans la minute, sans tour commencé depuis, ne part pas ; un envoi qui n'est pas parti
 * lève la marque. Rend le message à montrer. Une déclaration de fonction : le moteur ne suit `$` au-delà d'un import
 * que dans une déclaration.
 */
export async function sendMarkedAsk($: any, key: string, text: string, sent: string, isTurnOpen: TurnGuard, now: number): Promise<string> {
  // Sans attente avant l'envoi : la garde du tour (posée, ou un tour qui commence) et la marque se jugent dans le même instant.
  if (isTurnOpen() || isTurnStarting) return TURN_OPEN
  if (isAskSent(key, now)) return ASK_ALREADY_SENT
  sentAt.set(key, now)
  let isIn = false
  try {
    const r = await $.prompt.submit({ text })
    isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
  } catch {
    isIn = false
  }
  if (!isIn) {
    // Seulement la marque de ce clic : un tour commencé entre-temps l'a déjà levée.
    if (sentAt.get(key) === now) sentAt.delete(key)
    return ASK_MISSED
  }
  return sent
}
