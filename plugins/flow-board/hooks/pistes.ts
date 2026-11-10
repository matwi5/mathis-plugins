// La liste d'attente des rétros d'un projet : les pistes de toutes ses rétros, écrites par le seul mod de la
// discussion qui tient le siège du COO. Une rétro dépose ses opérations dans sa propre boîte, et la mission
// « Pistes de rétro » les transitions d'état de ses pistes, un fichier par discussion ; le mod du COO les applique une fois chacune et
// note leur id dans la liste, dans la même écriture que leur effet (jamais l'une sans l'autre) ; la
// discussion déposante retire alors de sa boîte ce qui est noté, et seulement cela.
//
// Module pur, sans import du modèle.
//
// Invariant de la liste d'attente : « Une écriture d'une rétro ou du COO n'efface ni ne change jamais en silence la
// piste d'une autre ; une piste ne quitte jamais le fichier, et une piste en exécution ne change plus. »
// D'où : une modification garde l'ancien texte (et ses fichiers) dans l'historique de la piste, avec son
// auteur et sa date ; « écarter » change l'état, ne retire rien ; une piste relue hors forme est gardée
// telle quelle et aucune opération ne la touche ; une écriture qui ferait disparaître une piste, un texte de
// son historique ou un commentaire est refusée (`keepsPistes`).

import { clip, isTime } from './basics.ts'
import { isGroupId, isSafeId } from './closing.ts'

/** Les états d'une piste, par leur code gardé ; leur libellé est `PISTE_STATE_FR`. */
const PISTE_STATES = ['pending', 'validated', 'dropped', 'ticket', 'running', 'done'] as const
export type PisteState = (typeof PISTE_STATES)[number]

/** Le libellé d'un état, tel que la spec le nomme (« écartée » prend sa raison, « en ticket » sa mission et son groupe). */
export const PISTE_STATE_FR: Record<PisteState, string> = {
  pending: 'pas encore validée',
  validated: 'validée',
  dropped: 'écartée',
  ticket: 'en ticket',
  running: 'en exécution',
  done: 'faite',
}

/** Un état où la piste ne change plus de texte, de fichiers ni de commentaires. */
const isFrozen = (state: PisteState): boolean => state === 'running' || state === 'done'

/** Un texte précédent d'une piste : le texte et les fichiers d'avant une modification, son auteur et sa date. */
export type PisteText = { text: string; files: string[]; by: string; at: number }
/** Un commentaire, son auteur et sa date. */
export type PisteNote = { text: string; by: string; at: number }

/**
 * Une piste : son id stable `<id de la rétro>/<id de la piste>`, la rétro d'où elle vient, son texte, ses
 * fichiers, son état (et la raison d'un écart, la mission et le groupe d'une piste en ticket, la carte qui
 * l'emporte), qui l'a ajoutée et quand, ses textes précédents et ses commentaires.
 */
export type Piste = {
  id: string
  retro: string
  text: string
  files: string[]
  state: PisteState
  reason?: string
  mission?: string
  group?: string
  card?: string
  /** Qui a changé l'état pour la dernière fois (un écart, une transition), et quand : un changement d'état n'est jamais muet. */
  stateBy?: string
  stateAt?: number
  by: string
  at: number
  history: PisteText[]
  comments: PisteNote[]
}

/** Ce que garde un refus récent : l'opération, la piste visée, l'auteur, la raison et la date. */
export type PisteRefusal = { op: string; piste: string; by: string; why: string; at: number }

/** La liste telle qu'écrite : ses pistes (même celles qu'aucune version ne sait lire), les opérations appliquées, les refus récents. */
export type Waitlist = { v: 1; root: string; pistes: unknown[]; applied: string[]; refused: PisteRefusal[] }

const PISTE_TEXT_MAX = 2000
const PISTE_NOTE_MAX = 1000
const PISTE_REASON_MAX = 300
const PISTE_FILE_MAX = 200
const PISTE_FILES_MAX = 20
export const PISTE_COMMENTS_MAX = 50
export const PISTE_HISTORY_MAX = 50
/** Au-delà, plus aucune piste ne s'ajoute (comme le fichier de coordination) ; rien n'est retiré. */
export const PISTES_MAX = 2000
/** Au-delà, plus aucune opération ne s'applique : elles attendent dans leur boîte, jamais une marque évincée. */
export const APPLIED_MAX = 4000
/** Les refus récents gardés pour le relevé du COO. */
const REFUSED_MAX = 50
/** Une boîte refuse une nouvelle opération au-delà (rien n'en sort sans être appliqué). */
export const PISTE_BOX_MAX = 200

/** L'auteur gardé d'une écriture du Claude du COO. */
export const COO_AUTHOR = 'coo'

/** Un id de piste : l'id de sa rétro (une mission), « / », l'id de la piste dans la rétro (forme d'un id de groupe). */
export const isPisteId = (v: unknown): v is string => {
  if (typeof v !== 'string') return false
  const cut = v.indexOf('/')
  return cut > 0 && isSafeId(v.slice(0, cut)) && isGroupId(v.slice(cut + 1))
}

/** La rétro d'un id de piste. */
const retroOfPiste = (id: string): string => id.slice(0, id.indexOf('/'))

/** Un auteur gardé : le COO, ou l'id d'une mission. */
const isAuthor = (v: unknown): v is string => v === COO_AUTHOR || isSafeId(v)

const isState = (v: unknown): v is PisteState => (PISTE_STATES as readonly unknown[]).includes(v)

const isFiles = (v: unknown): v is string[] => Array.isArray(v) && v.length <= PISTE_FILES_MAX && v.every(f => typeof f === 'string' && f.trim() !== '' && f.length <= PISTE_FILE_MAX)

const soundText = (v: unknown): PisteText | null => {
  const x = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  if (!x || typeof x.text !== 'string' || x.text.length > PISTE_TEXT_MAX || !isFiles(x.files) || !isAuthor(x.by) || !isTime(x.at)) return null
  return { text: x.text, files: [...x.files], by: x.by, at: x.at }
}

const soundNote = (v: unknown): PisteNote | null => {
  const x = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  if (!x || typeof x.text !== 'string' || x.text.trim() === '' || x.text.length > PISTE_NOTE_MAX || !isAuthor(x.by) || !isTime(x.at)) return null
  return { text: x.text, by: x.by, at: x.at }
}

/** Une piste relue, réduite à ses champs ; null quand elle est mal formée (gardée telle quelle, jamais touchée). */
export const soundPiste = (raw: unknown): Piste | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (!isPisteId(x.id) || x.retro !== retroOfPiste(x.id) || typeof x.text !== 'string' || x.text.trim() === '' || x.text.length > PISTE_TEXT_MAX) return null
  if (!isFiles(x.files) || !isState(x.state) || !isAuthor(x.by) || !isTime(x.at) || !Array.isArray(x.history) || !Array.isArray(x.comments)) return null
  if (x.history.length > PISTE_HISTORY_MAX || x.comments.length > PISTE_COMMENTS_MAX) return null
  const history = x.history.map(soundText)
  const comments = x.comments.map(soundNote)
  if (history.some(h => h === null) || comments.some(c => c === null)) return null
  if (x.reason !== undefined && (typeof x.reason !== 'string' || x.reason.length > PISTE_REASON_MAX)) return null
  if (x.state === 'dropped' && (typeof x.reason !== 'string' || x.reason.trim() === '')) return null
  if (x.mission !== undefined && !isSafeId(x.mission)) return null
  if (x.group !== undefined && !isGroupId(x.group)) return null
  if (x.card !== undefined && !isSafeId(x.card)) return null
  if ((x.stateBy !== undefined && !isAuthor(x.stateBy)) || (x.stateAt !== undefined && !isTime(x.stateAt))) return null
  // En ticket, la piste a sa mission (son groupe une fois les groupes déclarés) ; en exécution, les deux.
  if ((x.state === 'ticket' && x.mission === undefined) || (x.state === 'running' && (x.mission === undefined || x.group === undefined))) return null
  return {
    id: x.id,
    retro: x.retro as string,
    text: x.text,
    files: [...x.files],
    state: x.state,
    ...(typeof x.reason === 'string' ? { reason: x.reason } : {}),
    ...(x.mission !== undefined ? { mission: x.mission as string } : {}),
    ...(x.group !== undefined ? { group: x.group as string } : {}),
    ...(x.card !== undefined ? { card: x.card as string } : {}),
    by: x.by,
    at: x.at,
    history: history as PisteText[],
    comments: comments as PisteNote[],
    ...(x.stateBy !== undefined ? { stateBy: x.stateBy as string } : {}),
    ...(x.stateAt !== undefined ? { stateAt: x.stateAt as number } : {}),
  }
}

/** L'id d'une piste relue, même hors forme (pour qu'aucune opération ne crée un doublon d'une piste qu'on ne sait pas lire). */
const rawId = (raw: unknown): string | undefined => {
  const id = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).id : undefined
  return typeof id === 'string' ? id : undefined
}

const soundRefusal = (v: unknown): PisteRefusal | null => {
  const x = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  if (!x || typeof x.op !== 'string' || typeof x.piste !== 'string' || typeof x.by !== 'string' || typeof x.why !== 'string' || !isTime(x.at)) return null
  return { op: x.op, piste: x.piste, by: x.by, why: x.why, at: x.at }
}

/** La liste relue : absente (rien de déposé encore), illisible (rien ne s'y écrit), ou lue. */
export type WaitlistRead = { state: 'absent' } | { state: 'unread' } | { state: 'read'; list: Waitlist }

/** Lit le texte de la liste pour le projet `root` ; illisible dès que sa forme d'ensemble n'est pas la sienne. */
export const parseWaitlist = (text: string, root: string): WaitlistRead => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'unread' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'unread' }
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || x.root !== root || !Array.isArray(x.pistes) || !Array.isArray(x.applied) || !x.applied.every(a => typeof a === 'string')) return { state: 'unread' }
  const refused = Array.isArray(x.refused) ? x.refused.flatMap(r => soundRefusal(r) ?? []) : []
  // Une clé qu'une version plus récente aurait ajoutée au fichier reste telle quelle à la réécriture.
  return { state: 'read', list: { ...x, v: 1, root, pistes: x.pistes, applied: x.applied as string[], refused } as Waitlist }
}

/** Une liste vide, la première écriture d'un projet. */
export const emptyWaitlist = (root: string): Waitlist => ({ v: 1, root, pistes: [], applied: [], refused: [] })

/** La liste commitée dans le projet, quand la personne l'a choisi : son chemin fixe sous la racine du projet. */
export const WAITLIST_REPO_FILE = 'travail/pistes-retros.json'
/** La racine que porte la liste commitée, la même sur chaque poste : le chemin d'un poste n'entre pas dans le dépôt. */
export const WAITLIST_REPO_ROOT = '.'
/** Où vit la liste : dans le projet, sur ce poste, ou pas encore choisi (sur ce poste alors). */
export type WaitlistWhere = 'repo' | 'poste' | 'unasked'

/**
 * Vrai quand `big` porte chaque piste de `small` telle quelle (hors forme comprises) et chacune de ses marques :
 * passer de `small` à `big` ne perd rien ni ne fait rejouer une opération déjà appliquée.
 */
export const holdsWaitlist = (big: Waitlist, small: Waitlist): boolean => {
  const there = new Set(big.pistes.map(p => JSON.stringify(p)))
  const marks = new Set(big.applied)
  return small.pistes.every(p => there.has(JSON.stringify(p))) && small.applied.every(m => marks.has(m))
}

/** Les pistes lisibles de la liste, dans son ordre. */
export const pistesOf = (list: Waitlist): Piste[] => list.pistes.flatMap(raw => soundPiste(raw) ?? [])

/** Une piste choisie au clic du découpage : son id, et le nombre de ses textes précédents tel que la vue l'a montré. */
export type PistePick = { id: string; texts: number }

/**
 * Le découpage chez le COO (clic « ✂ Découper la sélection ») : chaque piste choisie, relue lisible, « pas encore
 * validée » et avec autant de textes précédents qu'à l'affichage (le texte vu est encore le sien), passe « validée »
 * avec la carte `card`, l'écriture signée du COO ; les autres sont refusées avec leur raison et ne changent pas.
 */
export const validatePistes = (list: Waitlist, picks: readonly PistePick[], card: string, now: number): { list: Waitlist; accepted: string[]; refused: { id: string; why: string }[] } => {
  const accepted: string[] = []
  const refused: { id: string; why: string }[] = []
  let pistes = list.pistes
  for (const pick of picks) {
    const at = pistes.findIndex(raw => rawId(raw) === pick.id)
    const raw = at >= 0 ? pistes[at] : undefined
    const piste = raw === undefined ? null : soundPiste(raw)
    if (!piste) refused.push({ id: pick.id, why: raw === undefined ? 'absente de la liste' : 'illisible dans la liste' })
    else if (piste.state !== 'pending') refused.push({ id: pick.id, why: `devenue « ${PISTE_STATE_FR[piste.state]} »` })
    else if (piste.history.length !== pick.texts) refused.push({ id: pick.id, why: 'son texte a changé depuis l’affichage' })
    else {
      const { mission: _m, group: _g, reason: _r, ...rest } = raw as Record<string, unknown>
      pistes = pistes.map((p, i) => (i === at ? { ...rest, state: 'validated', card, stateBy: COO_AUTHOR, stateAt: now } : p))
      accepted.push(pick.id)
    }
  }
  return { list: accepted.length > 0 ? { ...list, pistes } : list, accepted, refused }
}

/**
 * La carte `card` retirée : ses pistes lisibles encore « validée » qui la portent redeviennent « pas encore validée »,
 * sans carte, l'écriture signée du COO ; une piste qui a avancé (en ticket, en exécution, faite) ou écartée ne change pas.
 */
export const releaseCardPistes = (list: Waitlist, card: string, now: number): { list: Waitlist; released: string[] } => {
  const released: string[] = []
  const pistes = list.pistes.map(raw => {
    const piste = soundPiste(raw)
    if (!piste || piste.state !== 'validated' || piste.card !== card) return raw
    released.push(piste.id)
    const { card: _c, mission: _m, group: _g, ...rest } = raw as Record<string, unknown>
    return { ...rest, state: 'pending', stateBy: COO_AUTHOR, stateAt: now }
  })
  return { list: released.length > 0 ? { ...list, pistes } : list, released }
}

// ─── Les opérations ───────────────────────────────────────────────────────

/** Les opérations qu'une rétro ou le COO dépose. */
const PISTE_OPS = ['add', 'edit', 'comment', 'drop'] as const
export type PisteOpKind = (typeof PISTE_OPS)[number]

/**
 * Une opération d'une boîte : son id (tiré au hasard), son genre, la piste visée, son auteur déclaré (`by` :
 * la mission qui la dépose, ou `COO_AUTHOR` ; l'appelant le vérifie contre la boîte, jamais cru sur parole),
 * sa date ; le texte et les fichiers d'un ajout ou d'une modification, le texte d'un commentaire, la raison
 * d'un écart ; d'une transition (`state`, déposée par le mod d'une mission « Pistes de rétro », jamais par
 * l'outil), l'état visé et le groupe (la mission est l'auteur).
 */
export type PisteOp = { id: string; op: PisteOpKind | 'state'; piste: string; by: string; at: number; text?: string; files?: string[]; reason?: string; state?: PisteMoveState; mission?: string; group?: string }

/**
 * Les états qu'une mission « Pistes de rétro » pose sur ses pistes (opération `state`, déposée par son mod,
 * jamais par un texte d'agent), et ceux d'où chacun peut venir : en ticket depuis validée (un ticket la nomme),
 * depuis en ticket (son groupe change) ou en exécution (son groupe revient, le ticket ouvert ou retiré, ou le
 * ticket passe dans un autre groupe) ; en exécution
 * depuis en ticket (son groupe part) ; faite depuis en ticket ou en exécution (son ticket est fait) ; validée
 * depuis en ticket (le ticket est retiré du lot). Rien ne repart d'écartée ni de faite.
 */
const STATE_MOVES = {
  validated: ['ticket'],
  ticket: ['validated', 'ticket', 'running'],
  running: ['ticket'],
  done: ['ticket', 'running'],
} as const satisfies Record<string, readonly PisteState[]>
export type PisteMoveState = keyof typeof STATE_MOVES
const isMoveState = (v: unknown): v is PisteMoveState => typeof v === 'string' && Object.hasOwn(STATE_MOVES, v)

/** L'id d'une opération : `o` puis 6 à 24 lettres minuscules ou chiffres. */
const isPisteOpId = (v: unknown): v is string => typeof v === 'string' && /^o[a-z0-9]{6,24}$/.test(v)

/** Un id neuf, d'après la date et un tirage (`rand` dans [0, 1)). */
export const newPisteOpId = (now: number, rand: number): string =>
  `o${Math.max(0, Math.floor(now)).toString(36)}${Math.floor(Math.min(Math.max(rand, 0), 0.999999) * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`.slice(0, 25)

/** Une opération relue, réduite à ses champs ; null quand elle est hors forme (ignorée, sans rien changer). */
export const soundPisteOp = (raw: unknown): PisteOp | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (!isPisteOpId(x.id) || !(x.op === 'state' || (PISTE_OPS as readonly unknown[]).includes(x.op)) || !isPisteId(x.piste) || !isAuthor(x.by) || !isTime(x.at)) return null
  if (x.op === 'state') {
    // Une transition : son état, et la mission et le groupe qu'elle pose ; jamais de texte.
    if (!isMoveState(x.state) || !isSafeId(x.by) || (x.mission !== undefined && !isSafeId(x.mission)) || (x.group !== undefined && !isGroupId(x.group))) return null
    if (x.text !== undefined || x.files !== undefined || x.reason !== undefined) return null
    return { id: x.id, op: 'state', piste: x.piste, by: x.by, at: x.at, state: x.state, ...(x.mission !== undefined ? { mission: x.mission as string } : {}), ...(x.group !== undefined ? { group: x.group as string } : {}) }
  }
  if (x.text !== undefined && (typeof x.text !== 'string' || x.text.trim() === '' || x.text.length > PISTE_TEXT_MAX)) return null
  if (x.files !== undefined && !isFiles(x.files)) return null
  if (x.reason !== undefined && (typeof x.reason !== 'string' || x.reason.trim() === '' || x.reason.length > PISTE_REASON_MAX)) return null
  const op = x.op as PisteOpKind
  if ((op === 'add' || op === 'comment') && x.text === undefined) return null
  if (op === 'edit' && x.text === undefined && x.files === undefined) return null
  if (op === 'drop' && x.reason === undefined) return null
  if (op === 'comment' && (x.text as string).length > PISTE_NOTE_MAX) return null
  return {
    id: x.id,
    op,
    piste: x.piste,
    by: x.by,
    at: x.at,
    ...(x.text !== undefined ? { text: x.text as string } : {}),
    ...(x.files !== undefined ? { files: [...(x.files as string[])] } : {}),
    ...(x.reason !== undefined ? { reason: x.reason as string } : {}),
  }
}

/** Ce qu'une opération demande, sans son id ni sa mission : ce que l'outil `flow` reçoit, contrôlé. */
export type PisteChange = { op: PisteOpKind; piste: string; text?: string; files?: string[]; reason?: string }

/**
 * Le changement demandé par un appel de l'outil, contrôlé et borné : textes coupés à leur longueur, blancs
 * resserrés aux bouts ; une raison de refus lisible sinon (rien ne part).
 */
export const parsePisteChange = (raw: unknown): PisteChange | { why: string } => {
  const x = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!x) return { why: 'not an object {"op", "piste", …}' }
  if (!(PISTE_OPS as readonly unknown[]).includes(x.op)) return { why: `"op" must be one of ${PISTE_OPS.join(', ')}` }
  const op = x.op as PisteOpKind
  if (!isPisteId(x.piste)) return { why: '"piste" must be "<retro mission id>/<piste id>"' }
  const text = typeof x.text === 'string' && x.text.trim() !== '' ? clip(x.text.trim(), op === 'comment' ? PISTE_NOTE_MAX : PISTE_TEXT_MAX) : undefined
  const reason = typeof x.reason === 'string' && x.reason.trim() !== '' ? clip(x.reason.trim().replace(/\s+/g, ' '), PISTE_REASON_MAX) : undefined
  let files: string[] | undefined
  if (x.files !== undefined) {
    if (!Array.isArray(x.files) || !x.files.every(f => typeof f === 'string')) return { why: '"files" must be a list of paths' }
    const list = [...new Set((x.files as string[]).map(f => f.trim()).filter(f => f !== ''))]
    if (list.length > PISTE_FILES_MAX) return { why: `${list.length} files, ${PISTE_FILES_MAX} at most` }
    if (list.some(f => f.length > PISTE_FILE_MAX)) return { why: `a path longer than ${PISTE_FILE_MAX} characters` }
    files = list
  }
  if ((op === 'add' || op === 'comment') && text === undefined) return { why: `"${op}" needs a "text"` }
  if (op === 'edit' && text === undefined && files === undefined) return { why: '"edit" needs a "text" or "files"' }
  if (op === 'drop' && reason === undefined) return { why: '"drop" needs a "reason"' }
  return { op, piste: x.piste, ...(text !== undefined ? { text } : {}), ...(files !== undefined ? { files } : {}), ...(reason !== undefined ? { reason } : {}) }
}

/** Le résultat d'une opération : appliquée, sans effet (rien ne change), ou refusée et pourquoi. */
export type PisteOutcome = { kind: 'applied' } | { kind: 'none' } | { kind: 'refused'; why: string }

const sameFiles = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((f, i) => f === b[i])

/**
 * Applique un changement d'un auteur (`by` : l'id de la mission déposante, ou `COO_AUTHOR`) à la liste, sans
 * la modifier : rend la nouvelle liste (la même quand rien ne change) et le résultat. Un ajout se fait sous
 * le préfixe de la rétro qui l'écrit seulement ; un ajout d'un id déjà présent est une modification. Une
 * modification garde l'ancien texte et ses fichiers dans l'historique. Un écart ne vaut que pour une piste
 * « pas encore validée » ou « validée ». Une piste en exécution ou faite refuse texte, fichiers, commentaire et
 * écart ; une piste relue hors forme refuse tout. Chaque changement s'écrit par-dessus la piste relue : un
 * champ qu'une version plus récente aurait ajouté reste.
 */
export const applyPisteChange = (list: Waitlist, change: PisteChange, by: string, now: number): { list: Waitlist; outcome: PisteOutcome } => {
  const refuse = (why: string) => ({ list, outcome: { kind: 'refused', why } as PisteOutcome })
  const at = list.pistes.findIndex(raw => rawId(raw) === change.piste)
  const raw = at >= 0 ? list.pistes[at] : undefined
  const piste = raw === undefined ? null : soundPiste(raw)
  if (raw !== undefined && piste === null) return refuse('this piste is kept unreadable in the list: nothing touches it')
  const put = (next: Record<string, unknown>) => ({ list: { ...list, pistes: list.pistes.map((p, i) => (i === at ? next : p)) }, outcome: { kind: 'applied' } as PisteOutcome })
  if (piste === null) {
    if (change.op !== 'add') return refuse('no such piste in the list')
    if (by === COO_AUTHOR || retroOfPiste(change.piste) !== by) return refuse('a piste is added only by its own retro')
    if (list.pistes.length >= PISTES_MAX) return refuse(`the list holds ${PISTES_MAX} pistes: nothing more is added`)
    const fresh: Piste = { id: change.piste, retro: retroOfPiste(change.piste), text: change.text!, files: change.files ?? [], state: 'pending', by, at: now, history: [], comments: [] }
    return { list: { ...list, pistes: [...list.pistes, fresh] }, outcome: { kind: 'applied' } }
  }
  const base = raw as Record<string, unknown>
  if (isFrozen(piste.state)) return refuse(`the piste is « ${PISTE_STATE_FR[piste.state]} »: it no longer changes`)
  if (change.op === 'add' || change.op === 'edit') {
    const text = change.text ?? piste.text
    const files = change.files ?? piste.files
    if (text === piste.text && sameFiles(files, piste.files)) return { list, outcome: { kind: 'none' } }
    if (piste.history.length >= PISTE_HISTORY_MAX) return refuse(`the piste already has ${PISTE_HISTORY_MAX} earlier texts: nothing more is changed`)
    return put({ ...base, text, files, history: [...piste.history, { text: piste.text, files: piste.files, by, at: now }] })
  }
  if (change.op === 'comment') {
    if (piste.comments.length >= PISTE_COMMENTS_MAX) return refuse(`the piste already has ${PISTE_COMMENTS_MAX} comments`)
    return put({ ...base, comments: [...piste.comments, { text: change.text!, by, at: now }] })
  }
  if (piste.state === 'dropped') return piste.reason === change.reason ? { list, outcome: { kind: 'none' } } : refuse('the piste is already dropped')
  if (piste.state !== 'pending' && piste.state !== 'validated') return refuse(`a piste « ${PISTE_STATE_FR[piste.state]} » is not dropped`)
  return put({ ...base, state: 'dropped', reason: change.reason!, stateBy: by, stateAt: now })
}

/**
 * Une opération déposée, avec la boîte qui la porte et l'auteur que l'appelant a vérifié contre elle (null :
 * la boîte ne prouve pas l'auteur déclaré).
 */
export type BoxedOp = { op: PisteOp; session: string; by: string | null; gone?: true; card?: string }

/**
 * Une transition d'état posée par la mission `by`, dont le lancement vivant porte la carte `card` : seulement sur
 * une piste lisible qui porte cette carte, d'aucune autre mission, et d'un état d'où la transition est permise ;
 * en ticket et en exécution, la mission et le groupe se posent ; revenue à validée, ils partent. La même
 * transition renvoyée (même état, même mission, même groupe) est sans effet. Qui l'a faite et quand restent.
 */
export const applyPisteState = (list: Waitlist, move: { piste: string; state: PisteMoveState; group?: string }, by: string, card: string | undefined, now: number): { list: Waitlist; outcome: PisteOutcome } => {
  const refuse = (why: string) => ({ list, outcome: { kind: 'refused', why } as PisteOutcome })
  const at = list.pistes.findIndex(raw => rawId(raw) === move.piste)
  const raw = at >= 0 ? list.pistes[at] : undefined
  const piste = raw === undefined ? null : soundPiste(raw)
  if (!piste) return refuse(raw === undefined ? 'no such piste in the list' : 'this piste is kept unreadable in the list: nothing touches it')
  if (card === undefined || piste.card !== card) return refuse('the piste is not carried by the launch card of this mission')
  if (piste.mission !== undefined && piste.mission !== by) return refuse('the piste is already in a ticket of another mission')
  if (move.state === 'running' && move.group === undefined) return refuse('a piste « en exécution » needs its group')
  const isSame = piste.state === move.state && (move.state === 'validated' || (piste.mission === by && piste.group === move.group))
  if (isSame) return { list, outcome: { kind: 'none' } }
  if (!(STATE_MOVES[move.state] as readonly PisteState[]).includes(piste.state)) return refuse(`a piste « ${PISTE_STATE_FR[piste.state]} » does not become « ${PISTE_STATE_FR[move.state]} »`)
  const { mission: _m, group: _g, ...rest } = raw as Record<string, unknown>
  const next = move.state === 'validated' ? { ...rest, state: 'validated' } : { ...rest, state: move.state, mission: by, ...(move.group !== undefined ? { group: move.group } : {}) }
  return { list: { ...list, pistes: list.pistes.map((p, i) => (i === at ? { ...next, stateBy: by, stateAt: now } : p)) }, outcome: { kind: 'applied' } }
}

/** La marque d'une opération appliquée : la session de sa boîte et son id (deux boîtes ne se masquent jamais l'une l'autre). */
export const opMark = (session: string, id: string): string => `${session}/${id}`

/** Une date future (horloge recalée, boîte retouchée) ne passe jamais devant les autres. */
const FUTURE_MS = 60_000
const orderAt = (op: PisteOp, now: number): number => (op.at > now + FUTURE_MS ? now : op.at)

/** La longueur en octets UTF-8 d'un texte (celle du fichier écrit, pas le nombre d'unités UTF-16). */
export const utf8Length = (text: string): number => {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/** La taille en octets au-delà de laquelle la liste refuse ce qui la grossit : le moteur ne lit pas un fichier de plus de 4 Mio. */
const WAITLIST_BYTES_MAX = 3 * 1024 * 1024

/**
 * Applique, dans l'ordre de leur date (une date future ramenée à maintenant), puis de leur session et de leur
 * id, les opérations déposées dont la marque n'est pas encore dans la liste ; chacune est marquée dans la
 * même liste que son effet, qu'elle ait été appliquée, sans effet ou refusée (un refus est gardé parmi les
 * refus récents). Une opération sans auteur prouvé attend dans sa boîte, sans marque (une mission reprise
 * ailleurs le prouve de nouveau à son retour). Une opération sur une piste absente attend,
 * sans marque, tant qu'une boîte ne s'est pas relue (`isWhole` faux : son ajout y est peut-être). Une
 * opération qui ferait dépasser `WAITLIST_BYTES_MAX` est refusée. À la borne des marques, plus rien ne
 * s'applique : les opérations restantes attendent dans leur boîte. Rend la liste et les résultats, par marque.
 */
export const applyBoxedOps = (list: Waitlist, ops: readonly BoxedOp[], now: number, isWhole = true): { list: Waitlist; outcomes: Map<string, PisteOutcome> } => {
  const outcomes = new Map<string, PisteOutcome>()
  const done = new Set(list.applied)
  const key = (o: BoxedOp) => opMark(o.session, o.op.id)
  const todo = [...ops].filter(o => !done.has(key(o))).sort((a, b) => orderAt(a.op, now) - orderAt(b.op, now) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  let out = list
  for (const boxed of todo) {
    const { op, by } = boxed
    const mark = key(boxed)
    if (done.has(mark)) continue
    if (out.applied.length >= APPLIED_MAX) break
    if (!isWhole && op.op !== 'add' && !out.pistes.some(raw => rawId(raw) === op.piste)) continue
    const change: PisteChange = { op: op.op === 'state' ? 'edit' : op.op, piste: op.piste, ...(op.text !== undefined ? { text: op.text } : {}), ...(op.files !== undefined ? { files: op.files } : {}), ...(op.reason !== undefined ? { reason: op.reason } : {}) }
    // Sans auteur prouvé, l'opération attend dans sa boîte, sans marque : jamais appliquée, jamais perdue ; sauf celle
    // d'une mission supprimée, qui ne reviendra pas : refusée et marquée, sa boîte s'en vide.
    if (by === null && !boxed.gone) continue
    // La date gardée (ajout, historique, commentaire, écart) est celle du dépôt, ramenée à maintenant si elle est future.
    let result =
      by === null
        ? { list: out, outcome: { kind: 'refused', why: 'its mission was deleted' } as PisteOutcome }
        : op.op === 'state'
          ? applyPisteState(out, { piste: op.piste, state: op.state!, ...(op.group !== undefined ? { group: op.group } : {}) }, by, boxed.card, orderAt(op, now))
          : applyPisteChange(out, change, by, orderAt(op, now))
    if (result.outcome.kind === 'applied' && utf8Length(JSON.stringify(result.list)) > WAITLIST_BYTES_MAX) result = { list: out, outcome: { kind: 'refused', why: 'the list is full (its size): nothing more grows it' } }
    out = { ...result.list, applied: [...result.list.applied, mark] }
    if (result.outcome.kind === 'refused') out = { ...out, refused: [...out.refused, { op: mark, piste: op.piste, by: by ?? op.by, why: result.outcome.why, at: now }].slice(-REFUSED_MAX) }
    done.add(mark)
    outcomes.set(mark, result.outcome)
  }
  return { list: out, outcomes }
}

/**
 * Les ids de pistes déjà vus (gardés par le COO) qui manquent à une liste relue : une écriture par-dessus les
 * perdrait. L'appelant n'écrit rien sur une telle liste, la met de côté et le dit.
 */
export const missingSeen = (list: Waitlist, seen: readonly string[]): string[] => {
  const ids = new Set(list.pistes.map(rawId))
  return seen.filter(id => !ids.has(id))
}

/** Les ids vus après une écriture : ceux d'avant et ceux de la liste, sans doublon, bornés comme les pistes. */
export const seenAfter = (seen: readonly string[], list: Waitlist): string[] => [...new Set([...seen, ...list.pistes.map(rawId).filter((id): id is string => id !== undefined)])].slice(-PISTES_MAX * 2)

/**
 * Une écriture de la liste garde-t-elle chaque piste ? La garde de toute écriture : chaque piste d'avant est
 * encore là (une piste hors forme, à l'identique) ; son texte et ses textes précédents sont encore son texte
 * ou dans son historique, ses commentaires encore là ; une piste en exécution ne change que d'état (vers
 * « faite » ou « en ticket ») ; une piste faite ne change plus ; aucun id en double ; aucune marque d'opération
 * retirée, sauf `released`.
 */
export const keepsPistes = (before: Waitlist, after: Waitlist, released: ReadonlySet<string> = new Set()): boolean => {
  const ids = after.pistes.map(rawId).filter((id): id is string => id !== undefined)
  if (new Set(ids).size !== ids.length) return false
  const byId = new Map(after.pistes.map(raw => [rawId(raw), raw] as const))
  for (const raw of before.pistes) {
    const id = rawId(raw)
    const now = id === undefined ? undefined : byId.get(id)
    const was = soundPiste(raw)
    if (!was) {
      if (!after.pistes.some(p => JSON.stringify(p) === JSON.stringify(raw))) return false
      continue
    }
    const is = soundPiste(now)
    if (!is) return false
    const texts = new Set([is.text, ...is.history.map(h => h.text)])
    if (![was.text, ...was.history.map(h => h.text)].every(t => texts.has(t))) return false
    const notes = new Set(is.comments.map(c => JSON.stringify(c)))
    if (!was.comments.every(c => notes.has(JSON.stringify(c)))) return false
    if (isFrozen(was.state)) {
      if (is.text !== was.text || !sameFiles(is.files, was.files) || is.comments.length !== was.comments.length || is.history.length !== was.history.length) return false
      if (was.state === 'done' && is.state !== 'done') return false
      if (was.state === 'running' && is.state !== 'running' && is.state !== 'done' && is.state !== 'ticket') return false
    }
  }
  const kept = new Set(after.applied)
  return before.applied.every(id => kept.has(id) || released.has(id))
}

// ─── La boîte d'une discussion ────────────────────────────────────────────

/** La boîte d'une discussion, telle qu'écrite : ses opérations gardées telles quelles. */
export type PisteBox = { v: 1; root: string; session: string; ops: unknown[] }

export type PisteBoxRead = { state: 'absent' } | { state: 'unread' } | { state: 'read'; box: PisteBox }

/** Lit le texte d'une boîte pour le projet `root` et la discussion `session` ; illisible (ou forgée pour une autre) sinon. */
export const parsePisteBox = (text: string, root: string, session: string): PisteBoxRead => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'unread' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'unread' }
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || x.root !== root || x.session !== session || !Array.isArray(x.ops)) return { state: 'unread' }
  return { state: 'read', box: { v: 1, root, session, ops: x.ops } }
}

/** La clé d'une opération relue : son id quand il est en forme, sinon son texte entier. */
const opKey = (raw: unknown): string => {
  const id = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).id : undefined
  return isPisteOpId(id) ? `id:${id}` : `raw:${JSON.stringify(raw)}`
}

/** La boîte sans les opérations notées appliquées dans la liste ; une opération hors forme reste. */
export const withoutApplied = (ops: readonly unknown[], applied: ReadonlySet<string>): unknown[] =>
  ops.filter(raw => {
    const o = soundPisteOp(raw)
    return !o || !applied.has(o.id)
  })

/** Une écriture de la boîte garde-t-elle chaque opération, sauf celles notées appliquées ? La garde de toute écriture. */
export const keepsOps = (before: readonly unknown[], after: readonly unknown[], applied: ReadonlySet<string>): boolean => {
  const kept = new Set(after.map(opKey))
  return before.every(raw => {
    const o = soundPisteOp(raw)
    return (o !== null && applied.has(o.id)) || kept.has(opKey(raw))
  })
}

/**
 * Les marques d'opérations que le COO peut retirer : celles qu'aucune boîte ne porte plus (`live`, les ids de
 * toutes les boîtes, toutes bien relues). Une marque retirée alors qu'une boîte porte encore l'opération la
 * ferait rejouer : l'appelant ne libère que sur des boîtes toutes relues.
 */
export const releasableMarks = (applied: readonly string[], live: ReadonlySet<string>): Set<string> => new Set(applied.filter(id => !live.has(id)))

// ─── Le lien d'un ticket à ses pistes ─────────────────────────────────────

/**
 * La ligne « Pistes : » d'un ticket de la mission « Pistes de rétro », relue : absente ; restée en gabarit
 * (vide, ou « <ids> ») ; ou ses mots, les ids de piste bien formés d'un côté, les autres (ancienne forme `p3`,
 * texte quelconque) de l'autre. Seul un id bien formé peut rattacher une piste.
 */
export type PistesLine = { kind: 'absent' } | { kind: 'template' } | { kind: 'tokens'; ids: string[]; odd: string[] }

export const parsePistesLine = (text: string): PistesLine => {
  // « Pistes » ou « Piste », toute casse, une espace (insécable comprise) avant les deux-points ; jamais une citation
  // (« > »). Plusieurs lignes : la première qui porte un id de piste, sinon la première.
  const lines = [...text.matchAll(/^[ \t*-]*(?:\*\*)?pistes?(?:\*\*)?[ \t  ]*:(?:\*\*)?(.*)$/gim)].map(m => parseValue(m[1]!))
  return lines.find(l => l.kind === 'tokens' && l.ids.length > 0) ?? lines[0] ?? { kind: 'absent' }
}

/** La valeur d'une ligne « Pistes : » : un commentaire HTML ne compte pas ; un mot entre chevrons (« <ids> ») reste du gabarit. */
const parseValue = (raw: string): PistesLine => {
  const value = raw.replace(/<!--.*?-->/g, ' ').trim()
  const tokens = value
    .split(/[\s,;]+/)
    .map(t => t.replace(/^[`"'«»(\[]+|[`"'«»)\].]+$/g, ''))
    .filter(t => t !== '')
  const filled = tokens.filter(t => !/^<.*>$/.test(t))
  if (filled.length === 0) return { kind: 'template' }
  // Un mot qui n'est pas un id se dit, borné : 10 au plus, chacun coupé à 60 caractères.
  const odd = filled.filter(t => !isPisteId(t)).slice(0, 10).map(t => clip(t, 60))
  return { kind: 'tokens', ids: [...new Set(filled.filter(isPisteId))], odd }
}

/** Le lien relu d'un fichier de ticket : l'id du ticket (le numéro du fichier) et sa ligne. */
export type TicketLink = { ticket: string; line: PistesLine }

/** Une transition à déposer : la piste, l'état visé, son groupe. */
export type PisteMove = { piste: string; state: PisteMoveState; group?: string }

/**
 * Les transitions qu'une mission « Pistes de rétro » doit déposer pour ses pistes (celles qui portent sa carte),
 * d'après ses tickets et ses groupes relus à l'instant, jamais de mémoire : une piste qu'un ticket du lot nomme
 * passe en ticket (avec le groupe de ce ticket), en exécution quand ce groupe est confié à un worker, faite quand
 * le ticket est fait ; une piste validée ou en exécution dans un autre groupe passe d'abord en ticket. Une piste
 * de cette mission qu'aucun ticket du lot ne nomme plus redevient validée si elle est en ticket, ou repasse en
 * ticket si elle est en exécution et que son groupe est rentré ; seulement quand chaque ticket du lot a son
 * fichier, tous relus (`isComplete`). Rien pour une piste pas encore validée, écartée ou faite, ni ce qui est
 * déjà l'état de la piste. `warnings` : ce qui ne rattache rien et doit se dire au manager (ligne absente ou en
 * gabarit, mot qui n'est pas un id, id inconnu, d'une autre carte, pas validé, écarté, d'une autre mission,
 * déjà nommé par un autre ticket).
 */
export const pisteMoves = (
  pistes: readonly Piste[],
  ctx: { card: string; mission: string; links: readonly TicketLink[]; tickets: readonly { id: string; status: string }[]; groups: readonly { id: string; tickets: readonly string[]; isOut: boolean }[]; isComplete: boolean; sameTicket: (a: string, b: string) => boolean },
): { moves: PisteMove[]; warnings: string[] } => {
  const warnings: string[] = []
  const byId = new Map(pistes.map(p => [p.id, p]))
  const inLot = (ticket: string) => ctx.tickets.find(t => ctx.sameTicket(t.id, ticket))
  const named = new Map<string, string>()
  // Dans l'ordre des tickets, jamais celui du listage : un même relevé donne toujours le même rattachement.
  const ordered = [...ctx.links].sort((a, b) => a.ticket.localeCompare(b.ticket, 'en', { numeric: true }) || (a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0))
  for (const link of ordered) {
    if (!inLot(link.ticket)) continue
    if (link.line.kind === 'absent') warnings.push(`ticket ${link.ticket}: it has no « Pistes : » line, nothing linked`)
    if (link.line.kind === 'template') warnings.push(`ticket ${link.ticket}: its « Pistes : » line is still the template, nothing linked`)
    if (link.line.kind !== 'tokens') continue
    for (const odd of link.line.odd) warnings.push(`ticket ${link.ticket}: « ${odd} » is not a piste id (« <retro mission id>/<piste id> »), nothing linked`)
    for (const id of link.line.ids) {
      const p = byId.get(id)
      if (!p) warnings.push(`ticket ${link.ticket}: piste ${id} is not in the waitlist, nothing linked`)
      else if (p.card !== ctx.card) warnings.push(`ticket ${link.ticket}: piste ${id} is not one of this mission's pistes (another launch card), nothing linked`)
      else if (p.state === 'pending') warnings.push(`ticket ${link.ticket}: piste ${id} is not validated (the user ticks it in the Coordination view), nothing linked`)
      else if (p.state === 'dropped' || (p.mission !== undefined && p.mission !== ctx.mission)) warnings.push(`ticket ${link.ticket}: piste ${id} is ${p.state === 'dropped' ? 'dropped' : 'in a ticket of another mission'}, nothing linked`)
      else if (named.has(id)) warnings.push(`ticket ${link.ticket}: piste ${id} is already named by ticket ${named.get(id)}, which keeps it`)
      else named.set(id, link.ticket)
    }
  }
  // Tout relu : chaque fichier listé s'est lu, et chaque ticket du lot a le sien (un dossier ou un fichier disparu ne rend rien).
  const isAllRead = ctx.isComplete && ctx.tickets.every(t => ctx.links.some(l => ctx.sameTicket(l.ticket, t.id)))
  const moves: PisteMove[] = []
  for (const p of pistes) {
    if (p.card !== ctx.card || (p.state !== 'validated' && p.state !== 'ticket' && p.state !== 'running')) continue
    if (p.mission !== undefined && p.mission !== ctx.mission) continue
    const ticket = named.get(p.id)
    if (ticket === undefined) {
      // Plus nommée par aucun ticket du lot : en ticket, elle redevient validée ; en exécution, elle revient en ticket
      // une fois son groupe rentré (puis validée au relevé suivant), jamais pendant qu'il travaille.
      const isGroupBack = !ctx.groups.some(g => g.id === p.group && g.isOut)
      if (isAllRead && p.state === 'ticket') moves.push({ piste: p.id, state: 'validated' })
      if (isAllRead && p.state === 'running' && isGroupBack) moves.push({ piste: p.id, state: 'ticket', ...(p.group !== undefined ? { group: p.group } : {}) })
      continue
    }
    const group = ctx.groups.find(g => g.tickets.some(t => ctx.sameTicket(t, ticket)))
    const status = inLot(ticket)!.status
    const move: PisteMove =
      status === 'done'
        ? { piste: p.id, state: 'done', ...(group ? { group: group.id } : {}) }
        : group?.isOut
          ? { piste: p.id, state: 'running', group: group.id }
          : { piste: p.id, state: 'ticket', ...(group ? { group: group.id } : {}) }
    // Une piste validée passe d'abord en ticket : en exécution et faite ne viennent que de là (le relevé suivant avance).
    // De même, une piste en exécution dans un autre groupe repasse d'abord en ticket.
    const isRegroup = p.state === 'running' && move.state === 'running' && p.group !== move.group
    const step: PisteMove = (p.state === 'validated' && move.state !== 'ticket') || isRegroup ? { piste: p.id, state: 'ticket', ...(group ? { group: group.id } : {}) } : move
    const isSame = p.state === step.state && p.mission === ctx.mission && p.group === step.group
    if (!isSame) moves.push(step)
  }
  return { moves, warnings }
}
