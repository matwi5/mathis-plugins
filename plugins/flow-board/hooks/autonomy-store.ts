// La lecture et la seule écriture du fichier des cases d'autonomie d'un projet (sa forme : `autonomy-setting.ts`). Un
// fichier par projet et par poste, à côté de celui de la revue de sécurité : même dossier personnel (`securityHome`),
// même racine du dépôt principal (la même dans un worktree), sans la casse, et son propre suffixe ; aucune valeur lue
// dans un fichier n'entre dans ce chemin. Jamais `$.store`. Un seul écrivain : `setAutonomyCase`, à la file dans le
// processus. Hors de `register.tsx`, que le moteur ne lit plus au-delà de 1 Mio.

import { normRoot } from './basics.ts'
import type { CooAutonomy } from './coo.ts'
import { autonomyKeptText, autonomyRecord, parseAutonomySetting, unreadAutonomy, type AutonomyCaseId, type AutonomyCases, type AutonomyRead, type AutonomyStored } from './autonomy-setting.ts'
import { coordinationName, isSettingMissing, mainRepoRoot, securityHome } from './register.tsx'

/** La racine comme clé, sans la casse (comme celle du réglage de la revue de sécurité). */
const rootKey = (root: string): string => normRoot(root).toLowerCase()

/** Le fichier des cases d'un projet, sous `<dossier>/flow-board/coordination/`, nommé comme le réglage de la revue. */
export const autonomySettingPath = (dir: string, root: string): string => `${dir}/flow-board/coordination/${coordinationName(rootKey(root))}.autonomie.json`

/**
 * Les cases lues à l'instant, avec la racine qui les porte et leur fichier, que porte seulement une lecture qui a pu
 * lire ou dire absent ce fichier (`never`, `read`, ou `unread` hors forme) ; une lecture ratée n'a pas de fichier, ni
 * de racine quand le moteur ne la dit pas. Jamais d'écriture, jamais de valeur gardée d'un appel à l'autre ; une
 * lecture qui lève ne remonte jamais : elle vaut cinq cases décochées.
 */
export async function loadAutonomySetting($: any): Promise<AutonomyRead & { root?: string; path?: string }> {
  try {
    const root = await mainRepoRoot($)
    if (root === 'error') return unreadAutonomy('read')
    if (root === null) return unreadAutonomy('repo')
    const dir = await securityHome($)
    if (dir === null) return { ...unreadAutonomy('read'), root }
    const path = autonomySettingPath(dir, root)
    let stored: AutonomyStored
    try {
      stored = { kind: 'text', text: String(await $.fs.read(path)) }
    } catch {
      // Seule une absence que confirme la liste du dossier vaut « jamais réglé » ; sinon, une lecture ratée.
      if (!(await isSettingMissing($, dir, path))) return { ...unreadAutonomy('read'), root }
      stored = { kind: 'absent' }
    }
    return { ...parseAutonomySetting(stored, other => rootKey(other) === rootKey(root)), root, path }
  } catch {
    return unreadAutonomy('read')
  }
}

/**
 * Ce que rend un clic : `isWritten`, le fichier a été réécrit ; `read`, l'état relu après une écriture du fichier, réussie
 * ou non, ou l'état relu juste avant l'écriture quand le fichier a changé depuis la première lecture (rien d'écrit),
 * sinon celui lu avant (rien d'écrit, ou seule la copie `.illisible` tentée) ; une relecture qui lève ne rend jamais
 * cinq cases décochées que le disque ne porte pas : l'état lu avant, ou, après une écriture réussie, ce qui vient
 * d'être écrit ; `isSeatLost`, la garde a refusé juste avant
 * une écriture : le fichier n'est pas écrit.
 */
export type AutonomyWrite = { isWritten: boolean; read: AutonomyRead; isSeatLost?: true }

/** L'empreinte d'une lecture : son état, ses cases, et ses cases inconnues ou son texte hors forme. */
const readPrint = (r: AutonomyRead): string => JSON.stringify([r.state, r.cases, r.state === 'unread' ? ('text' in r ? r.text : r.why) : r.extra])

/** Les écritures des cases, une à la fois dans ce processus. */
let autonomySaveChain: Promise<unknown> = Promise.resolve()

/**
 * Le seul écrivain du fichier des cases : relit le fichier, change la seule case `id` à `to`, garde les autres (cases
 * inconnues du code comprises), réécrit le tout (version, racine, date), un seul essai, puis relit et rend l'état relu
 * (une relecture qui lève après une écriture réussie rend ce qui vient d'être écrit).
 * Une lecture qui lève (ou un projet hors git) n'écrit rien ; un texte hors forme est d'abord copié en
 * `.illisible-<date>` (jamais effacé), puis remplacé par un fichier où seule la case demandée est cochée (ou aucune) ;
 * une case déjà dans l'état visé d'un fichier en forme (ou absent) ne s'écrit pas. Avant l'écriture du fichier, il se
 * relit : changé depuis la première lecture (une écriture d'une autre discussion), rien ne s'écrit et l'état relu
 * revient. Puis `mayWrite`, le dernier geste avant chaque écriture (copie comprise), dit si cette discussion tient encore
 * le siège du COO : sinon rien n'est écrit (un seul écrivain à la fois). Ces relectures réduisent la fenêtre d'une
 * écriture croisée sans la fermer : le moteur n'offre pas d'écriture conditionnelle, et un autre processus qui a passé sa
 * garde juste avant de perdre le siège peut encore écrire entre la relecture et l'écriture.
 * Une écriture qui lève a pu écrire sa tête : l'état se relit alors. L'appelant compare `read.cases[id]` à `to` : un
 * écart (écriture ratée, autre écriture entre-temps) se dit à la personne.
 */
export function setAutonomyCase($: any, id: AutonomyCaseId, to: boolean, mayWrite: () => Promise<boolean>): Promise<AutonomyWrite> {
  const run = async (): Promise<AutonomyWrite> => {
    const loaded = await loadAutonomySetting($)
    const { root, path } = loaded
    if (root === undefined || path === undefined || (loaded.state === 'unread' && loaded.why !== 'form')) return { isWritten: false, read: loaded }
    if (loaded.state !== 'unread' && loaded.cases[id] === to) return { isWritten: false, read: loaded }
    let now: number
    try {
      now = Number(await $.clock.now())
      if (loaded.state === 'unread') {
        if (!(await mayWrite())) return { isWritten: false, read: loaded, isSeatLost: true }
        // Une copie déjà là sous ce nom (même milliseconde) n'est jamais écrasée : un suffixe la distingue.
        let aside = `${path}.illisible-${now}`
        for (let n = 2; await $.fs.exists(aside); n++) {
          if (n > 20) return { isWritten: false, read: loaded }
          aside = `${path}.illisible-${now}-${n}`
        }
        await $.fs.write(aside, loaded.text)
      }
    } catch {
      return { isWritten: false, read: loaded }
    }
    const extra = loaded.state === 'unread' ? {} : loaded.extra
    const cases = { ...loaded.cases, [id]: to }
    // Une relecture qui lève ne dit pas le disque : l'état lu avant tient lieu d'état gardé (à la décoche, « reste cochée »).
    const kept = (r: AutonomyRead): AutonomyRead => (r.state === 'unread' && r.why !== 'form' ? loaded : r)
    try {
      // Le fichier relu juste avant d'écrire : changé depuis la lecture qui a décidé des autres cases (une écriture d'une
      // autre discussion entre-temps), rien ne s'écrit, et l'état relu revient à l'appelant.
      const again = await loadAutonomySetting($)
      if (readPrint(again) !== readPrint(loaded)) return { isWritten: false, read: kept(again) }
      if (!(await mayWrite())) return { isWritten: false, read: loaded, isSeatLost: true }
      await $.fs.write(path, JSON.stringify(autonomyRecord(normRoot(root), cases, extra, now)))
    } catch {
      return { isWritten: false, read: kept(await loadAutonomySetting($)) }
    }
    // Écrit : une relecture qui lève ne dit pas le disque, qui porte ce qui vient d'être écrit (jamais un faux « non enregistré »).
    const after = await loadAutonomySetting($)
    return { isWritten: true, read: after.state === 'unread' && after.why !== 'form' ? { state: 'read', cases, extra } : after }
  }
  const next = autonomySaveChain.then(run, run)
  autonomySaveChain = next.catch(() => undefined)
  return next
}

/** La case dont « Cocher … ? » attend « Confirmer », une seule à la fois, en mémoire du module : un rechargement des plugins la fait tomber. */
let autonomyAsk: AutonomyCaseId | null = null
/**
 * Le compte des clics sur les cases et des pertes du siège : une demande ouverte ou remise par un clic pendant lequel un
 * autre clic est venu ou le siège s'est perdu ne se pose pas.
 */
let askGen = 0

/** La demande de confirmation tombe : à la perte du siège du COO (sa veille, dans `register.tsx`). */
export const dropAutonomyAsk = (): void => {
  autonomyAsk = null
  askGen += 1
}

/** Les cases relues pour la page « Réglages », avec la case dont la coche attend « Confirmer » (pas une case déjà cochée). */
export async function autonomyView($: any): Promise<CooAutonomy> {
  const read = await loadAutonomySetting($)
  const asking = autonomyAsk !== null && !read.cases[autonomyAsk] ? autonomyAsk : undefined
  return { state: read.state, cases: read.cases, ...(asking ? { asking } : {}) }
}

/** Un geste sur une case d'autonomie de la page « Réglages » (`CooDo` de `coo-view.tsx`). */
export type AutonomyDo = { kind: 'autonomy-ask' | 'autonomy-confirm' | 'autonomy-off'; case: AutonomyCaseId } | { kind: 'autonomy-cancel' }

/**
 * Le clic d'une case, appelé par `cooDo` avant ses propres gardes. Tout clic fait tomber la demande en attente, sauf un
 * clic refusé pendant un tour, qui la laisse telle quelle (« reclique quand il a fini son tour ») ; « Annuler » n'écrit
 * rien et passe sans garde. Cocher (`autonomy-ask`, puis `autonomy-confirm` de la même case) demande un tour fermé et le
 * siège, relus à chaque clic et au dernier geste avant chaque écriture ; décocher (`autonomy-off`) demande le siège seul,
 * pendant un tour comme tour fermé. `seatRefusal` rend le toast du refus de siège, ou null ; `mayWrite` relit le siège
 * juste avant l'écriture. Un état relu qui n'est pas celui visé se dit par le message « Réglage non enregistré », à
 * l'état relu ; une lecture ratée qui n'a rien laissé écrire le dit aussi, à l'état d'avant le clic (une décoche « reste
 * cochée »), puisque les cinq cases décochées qu'elle rend ne disent pas le disque.
 */
export async function autonomyClick($: any, d: AutonomyDo, isTurnOpen: () => boolean, seatRefusal: () => Promise<string | null>, mayWrite: () => Promise<boolean>): Promise<void> {
  const asked = autonomyAsk
  autonomyAsk = null
  // Ce clic : un autre clic ou une perte du siège survenus pendant ses attentes l'emportent (`askGen` a changé).
  const gen = ++askGen
  // La demande remise après un refus pendant un tour : seulement un clic sur la case demandée ou sur son « Confirmer »
  // (un clic sur une autre case la fait tomber, même refusé).
  const keep = (): void => {
    if (gen === askGen && d.kind !== 'autonomy-cancel' && d.case === asked) autonomyAsk = asked
  }
  try {
    if (d.kind === 'autonomy-cancel') return
    if (d.kind !== 'autonomy-off' && isTurnOpen()) {
      keep()
      return void $.ui.toast(TURN_OPEN)
    }
    const refusal = await seatRefusal()
    if (refusal !== null) return void $.ui.toast(refusal)
    if (d.kind === 'autonomy-ask') {
      if (gen === askGen) autonomyAsk = d.case
      return
    }
    // Un « Confirmer » ne vaut que pour la case que la demande en attente nomme (un dessin périmé n'écrit rien).
    if (d.kind === 'autonomy-confirm' && asked !== d.case) return
    const to = d.kind === 'autonomy-confirm'
    // Cocher : le tour se relit avec le siège, au dernier geste avant chaque écriture.
    const guard = to ? async () => !isTurnOpen() && (await mayWrite()) : mayWrite
    const out = await setAutonomyCase($, d.case, to, guard)
    if (out.isSeatLost && to && isTurnOpen()) {
      keep()
      return void $.ui.toast(TURN_OPEN)
    }
    if (out.isSeatLost) return void $.ui.toast(SEAT_LOST)
    const isBlind = !out.isWritten && out.read.state === 'unread' && out.read.why !== 'form'
    const now = isBlind ? !to : out.read.cases[d.case]
    if (now !== to) $.ui.toast(autonomyKeptText(d.case, now))
  } finally {
    $.ui.invalidate('ui.render')
  }
}

/** Le refus d'un clic pendant un tour de Claude, celui des autres boutons du COO. */
const TURN_OPEN = '◆ Claude travaille : reclique quand il a fini son tour.'
/** Le refus d'un clic sans le siège, celui des autres boutons du COO. */
const SEAT_LOST = '◆ Cette discussion ne tient plus le siège du COO : rien n’est fait.'

/** Les cases relues à l'instant pour l'outil `flow` : null quand elles ne se lisent pas (toutes valent alors décochées). */
export async function autonomyCasesNow($: any): Promise<AutonomyCases | null> {
  const read = await loadAutonomySetting($)
  return read.state === 'unread' ? null : read.cases
}
