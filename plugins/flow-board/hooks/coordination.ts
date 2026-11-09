// Le fichier de coordination du projet : le canal du COO vers les managers. Le COO (la discussion qui
// tient le siège) y écrit ses consignes, une entrée par consigne ; le mod de chaque manager le relit
// toutes les 5 secondes et applique lui-même ce qui vise sa mission, une fois.
//
// Module pur, sans import du modèle : `register.tsx` lit et écrit le fichier, ce module dit ce qu'il
// contient et ce qu'une écriture peut en retirer.
//
// Invariants :
// - « Le fichier de coordination n'est écrit que par la discussion qui tient le siège ; une lecture
//   ratée ne lève jamais une consigne : un groupe retenu le reste, et une mission en auto se met en
//   pause plutôt que de lancer. »
// - « Le fichier de coordination n'est jamais réécrit vide ni supprimé tant qu'une mission du projet
//   existe ; une entrée ne part qu'avec la suppression de sa mission. » Deux exceptions, décidées avec la
//   personne : une marque « recopiée » d'une chose À reprendre, attachée à sa déclaration et non à une
//   mission, part quand plus aucune boîte ne porte la déclaration ; et le plan des vagues du projet
//   (entrées « plan »), que le plan suivant validé remplace en entier.

import { isTime } from './basics.ts'
import { isGroupId, isSafeId } from './closing.ts'
import { soundPlanWait, type PlanWait } from './plan-projet.ts'

/** Le texte du réveil d'un manager : fixe, sans aucune valeur venue d'ailleurs. */
export const WAKE_TEXT = 'Le COO a mis ta mission à jour : relis le tableau de bord.'

/** Ce que dit une discussion qui ne lit pas le fichier de coordination. */
export const COORD_UNREAD = 'Fichier de coordination illisible : retenues gardées, auto en pause.'

/** Au-delà, le COO n'ajoute plus d'entrée (rien n'est jamais retiré pour faire de la place). */
export const COORD_MAX = 2000

/**
 * Le genre écrit des demandes de clôture sans archivage. Les versions d'avant appliquaient le genre `close` en
 * archivant la mission : une discussion qui n'a pas encore rechargé le mod ignore ce genre, qu'elle ne connaît
 * pas, au lieu d'archiver sans le choix de la personne, et l'applique une fois le mod rechargé.
 * Le genre `close` d'un fichier ancien se lit encore, et s'applique sans archivage.
 */
export const CLOSE_KIND = 'closing'

/**
 * Une demande de clôture d'une mission, sans archivage : avec `delivered` (le résultat, même vide), à la fin d'une
 * livraison, qui la clôt comme livrée ; sans lui, le geste « clore » du COO, qui la clôt sans la marquer livrée.
 * `report` (avec `delivered`) : la date de validation du rapport que la livraison a emporté ; la clôture ne marque
 * jamais livrée une mission où du travail a été relancé depuis (`isReportShipped`).
 */
export type CoordClose = { id: string; kind: 'close'; run: string; at: number; doneAt?: number; delivered?: { version?: string; push?: string; pr?: string }; report?: number }

/**
 * Le résultat d'une livraison porté par une clôture : des textes courts, rendus par Claude. Un objet sans texte
 * lisible reste un résultat (vide) : la clôture reste celle d'une livraison.
 */
const deliveredOf = (v: unknown): CoordClose['delivered'] | undefined => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined
  const x = v as Record<string, unknown>
  const out: NonNullable<CoordClose['delivered']> = {}
  for (const k of ['version', 'push', 'pr'] as const) if (typeof x[k] === 'string' && (x[k] as string).length <= 300) out[k] = x[k] as string
  return out
}

/**
 * Un forçage d'une retenue entre missions, cliqué chez le COO : la mission retenue (`run`), son groupe
 * retenu (`held`, ou `*` pour le lot sans groupes), et le groupe attendu d'une autre mission.
 */
export type CoordForce = { id: string; kind: 'force'; run: string; at: number; held: string; awaited: { run: string; group: string }; on?: 'plan' }

/**
 * Une déclaration « À reprendre » recopiée dans la feuille de route, notée par le mod du COO quand il l'y
 * voit : la boîte qui la porte peut la retirer. Elle n'est attachée à aucune mission (une mission
 * supprimée avant que sa boîte se vide ne la fait pas recopier deux fois) ; elle part quand plus aucune
 * boîte ne porte la déclaration.
 */
export type CoordCopied = { id: string; kind: 'copied'; decl: string; at: number }

/** Une mission close dont le COO a relevé ce qui traîne (comptes rendus, pistes non choisies, rapport). */
export type CoordGleaned = { id: string; kind: 'gleaned'; run: string; at: number }

/**
 * Une piste d'une rétro (`run`, `item`) déjà prise par une autre mission (`by` : sa mission et le ticket
 * qui la porte) : le mod de la rétro la montre ainsi et la retire de ce qu'on peut découper.
 */
export type CoordTaken = { id: string; kind: 'taken'; run: string; at: number; item: string; label?: string; by: { run: string; ticket: string } }

/**
 * Une attente du plan des vagues du projet validé : le groupe retenu (`held`, ou `*`) de la mission `run`
 * attend le groupe d'une autre mission. Le plan suivant validé les remplace toutes, en entier.
 */
export type CoordPlan = { id: string; kind: 'plan'; run: string; at: number; held: string; awaited: { run: string; group: string } }

/**
 * Une vague du projet lancée chez le COO (« ⇉ Lancer la vague ») : pour la mission `run`, les groupes affichés
 * au clic (`wave` : l'id du clic, le même pour toutes ses missions). Le mod du manager les lance lui-même, une
 * fois, seulement si le plan les fait toujours partir, et seulement dans les 10 minutes du clic.
 */
export type CoordWave = { id: string; kind: 'wave'; run: string; at: number; wave: string; groups: string[] }

/** Une vague lancée chez le COO ne s'applique plus au-delà (la discussion du manager était fermée ou occupée). */
export const WAVE_TTL_MS = 10 * 60_000

/** Au plus, les groupes d'une mission dans une vague. */
const WAVE_GROUPS_MAX = 20

/**
 * Un geste de la personne chez le COO, sur une question bloquante d'une mission (`question`, son id) :
 * l'empreinte du texte qu'elle a vu (`print`), et sa réponse (`yes` : autoriser, laisser la faille ;
 * `no` : refuser, faire corriger). Le mod de la mission ne l'applique que si la question n'a pas changé.
 */
export type CoordGesture = { id: string; kind: 'gesture'; run: string; at: number; question: string; print: string; answer: 'yes' | 'no' }

/**
 * Une réponse écrite de la personne, relayée par le COO : la question (son id et l'empreinte du texte
 * vu), le `DECISIONS.md` de la mission où le COO l'a écrite et le numéro de sa série.
 */
export type CoordAnswer = { id: string; kind: 'answer'; run: string; at: number; question: string; print: string; file: string; series: number }

/** « ✓ Valider » le rapport d'une mission chez le COO : l'empreinte de la version lue (`reportPrint`). */
export type CoordValidate = { id: string; kind: 'validate'; run: string; at: number; print: string }

/**
 * « ✎ À reprendre » le rapport d'une mission : la demande de la personne, écrite par le COO dans le `DECISIONS.md`
 * de la mission (sa série), pour le tour du compte rendu en cours (`round`) : elle ne vaut pour aucun autre.
 */
export type CoordRedo = { id: string; kind: 'redo'; run: string; at: number; file: string; series: number; round: string }

/**
 * Deux décisions opposées de deux missions, relevées par le COO : la mission qui a décidé en second (`run`), qui
 * pose la question bloquante, l'autre (`other`), chacune avec sa décision (source et texte mot pour mot), et le
 * sujet commun. Le mod de `run` pose la question une fois ; la réponse passe par le `DECISIONS.md` des deux.
 */
export type CoordContradiction = { id: string; kind: 'contradiction'; run: string; at: number; other: string; mine: { ref: string; text: string }; theirs: { ref: string; text: string }; subject: string }

/** Deux missions qui décident toutes deux sur un même sujet, de façon compatible : une ligne chez le COO. */
export type CoordCompatible = { id: string; kind: 'compatible'; run: string; at: number; other: string; subject: string }

/**
 * Les pistes d'une rétro lancée par le COO, cochées d'un clic chez lui : les cochées (`picked`, à découper), les
 * autres (`left`, mises de côté dans « À reprendre »), et l'empreinte des pistes montrées au clic. Le mod de la
 * rétro l'applique une fois, sur les mêmes pistes seulement.
 */
export type CoordPick = { id: string; kind: 'pick'; run: string; at: number; picked: string[]; left: string[]; print: string }

/** Au plus, les pistes d'une sélection. */
export const PICK_MAX = 60

/** Une entrée bien formée du fichier de coordination. */
export type CoordEntry = CoordClose | CoordForce | CoordCopied | CoordGleaned | CoordTaken | CoordPlan | CoordWave | CoordGesture | CoordAnswer | CoordValidate | CoordRedo | CoordContradiction | CoordCompatible | CoordPick

/**
 * L'empreinte d'un rapport : son texte entier réduit à un code (deux sommes de 32 bits et la longueur, séparées) ;
 * une version changée en a une autre.
 */
export const reportPrint = (text: string): string => {
  let a = 5381
  let b = 2166136261
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    a = ((a * 33) ^ c) >>> 0
    b = Math.imul(b ^ c, 16777619) >>> 0
  }
  return `r${a.toString(36)}-${b.toString(36)}-${text.length.toString(36)}`
}

/** L'empreinte d'un rapport, relue d'une entrée. */
export const isReportPrint = (v: unknown): v is string => typeof v === 'string' && /^r[a-z0-9]{1,7}-[a-z0-9]{1,7}-[a-z0-9]{1,8}$/.test(v)

/** Le tour d'un compte rendu (place de sa phase, tour, début) : la forme commune à l'entrée « redo » et au fichier du rapport. */
export const ROUND_FORM = '[0-9]{1,4}\\.[0-9]{1,6}\\.[0-9]{1,16}'

/** Le tour d'un compte rendu, relu d'une entrée. */
export const isRound = (v: unknown): v is string => typeof v === 'string' && new RegExp(`^${ROUND_FORM}$`).test(v)

/** L'id d'une question bloquante cité par une entrée : un texte d'une ligne, 200 signes au plus, sans caractère de contrôle. */
export const isQuestionRef = (v: unknown): v is string => isOneLine(v, 200)

/** Un texte d'une ligne, `max` signes au plus, sans caractère de contrôle ni invisible. */
export const isOneLine = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(v)

/**
 * Un geste ou une réponse se dit « en cours d'application » chez le COO pendant ce délai après son écriture,
 * puis la question redevient répondable (la réponse a pu être consommée sans effet, ou appliquée sans que la
 * question soit retirée) : jamais une question bloquée sans bouton pour toujours.
 */
export const RELAY_PENDING_MS = 2 * 60_000

/** L'empreinte d'un texte de question (`questionPrint`). */
export const isPrint = (v: unknown): v is string => typeof v === 'string' && /^q[a-z0-9]{1,13}$/.test(v)

/**
 * Le chemin du `DECISIONS.md` d'une mission, relatif à la racine du projet : sous `travail/`, nommé
 * `DECISIONS.md`, des segments de lettres, chiffres, `._-`, aucun `..` (l'existence se vérifie à part).
 */
export const isDecisionsPath = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 300 && /^travail\/(?:[A-Za-z0-9._-]+\/)+DECISIONS\.md$/.test(v) && !v.split('/').some(seg => seg === '..' || seg === '.')

/** Le numéro d'une série d'un `DECISIONS.md` : un entier de 1 à 100 000. */
export const isSeries = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100_000

/** L'id d'un ticket cité par une marque : lettres, chiffres, et `#._-`, 40 au plus. */
export const isTicketRef = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9#._-]{1,40}$/.test(v)

/** Un groupe d'une retenue : son id en forme, ou `*` (le lot sans groupes). */
const isUnitKey = (v: unknown): v is string => v === '*' || isGroupId(v)

/** Le fichier tel qu'écrit : les entrées gardées telles quelles, même celles qu'aucune version ne sait lire. */
export type CoordFile = { v: 1; root: string; entries: unknown[] }

/** La lecture du fichier : absent (rien n'a encore été écrit), illisible (rien ne s'applique, rien ne s'écrit), ou lu. */
export type CoordRead = { state: 'absent' } | { state: 'unread'; why: string } | { state: 'read'; file: CoordFile }

/** L'id d'une entrée : tiré au hasard par le COO, `c` puis 6 à 24 lettres minuscules ou chiffres. */
export const isEntryId = (v: unknown): v is string => typeof v === 'string' && /^c[a-z0-9]{6,24}$/.test(v)

/** Un id neuf, d'après la date et un tirage (`rand` dans [0, 1)). */
export const newEntryId = (now: number, rand: number): string =>
  `c${Math.max(0, Math.floor(now)).toString(36)}${Math.floor(Math.min(Math.max(rand, 0), 0.999999) * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`.slice(0, 25)

/** Une entrée relue, réduite à ses champs ; null quand elle est mal formée ou d'un genre inconnu (gardée, jamais appliquée). */
export const soundEntry = (raw: unknown): CoordEntry | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  if (e.kind === 'copied') return isEntryId(e.id) && isTime(e.at) && typeof e.decl === 'string' && /^a[a-z0-9]{6,24}$/.test(e.decl) ? { id: e.id, kind: 'copied', decl: e.decl, at: e.at } : null
  if (!isEntryId(e.id) || !isSafeId(e.run) || !isTime(e.at)) return null
  if (e.kind === 'gleaned') return { id: e.id, kind: 'gleaned', run: e.run, at: e.at }
  if (e.kind === 'taken') {
    const by = e.by !== null && typeof e.by === 'object' && !Array.isArray(e.by) ? (e.by as Record<string, unknown>) : {}
    if (!isGroupId(e.item) || !isSafeId(by.run) || by.run === e.run || !isTicketRef(by.ticket)) return null
    if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > 1000)) return null
    return { id: e.id, kind: 'taken', run: e.run, at: e.at, item: e.item, ...(typeof e.label === 'string' ? { label: e.label } : {}), by: { run: by.run, ticket: by.ticket } }
  }
  if (e.kind === 'gesture') {
    if (!isQuestionRef(e.question) || !isPrint(e.print) || (e.answer !== 'yes' && e.answer !== 'no')) return null
    return { id: e.id, kind: 'gesture', run: e.run, at: e.at, question: e.question, print: e.print, answer: e.answer }
  }
  if (e.kind === 'answer') {
    if (!isQuestionRef(e.question) || !isPrint(e.print) || !isDecisionsPath(e.file) || !isSeries(e.series)) return null
    return { id: e.id, kind: 'answer', run: e.run, at: e.at, question: e.question, print: e.print, file: e.file, series: e.series }
  }
  if (e.kind === 'contradiction' || e.kind === 'compatible') {
    if (!isSafeId(e.other) || e.other === e.run || !isOneLine(e.subject, 200)) return null
    if (e.kind === 'compatible') return { id: e.id, kind: 'compatible', run: e.run, at: e.at, other: e.other, subject: e.subject }
    const side = (v: unknown): { ref: string; text: string } | null => {
      const x = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
      return isOneLine(x.ref, 200) && isOneLine(x.text, 600) ? { ref: x.ref, text: x.text } : null
    }
    const mine = side(e.mine)
    const theirs = side(e.theirs)
    return mine && theirs ? { id: e.id, kind: 'contradiction', run: e.run, at: e.at, other: e.other, mine, theirs, subject: e.subject } : null
  }
  if (e.kind === 'pick') {
    const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= PICK_MAX && v.every(isGroupId) && new Set(v).size === v.length ? [...(v as string[])] : null)
    const picked = ids(e.picked)
    const left = ids(e.left)
    if (!picked || !left || picked.length + left.length === 0 || picked.some(i => left.includes(i)) || typeof e.print !== 'string' || !/^p[a-z0-9]{1,16}$/.test(e.print)) return null
    return { id: e.id, kind: 'pick', run: e.run, at: e.at, picked, left, print: e.print }
  }
  if (e.kind === 'validate') return isReportPrint(e.print) ? { id: e.id, kind: 'validate', run: e.run, at: e.at, print: e.print } : null
  if (e.kind === 'redo') return isDecisionsPath(e.file) && isSeries(e.series) && isRound(e.round) ? { id: e.id, kind: 'redo', run: e.run, at: e.at, file: e.file, series: e.series, round: e.round } : null
  if (e.kind === 'close' || e.kind === CLOSE_KIND) {
    const delivered = deliveredOf(e.delivered)
    return { id: e.id, kind: 'close', run: e.run, at: e.at, ...(isTime(e.doneAt) ? { doneAt: e.doneAt } : {}), ...(delivered ? { delivered } : {}), ...(delivered && isTime(e.report) ? { report: e.report } : {}) }
  }
  if (e.kind === 'wave') {
    const groups = Array.isArray(e.groups) ? e.groups : []
    if (!isEntryId(e.wave) || groups.length === 0 || groups.length > WAVE_GROUPS_MAX || !groups.every(isGroupId) || new Set(groups).size !== groups.length) return null
    return { id: e.id, kind: 'wave', run: e.run, at: e.at, wave: e.wave, groups: [...groups] }
  }
  if (e.kind === 'plan') {
    const w = soundPlanWait(e)
    return w ? { id: e.id, kind: 'plan', run: e.run, at: e.at, held: w.group, awaited: { run: w.awaited.run, group: w.awaited.group } } : null
  }
  if (e.kind === 'force') {
    const w = e.awaited !== null && typeof e.awaited === 'object' ? (e.awaited as Record<string, unknown>) : {}
    if (!isUnitKey(e.held) || !isSafeId(w.run) || !isUnitKey(w.group) || (e.on !== undefined && e.on !== 'plan')) return null
    return { id: e.id, kind: 'force', run: e.run, at: e.at, held: e.held, awaited: { run: w.run, group: w.group }, ...(e.on === 'plan' ? { on: 'plan' as const } : {}) }
  }
  return null
}

/** La mission que vise une entrée relue, même d'un genre inconnu ; null sans id de mission en forme. */
export const entryRun = (raw: unknown): string | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const run = (raw as Record<string, unknown>).run
  return isSafeId(run) ? run : null
}

/** La clé d'une entrée relue : son id quand il est en forme, sinon son texte entier. */
const entryKey = (raw: unknown): string => {
  const id = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).id : undefined
  return isEntryId(id) ? `id:${id}` : `raw:${JSON.stringify(raw)}`
}

/**
 * Lit le texte du fichier pour le projet `root` (racine normalisée par l'appelant). Illisible : un JSON
 * coupé, une autre forme, un autre projet. Un fichier vide compte comme illisible (une écriture coupée).
 */
export const parseCoordination = (text: string, root: string): CoordRead => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'unread', why: 'not JSON (a cut write, or edited by hand)' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'unread', why: 'not an object' }
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || !Array.isArray(x.entries)) return { state: 'unread', why: 'unknown form' }
  if (typeof x.root !== 'string' || x.root !== root) return { state: 'unread', why: 'another project' }
  return { state: 'read', file: { v: 1, root, entries: x.entries } }
}

/**
 * Une entrée part avec sa mission : seulement quand la mission est effacée (sa trace d'effacement ou sa
 * pierre tombale, `isGone`, que l'appelant ne donne que pour une mission absente du fichier des missions
 * bien relu). Une entrée sans mission lisible ne part jamais.
 */
export const isEntryGone = (raw: unknown, isGone: (run: string) => boolean): boolean => {
  const run = entryRun(raw)
  if (run !== null && isGone(run)) return true
  // L'autre mission qu'une entrée nomme (celle qui a pris la piste, celle qu'un forçage attendait) : partie, l'entrée part avec.
  const e = soundEntry(raw)
  const other = e?.kind === 'taken' ? e.by.run : e?.kind === 'force' || e?.kind === 'plan' ? e.awaited.run : null
  return other !== null && isGone(other)
}

/** Les entrées sans celles des missions effacées (la mission visée ou l'autre qu'elles nomment). */
export const withoutGone = (entries: readonly unknown[], isGone: (run: string) => boolean): unknown[] => entries.filter(e => !isEntryGone(e, isGone))

/**
 * L'écriture `after` garde-t-elle toutes les entrées de `before`, sauf celles des missions effacées ?
 * La garde de toute écriture du COO : sans elle, rien ne s'écrit.
 */
export const keepsEntries = (before: readonly unknown[], after: readonly unknown[], isGone: (run: string) => boolean, isReleased: (raw: unknown) => boolean = () => false): boolean => {
  const kept = new Set(after.map(entryKey))
  return before.every(e => isEntryGone(e, isGone) || isReleased(e) || kept.has(entryKey(e)))
}

/**
 * Une marque « recopiée » libérée : plus aucune boîte ne porte sa déclaration (`liveDecls`, les ids de
 * toutes les boîtes, toutes bien relues). Seule entrée qui part sans la suppression d'une mission.
 */
export const isReleasedMark = (raw: unknown, liveDecls: ReadonlySet<string>): boolean => {
  const e = soundEntry(raw)
  return e !== null && e.kind === 'copied' && !liveDecls.has(e.decl)
}

/** Les déclarations notées recopiées. */
export const copiedDecls = (entries: readonly CoordEntry[]): Set<string> => new Set(entries.flatMap(e => (e.kind === 'copied' ? [e.decl] : [])))

/**
 * Les pistes de la rétro `run` déjà prises ailleurs : par id de piste, la mission et le ticket qui la
 * portent. Une marque désigne la piste par le libellé que le COO a jugé : retrouvée par ce libellé dans
 * `items` (une rétro renumérote ses pistes), sinon par son id quand elle n'en porte pas ; une marque dont
 * le libellé n'est plus nulle part se compte à part (`lost`) : sa piste reste découpable, et la vue le dit.
 */
export const takenFor = (entries: readonly CoordEntry[], run: string, items?: readonly { id: string; label: string; status?: string }[]): Map<string, { run: string; ticket: string }> & { lost?: number } => {
  const out: Map<string, { run: string; ticket: string }> & { lost?: number } = new Map()
  let lost = 0
  for (const e of entries) {
    if (e.kind !== 'taken' || e.run !== run) continue
    // Son id d'abord, si le libellé y est encore ; sinon le libellé jugé, parmi les pistes ni faites ni écartées.
    const own = items?.find(i => i.id === e.item)
    const id =
      e.label === undefined || items === undefined || (own !== undefined && sameLabel(own.label, e.label))
        ? e.item
        : items.find(i => i.status !== 'done' && i.status !== 'dropped' && sameLabel(i.label, e.label!))?.id
    if (id === undefined) lost += 1
    else if (!out.has(id)) out.set(id, e.by)
  }
  if (lost > 0) out.lost = lost
  return out
}

/** Deux libellés de piste, blancs resserrés. */
export const sameLabel = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/** Les libellés jugés des marques d'une rétro : une piste envoyée sous un autre id, avec ce libellé, reste marquée. */
export const takenLabels = (entries: readonly CoordEntry[], run: string): string[] => entries.flatMap(e => (e.kind === 'taken' && e.run === run && e.label !== undefined ? [e.label] : []))

/**
 * Les marques d'une rétro qu'on ne sait pas lire : une entrée qui se dit « taken » pour cette mission et
 * n'est pas en forme. La piste reste alors découpable, et la vue le dit.
 */
export const unreadTakenFor = (entries: readonly unknown[], run: string): number =>
  entries.filter(raw => raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).kind === 'taken' && (raw as Record<string, unknown>).run === run && soundEntry(raw) === null).length

/** Les missions dont le COO a relevé ce qui traîne, avec la date du relevé le plus récent. */
export const gleanedRuns = (entries: readonly CoordEntry[]): Map<string, number> => {
  const out = new Map<string, number>()
  for (const e of entries) if (e.kind === 'gleaned') out.set(e.run, Math.max(out.get(e.run) ?? 0, e.at))
  return out
}

/** Les entrées bien formées qui s'appliquent : pas celles d'une mission effacée (`isErased` : sa trace ou sa pierre tombale, vue à l'instant). */
export const liveEntries = (entries: readonly unknown[], isErased: (run: string) => boolean): CoordEntry[] =>
  entries.flatMap(raw => {
    const e = soundEntry(raw)
    return e && (e.kind === 'copied' || !isErased(e.run)) ? [e] : []
  })

/** Les entrées qui visent la mission `run`, ni déjà faites (`doneAt`, noté par le COO) ni déjà appliquées ici. */
export const pendingFor = (entries: readonly CoordEntry[], run: string, applied: ReadonlySet<string>): CoordClose[] =>
  entries.filter((e): e is CoordClose => e.kind === 'close' && e.run === run && e.doneAt === undefined && !applied.has(e.id))

/** Ce que le COO relaie à une mission et que son mod applique une fois : un geste, une réponse écrite, la validation ou la reprise du rapport. */
export type CoordRelay = CoordGesture | CoordAnswer | CoordValidate | CoordRedo

/** Les relais qui visent la mission `run`, pas encore appliqués ici, dans l'ordre du fichier. */
export const pendingRelaysFor = (entries: readonly CoordEntry[], run: string, applied: ReadonlySet<string>): CoordRelay[] =>
  entries.filter((e): e is CoordRelay => (e.kind === 'gesture' || e.kind === 'answer' || e.kind === 'validate' || e.kind === 'redo') && e.run === run && !applied.has(e.id))

/** Les vagues lancées chez le COO qui visent la mission `run`, pas encore appliquées ici et encore dans leurs 10 minutes. */
export const pendingWavesFor = (entries: readonly CoordEntry[], run: string, applied: ReadonlySet<string>, now: number): CoordWave[] =>
  entries.filter((e): e is CoordWave => e.kind === 'wave' && e.run === run && !applied.has(e.id) && now - e.at < WAVE_TTL_MS && e.at <= now + 60_000)

/** Les attentes du plan validé : celles d'une mission (`run`), ou toutes. */
export const planWaitsOf = (entries: readonly CoordEntry[], run?: string): PlanWait[] =>
  entries.flatMap(e => (e.kind === 'plan' && (run === undefined || e.run === run) ? [{ run: e.run, group: e.held, awaited: e.awaited }] : []))

/**
 * Le plan ne se lit pas pour la mission `run` : une entrée qui se dit « plan » et n'est pas en forme, et qui
 * vise cette mission ou aucune mission lisible. Rien ne part alors d'après lui (invariant du plan).
 */
export const isPlanUnreadFor = (entries: readonly unknown[], run: string): boolean =>
  entries.some(raw => {
    if (raw === null || typeof raw !== 'object' || (raw as Record<string, unknown>).kind !== 'plan' || soundEntry(raw) !== null) return false
    const target = entryRun(raw)
    return target === null || target === run
  })

/** Une entrée du plan, que le plan suivant validé remplace : elle part sans la suppression de sa mission. */
export const isPlanEntry = (raw: unknown): boolean => raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).kind === 'plan'

/** Les forçages qui visent la mission `run` : les paires (groupe retenu, mission et groupe attendus) qu'ils lèvent. */
export const forcesFor = (entries: readonly CoordEntry[], run: string): { held: string; run: string; group: string; on?: 'plan' }[] =>
  entries.flatMap(e => (e.kind === 'force' && e.run === run ? [{ held: e.held, run: e.awaited.run, group: e.awaited.group, ...(e.on ? { on: e.on } : {}) }] : []))

/**
 * Les demandes de clôture faites, notées par le COO : celles dont `isOver` dit la clôture faite (ou la mission
 * archivée) reçoivent `doneAt` (l'entrée reste, elle ne s'applique plus : une mission reprise ensuite n'est
 * pas refermée). Rend les entrées changées, ou null quand rien ne change.
 */
export const markClosesDone = (entries: readonly unknown[], isOver: (entry: CoordClose) => boolean, now: number): unknown[] | null => {
  let isChanged = false
  const out = entries.map(raw => {
    const e = soundEntry(raw)
    if (!e || e.kind !== 'close' || e.doneAt !== undefined || !isOver(e)) return raw
    isChanged = true
    return { ...(raw as Record<string, unknown>), doneAt: now }
  })
  return isChanged ? out : null
}

/** Les ids déjà appliqués, relus du stockage de la discussion : seulement des ids en forme. */
export const soundApplied = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isEntryId).slice(-COORD_MAX) : [])

/**
 * La référence « [ref] » d'une discussion, extraite d'un texte relu (le fichier de référence du manager) :
 * seulement sa forme, quatre à douze lettres minuscules ou chiffres entre crochets ; null sinon.
 */
export const refOf = (text: unknown): string | null => {
  if (typeof text !== 'string') return null
  const m = /\[([a-z0-9]{4,12})\]\s*$/.exec(text.trim())
  return m ? `[${m[1]}]` : null
}
