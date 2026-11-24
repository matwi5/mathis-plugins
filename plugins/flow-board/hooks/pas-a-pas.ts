/**
 * Le pas à pas du rangement dans la discussion du COO : une tâche envoyée dans un message, jugée à la fin du tour qui
 * suit son envoi sur une relecture fraîche, la suivante ensuite ; une tâche pas faite est renvoyée une fois, avec ce qui
 * manque, puis le pas à pas s'arrête. Deux usages : le clic « ✓ Archiver » (les seules fermetures) et l'étape
 * « rangement » d'une livraison (tout ce qui est dû). Une machine d'états pure, et sa mémoire : rien n'est gardé ailleurs
 * qu'en mémoire (un rechargement des plugins la vide). Ni moteur ni fichier.
 *
 * Invariant : « Un message de tâche ne part que de la discussion qui tient le siège du COO, Claude au repos, hors d'une
 * compaction, un seul pas à pas à la fois ; aucun effet n'est noté avant un envoi entré dans la session ; et le pas à pas
 * ne ferme ni n'archive rien lui-même, et n'enregistre pas son propre état : il envoie un texte et relit des fichiers. »
 * Le siège, le repos et le verrou se vérifient chez l'appelant (`register.tsx`) en tête de chaque pas, et le repos et la
 * compaction de nouveau juste avant l'envoi (sinon `sendCancelled`) ; ce module tient le reste : un seul pas à pas
 * (`armStepper`), aucun envoi pendant une compaction (`compactionStarted`, `isCompacting`), rien de compté avant un
 * envoi entré (`sendResult`).
 */

import { TO_CLOSE_MAX } from './discussions.ts'
import type { Run } from '../types'
import { clip } from './basics.ts'
import { neutralLine } from './closing.ts'
import { isDeliveryOver, isReportShipped } from './model.ts'
import { boxLots, headVerdict, type Due, type DueTask, type HeadFresh, type HeadTask, type RangementState } from './rangement.ts'
import type { RoadmapEntry, RoadmapSeen } from './roadmap.ts'

/** Ce qui a armé le pas à pas : un clic d'archivage (les fermetures seules) ou l'étape « rangement » d'une livraison. */
export type StepSource = 'archive' | 'delivery'

/** Ce qu'une tâche envoyée donne à faire, par ids : ce que la fin du tour relit. */
export type StepTask = HeadTask | { kind: 'decisions'; keys: string[] } | { kind: 'jalons' }

/** La clé d'une décision montrée : sa mission, sa source et son texte ; la tâche des décisions juge les siennes seules. */
export const decisionKey = (d: { mission: string; ref: string; text: string }): string => `${d.mission}|${d.ref}|${d.text}`

/** La tâche que le calcul des tâches dues donne à envoyer : ce qu'elle donne, son texte, son libellé pour la carte. */
export type StepPick = { task: StepTask; text: string; label: string }

/**
 * Où en est le pas à pas : `pick`, au repos, la tâche suivante à choisir (ou `task` à renvoyer) ; `sending`, l'envoi en
 * cours (aucun autre ne part) ; `sent`, le message entré, son tour attendu ; `ended`, le tour fini, à juger ; `stopped`,
 * arrêté (`why`) ; `done`, plus rien de dû.
 */
export type StepPhase = 'pick' | 'sending' | 'sent' | 'ended' | 'stopped' | 'done'

export type Stepper = {
  source: StepSource
  /** Ce qui l'a armé : l'id de la livraison, ou « archive » pour un clic d'archivage. */
  owner: string
  /** Le siège du COO tenu quand il a été armé (`by@at`) : un autre siège le désarme. */
  seat: string
  phase: StepPhase
  /** La tâche envoyée (ou à renvoyer), et son libellé. */
  task: StepTask | null
  label: string
  /** Les essais de cette tâche : les tours finis sans qu'elle soit faite (un tour interrompu compte). */
  tries: number
  /** Les envois refusés de suite par le moteur, qui ne comptent pas comme des essais. */
  refusals: number
  /** Ce qui manquait au dernier jugement, redit au renvoi. */
  missing: string | null
  /** Les essais et ce qui manquait des tâches pas faites laissées pour une autre (une décision arrivée entre-temps) : repris quand elles reviennent. */
  kept: { task: StepTask; tries: number; missing: string | null }[]
  /** Un tour fini pendant l'envoi (avant que son résultat revienne) : interrompu ou non. */
  endedEarly: boolean | null
  /** L'heure du dernier envoi : un message entré dont aucun tour ne vient se juge passé `SENT_IDLE_MS` au repos. */
  sentAt: number
  /** Le premier jugement sans relecture de la tâche en cours : passé `SENT_IDLE_MS`, l'arrêt. */
  unreadSince: number | null
  /** Les missions relevées dans ce pas à pas, pour « relevé de « M » (2 sur 7) ». */
  gleaned: number
  /** Le début de l'attente des clôtures (livraison), null hors d'elle. */
  waitFrom: number | null
  /** Pourquoi il s'est arrêté, ou ce qui reste (choses remises, missions à relever) quand il a fini. */
  why: string
}

/** Les essais d'une tâche avant l'arrêt : envoyée, puis renvoyée une fois. */
const STEP_TRIES = 2
/** Les envois refusés de suite avant l'arrêt. */
const STEP_REFUSALS = 3
/** L'attente des clôtures d'une livraison, une fois les autres tâches faites. */
export const CLOSE_WAIT_MS = 120_000
/** Un message entré sans tour qui le suive (retiré de la file, jamais lancé) : jugé, comme un tour interrompu, passé ce délai au repos. */
export const SENT_IDLE_MS = 120_000
/** Une compaction dont la fin n'est jamais vue ne retient pas le pas à pas au-delà. */
export const COMPACTION_MAX_MS = 600_000

/** Un message soumis dont le tour n'a pas encore commencé ne retient pas le pas à pas au-delà (retiré, jamais lancé). */
export const PROMPT_PENDING_MS = 60_000

let stepper: Stepper | null = null
let compactingSince: number | null = null
let promptSince: number | null = null

/** Le pas à pas armé, ou null. */
export const stepperNow = (): Stepper | null => stepper

/**
 * Arme le pas à pas : quand aucun ne l'est (un seul à la fois : un second clic d'archivage, ou un clic pendant le
 * rangement d'une livraison, même arrêté, laisse celui qui tourne, dont la liste se recalcule à chaque pas), ou pour le
 * rangement d'une livraison à la place d'un pas à pas de clic (ses fermetures en font partie ; un message du clic en
 * route est repris, attendu et jugé avant toute autre tâche). Rend vrai s'il l'a armé.
 */
export const armStepper = (source: StepSource, owner: string, seat: string): boolean => {
  // Le rangement d'une livraison prend la place d'un pas à pas de clic, jamais l'inverse.
  const isTaken = source === 'delivery' && stepper?.source === 'archive'
  // Un clic ne prend jamais la place du rangement d'une livraison, même arrêté (son issue n'est pas encore rendue).
  if (source === 'archive' && stepper?.source === 'delivery') return false
  if (stepper !== null && stepper.phase !== 'stopped' && stepper.phase !== 'done' && !isTaken) return false
  // Un message du clic en route (envoi, tour attendu, jugement) : le rangement le reprend tel quel, sans rien envoyer avant
  // que ce tour soit jugé (sa tâche des fermetures fait partie du rangement), au lieu d'en envoyer un second.
  if (isTaken && stepper !== null && (stepper.phase === 'sending' || stepper.phase === 'sent' || stepper.phase === 'ended')) {
    stepper = { ...stepper, source, owner }
    return true
  }
  stepper = { source, owner, seat, phase: 'pick', task: null, label: '', tries: 0, refusals: 0, missing: null, kept: [], endedEarly: null, sentAt: 0, unreadSince: null, gleaned: 0, waitFrom: null, why: '' }
  return true
}

/** Désarme : un message de la personne, la sortie sans ranger, un siège perdu, une issue rendue. */
export const disarmStepper = (): void => {
  stepper = null
}

/** Le début d'une compaction du moteur (fil principal), à l'heure `at` ; null : sa fin. */
export const compactionStarted = (at: number | null): void => {
  compactingSince = at
}

/**
 * Un message du fil principal entré dans le hook `prompt.submit` à l'heure `at` (un tour qui va commencer : Claude n'est
 * plus au repos) ; null : son tour a commencé, ou il n'est pas parti.
 */
export const promptEntered = (at: number | null): void => {
  promptSince = at
}

/** Un message soumis dont le tour n'a pas encore commencé, à l'heure `now` (depuis moins de `PROMPT_PENDING_MS`). */
export const isPromptPending = (now: number): boolean => promptSince !== null && now - promptSince < PROMPT_PENDING_MS

/** Arrête le pas à pas en le disant (une tâche due dont le texte ne se compose pas) : son issue se rend au pas suivant. */
export const stopStepper = (why: string): void => {
  if (stepper !== null) stop(stepper, why)
}

/** Une compaction en cours à l'heure `now` (sa fin pas encore vue, depuis moins de `COMPACTION_MAX_MS`). */
export const isCompacting = (now: number): boolean => compactingSince !== null && now - compactingSince < COMPACTION_MAX_MS

/** Deux tâches sont la même quand elles ont la même nature et, pour un relevé, la même mission. */
const sameTask = (a: StepTask, b: StepTask): boolean => a.kind === b.kind && (a.kind !== 'glean' || (b.kind === 'glean' && a.mission === b.mission))

/** Ce que l'appelant fait au repos. */
export type StepAction = { kind: 'wait' } | { kind: 'judge' } | { kind: 'send'; text: string } | { kind: 'done'; why: string } | { kind: 'stop'; why: string }

/** Le texte d'un renvoi : ce qui manque, puis la tâche entière. */
export const resendText = (text: string, missing: string): string => `Not done yet after the previous message (what is missing, in French: ${missing}). Do it now, as follows.\n${text}`

/**
 * Au repos (siège, repos et verrou vérifiés par l'appelant) : ce qu'il faut faire. `pick` : la première tâche due (null :
 * rien) ; `waiting` : les missions de la livraison dont la clôture est attendue (titres) ; `done` : ce que l'issue nomme
 * (choses remises). Envoyer note l'envoi en cours, rien d'autre : aucun essai n'est compté avant le résultat de l'envoi.
 */
export const stepAt = (pick: StepPick | null, waiting: readonly string[], left: string, now: number): StepAction => {
  const s = stepper
  if (s === null) return { kind: 'wait' }
  if (s.phase === 'stopped') return { kind: 'stop', why: s.why }
  if (s.phase === 'ended') return { kind: 'judge' }
  // Appelé au repos seulement : un message entré dont le tour ne vient pas ne retient pas le pas à pas.
  if (s.phase === 'sent' && now - s.sentAt >= SENT_IDLE_MS) {
    s.phase = 'ended'
    return { kind: 'judge' }
  }
  if (s.phase !== 'pick') return { kind: 'wait' }
  if (pick === null) {
    if (waiting.length > 0) {
      s.waitFrom ??= now
      if (now - s.waitFrom < CLOSE_WAIT_MS) return { kind: 'wait' }
    }
    s.phase = 'done'
    s.why = [left, waiting.length > 0 ? `restent à relever : ${waiting.join(', ')}` : ''].filter(x => x !== '').join(' ; ')
    return { kind: 'done', why: s.why }
  }
  s.waitFrom = null
  const isAgain = s.task !== null && sameTask(s.task, pick.task)
  if (!isAgain) {
    // La tâche laissée garde ses essais ; celle qui revient reprend les siens (jamais remis à zéro par une autre passée devant).
    const left = s.task
    if (left !== null && (s.tries > 0 || s.missing !== null)) s.kept = [...s.kept.filter(k => !sameTask(k.task, left)), { task: left, tries: s.tries, missing: s.missing }]
    const back = s.kept.find(k => sameTask(k.task, pick.task))
    s.kept = s.kept.filter(k => k !== back)
    s.tries = back?.tries ?? 0
    s.missing = back?.missing ?? null
  }
  s.task = pick.task
  s.label = pick.label
  s.phase = 'sending'
  s.endedEarly = null
  s.sentAt = now
  return { kind: 'send', text: s.missing !== null ? resendText(pick.text, s.missing) : pick.text }
}

/**
 * Le résultat de l'envoi : entré, le tour attendu (déjà fini pendant l'envoi : à juger) ; refusé, réessayé au repos sans
 * compter comme un essai, et arrêté au `STEP_REFUSALS`e refus de suite, comme une tâche pas faite.
 */
export const sendResult = (isIn: boolean): void => {
  const s = stepper
  if (s === null || s.phase !== 'sending') return
  if (isIn) {
    s.refusals = 0
    s.phase = s.endedEarly === null ? 'sent' : 'ended'
    return
  }
  s.refusals += 1
  s.phase = 'pick'
  if (s.refusals >= STEP_REFUSALS) stop(s, `tâche « ${s.label} » : message refusé ${s.refusals} fois`)
}

/** L'envoi choisi n'est pas parti (Claude n'était plus au repos, ou une compaction a commencé) : à refaire au repos, sans rien compter. */
export const sendCancelled = (): void => {
  if (stepper?.phase === 'sending') stepper.phase = 'pick'
}

const stop = (s: Stepper, why: string): void => {
  s.phase = 'stopped'
  s.why = why
}

/** La fin d'un tour du fil principal : celui du message entré (ou fini pendant son envoi) est à juger. */
export const turnEnded = (isAborted: boolean): void => {
  const s = stepper
  if (s === null) return
  if (s.phase === 'sending') s.endedEarly = isAborted
  else if (s.phase === 'sent') s.phase = 'ended'
}

/** Ce qu'une relecture fraîche donne pour juger une tâche envoyée : `HeadFresh`, les décisions encore à voir, la preuve des « Jalons » ; null : pas relu. */
export type StepFresh = HeadFresh & { decisions: number | null; jalons: boolean | null }

/** Le jugement d'une tâche envoyée, sur la relecture fraîche ; null quand ce qui la prouve ne s'est pas relu. */
export const stepVerdict = (task: StepTask, fresh: StepFresh, postponed: Pick<NonNullable<RangementState['postponed']>, 'sessions' | 'missions'> = {}): 'done' | 'not-done' | null => {
  if (task.kind === 'decisions') return fresh.decisions === null ? null : fresh.decisions > 0 ? 'not-done' : 'done'
  if (task.kind === 'jalons') return fresh.jalons === null ? null : fresh.jalons ? 'done' : 'not-done'
  return headVerdict(task, fresh, postponed)
}

/**
 * Ce qui manque encore d'une tâche pas faite, en français : dit au Claude du COO au renvoi, et à la personne dans le
 * toast d'un arrêt. Des comptes et des ids contrôlés, jamais un texte relu ; une discussion remise n'en est pas.
 */
export const stepMissing = (task: StepTask, fresh: StepFresh, postponed: Pick<NonNullable<RangementState['postponed']>, 'sessions'> = {}): string => {
  switch (task.kind) {
    case 'boxes':
      return `${task.decls.filter(id => fresh.toCopy?.has(id) === true).length} déclaration(s) du lot pas encore recopiée(s)`
    case 'close':
      return `discussion(s) encore à fermer : ${task.sessions.filter(id => fresh.toClose?.has(id) === true && postponed.sessions?.has(id) !== true).join(', ')}`
    case 'glean':
      return 'la mission n’est déclarée ni relevée ni remise'
    case 'decisions':
      return `${fresh.decisions ?? 0} décision(s) pas marquée(s) vue(s)`
    case 'jalons':
      return 'aucune entrée de « Jalons » neuve ou changée depuis le début de la livraison'
  }
}

/**
 * Le jugement de la fin du tour, noté : `null` (pas relu) laisse la tâche à juger au repos, sans compter, au plus
 * `SENT_IDLE_MS` depuis le premier (à l'heure `now`), puis arrête en le disant ; faite, la suivante viendra (un relevé
 * compté) ; pas faite, renvoyée une fois avec ce qui manque, puis arrêt.
 */
export const judged = (verdict: 'done' | 'not-done' | null, missing: string, now?: number): void => {
  const s = stepper
  if (s === null || s.phase !== 'ended') return
  if (verdict === null) {
    if (now === undefined) return
    s.unreadSince ??= now
    if (now - s.unreadSince >= SENT_IDLE_MS) stop(s, `tâche « ${s.label} » : ce qui la prouve ne se relit pas`)
    return
  }
  s.unreadSince = null
  if (verdict === 'done') {
    if (s.task?.kind === 'glean') s.gleaned += 1
    s.task = null
    s.label = ''
    s.tries = 0
    s.missing = null
    s.phase = 'pick'
    return
  }
  s.tries += 1
  s.missing = missing
  if (s.tries >= STEP_TRIES) return stop(s, `tâche « ${s.label} » pas faite : ${missing}`)
  s.phase = 'pick'
}

/** Une liste de titres pour un détail ou un toast : chacun cité sur une ligne, coupé court. */
const titled = (list: readonly { title: string }[]): string => list.map(p => `« ${neutralLine(clip(p.title, 60))} »`).join(', ')

/**
 * Ce que nomme le détail de l'étape « rangement » faite : les choses remises, les missions dont le compte rendu ne se
 * lit pas ; vide quand il n'y en a pas.
 */
export const dueLeft = (due: Pick<Due, 'postponed' | 'unreadReports'>): string =>
  [due.postponed.length > 0 ? `remis : ${titled(due.postponed)}` : '', due.unreadReports.length > 0 ? `compte rendu illisible : ${titled(due.unreadReports)}` : ''].filter(x => x !== '').join(' ; ')

/**
 * Les missions d'une livraison pas encore closes (titres cités) : l'étape « rangement » attend leur clôture, bornée.
 * Une mission reprise ou relancée depuis (son rapport livré n'est plus celui qu'elle porte) ne sera pas close comme
 * livrée : rien n'attend pour elle, comme le rattrapage des clôtures.
 */
export const deliveryWaiting = (runs: readonly Run[], missions: readonly { id: string; title: string; validatedAt: number }[]): string[] =>
  missions.filter(m => runs.some(r => r.id === m.id && r.status !== 'done' && r.archivedAt === undefined && isReportShipped(r, m.validatedAt) && !isDeliveryOver(r))).map(m => titled([m]))

/**
 * La preuve de la ligne « Jalons » : une entrée de la section « Jalons » dont la ligne a été vue pour la première fois,
 * ou a changé, depuis le début de la livraison (`startedAt`), d'après l'état gardé de la feuille de route (`seen`) et sa
 * lecture du moment ; rien n'est écrit.
 */
export const jalonsProven = (entries: readonly RoadmapEntry[], seen: RoadmapSeen, startedAt: number): boolean =>
  entries.some(e => e.section === 'Jalons' && (seen[e.id] === undefined || seen[e.id]!.line !== e.line || seen[e.id]!.seenAt >= startedAt))

/**
 * La tâche due telle que le pas à pas l'envoie : des fermetures, les discussions des missions archivées le plus
 * récemment d'abord (celles d'un clic d'archivage passent devant celles qui attendaient), `TO_CLOSE_MAX` au plus, comme
 * le texte de la tête ; les suivantes viennent dans la tâche d'après, une fois celles-ci fermées.
 */
export const stepDue = (t: DueTask): DueTask => {
  if (t.kind !== 'close') return t
  const latest = (d: (typeof t.list)[number]) => d.runs.reduce((m, r) => (r.at > m ? r.at : m), 0)
  return { ...t, list: [...t.list].sort((a, b) => latest(b) - latest(a)).slice(0, TO_CLOSE_MAX) }
}

/** Ce que donne une tâche due, par ids, telle que son texte la donne (le premier lot de déclarations). */
export const stepTaskOf = (t: DueTask, roadmapRead: readonly RoadmapEntry[] | null): StepTask => {
  switch (t.kind) {
    case 'boxes':
      return { kind: 'boxes', decls: (boxLots(t.items, roadmapRead)[0] ?? []).map(d => d.id) }
    case 'close':
      return { kind: 'close', sessions: t.list.map(d => d.session) }
    case 'glean':
      return { kind: 'glean', mission: t.mission.id }
    case 'decisions':
      return { kind: 'decisions', keys: t.decisions.items.map(decisionKey) }
    case 'jalons':
      return { kind: 'jalons' }
  }
}

/** Le libellé d'une tâche sur la carte, en français ; un relevé dit son rang : « relevé de « M » (2 sur 7) ». */
export const stepLabel = (task: StepTask, title: string, rank: number, total: number): string => {
  switch (task.kind) {
    case 'boxes':
      return 'boîtes'
    case 'decisions':
      return 'décisions'
    case 'jalons':
      return 'jalon'
    case 'close':
      return 'fermetures'
    case 'glean':
      return `relevé de « ${title} » (${rank} sur ${total})`
  }
}
