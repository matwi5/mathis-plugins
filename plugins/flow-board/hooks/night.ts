// La surveillance de nuit du COO : la personne l'allume avant de dormir (« 🌙 Surveillance de nuit » de la
// vue Coordination, ou `/flow-board:nuit` tapé), et pendant ses 12 heures au plus, le Claude du COO peut
// débloquer les missions en auto par la liste fermée des gestes de nuit. Ce module dit la forme de
// l'enregistrement de la surveillance, s'il vaut encore pour un geste, qui l'arrête, la forme du journal
// des gestes de la nuit, les blocages des missions en auto et quand ils réveillent la discussion du COO.
//
// Module pur, sans import du modèle : `register.tsx` lit et écrit l'enregistrement (un fichier à côté du
// fichier de coordination, à défaut `$.store`) et le journal.
//
// Invariant (validé par la personne) : « Hors d'une surveillance allumée par Mathis et encore valide,
// aucun geste ne part sans son clic ; pendant la surveillance, seul un geste de la liste fermée part, une
// seule fois, et une lecture ratée de la surveillance vaut éteinte. »

import type { CooSeat } from '../types'
import { isTime } from './basics.ts'
import { isSafeId, shellQuote } from './closing.ts'
import { isSeatAhead, soundSeat, seatHolder } from './seat.ts'

/** Une surveillance dure au plus 12 heures après son allumage. */
export const NIGHT_MS = 12 * 60 * 60_000

/**
 * Le siège doit s'être montré depuis aussi peu pour qu'une surveillance vaille (le titulaire se montre
 * toutes les 5 minutes, `SEAT_REFRESH_MS`) : après un `/clear` ou un plantage, l'ancien id tient encore le
 * siège jusqu'à 30 minutes, la surveillance ne vaut plus au-delà de 10.
 */
const NIGHT_SEAT_FRESH_MS = 10 * 60_000

/** L'avance qu'une date relue peut avoir sur l'horloge d'ici ; au-delà, la surveillance vaut éteinte. */
const SKEW_MS = 60_000

/**
 * L'enregistrement d'une surveillance allumée : son id, le projet, l'heure d'allumage, l'heure de fin au plus
 * tard, la discussion du COO qui l'a allumée (`by`) et la prise du siège qu'elle tenait alors (`seatAt`) :
 * une reprise du siège plus tard, même par la même discussion, ne la réanime pas. `how` : le clic ou la commande.
 */
export type NightWatch = { v: 1; id: string; root: string; at: number; until: number; by: string; seatAt: number; how: 'click' | 'command' }

/** L'id d'une surveillance : `n` puis 8 à 24 lettres minuscules ou chiffres. */
export const isNightId = (v: unknown): v is string => typeof v === 'string' && /^n[a-z0-9]{8,24}$/.test(v)

/** Un id neuf, d'après la date et un tirage (`rand` dans [0, 1)). */
export const newNightId = (now: number, rand: number): string =>
  `n${Math.max(0, Math.floor(now)).toString(36)}${Math.floor(Math.min(Math.max(rand, 0), 0.999999) * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`.slice(0, 25)

/** Un enregistrement relu, réduit à ses champs ; null quand il est mal formé, d'un autre projet, ou plus long que 12 heures. */
const soundNightWatch = (raw: unknown, root: string): NightWatch | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || !isNightId(x.id) || x.root !== root || !isTime(x.at) || !isTime(x.until) || !isSafeId(x.by) || !isTime(x.seatAt)) return null
  if (x.how !== 'click' && x.how !== 'command') return null
  if (x.until <= x.at || x.until - x.at > NIGHT_MS) return null
  return { v: 1, id: x.id, root, at: x.at, until: x.until, by: x.by, seatAt: x.seatAt, how: x.how }
}

/** Une surveillance neuve, allumée à `now` par la discussion `by` qui tient le siège pris à `seatAt`. */
export const newNightWatch = (id: string, root: string, by: string, seatAt: number, now: number, how: NightWatch['how']): NightWatch => ({ v: 1, id, root, at: now, until: now + NIGHT_MS, by, seatAt, how })

/**
 * Pourquoi une surveillance s'est arrêtée : un message de la personne (`person`), « Arrêter » (`button`), son heure
 * de fin (`ended`), la fin ou le vidage de la discussion du COO (`closed`, `clear`), son siège muet plus de 10 minutes
 * (`gap` : veille, plantage).
 */
export type NightStop = 'person' | 'button' | 'ended' | 'closed' | 'clear' | 'gap'
const STOPS: readonly NightStop[] = ['person', 'button', 'ended', 'closed', 'clear', 'gap']

/**
 * L'enregistrement d'une surveillance arrêtée : le moteur n'efface pas de fichier, l'arrêt réécrit donc
 * l'enregistrement en « éteinte », avec l'id de la dernière surveillance, l'heure et la cause de l'arrêt (le
 * résumé du matin les relit).
 */
export type NightOff = { v: 1; root: string; off: { id: string; at: number; why: NightStop } }

/** L'enregistrement d'une surveillance arrêtée, à `now`. */
export const nightOff = (root: string, id: string, now: number, why: NightStop): NightOff => ({ v: 1, root, off: { id, at: now, why } })

/** La lecture de l'enregistrement : absent ou arrêtée (éteinte), illisible (éteinte, rien ne s'écrit par-dessus), ou allumée. */
export type NightRead = { state: 'absent' } | { state: 'off'; last: NightOff['off'] } | { state: 'unread'; why: string } | { state: 'read'; watch: NightWatch }

/** Lit le texte de l'enregistrement pour le projet `root` ; un texte qui ne se lit pas comme une surveillance de ce projet est illisible. */
export const parseNight = (text: string, root: string): NightRead => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'unread', why: 'not JSON' }
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'off' in raw) {
    const x = raw as Record<string, unknown>
    const off = x.off !== null && typeof x.off === 'object' ? (x.off as Record<string, unknown>) : {}
    if (x.v === 1 && x.root === root && isNightId(off.id) && isTime(off.at) && (STOPS as readonly unknown[]).includes(off.why)) return { state: 'off', last: { id: off.id, at: off.at, why: off.why as NightStop } }
    return { state: 'unread', why: 'not a night watch of this project' }
  }
  const watch = soundNightWatch(raw, root)
  return watch ? { state: 'read', watch } : { state: 'unread', why: 'not a night watch of this project' }
}

/**
 * Le siège relu n'a pas été vu depuis plus de 10 minutes (plantage puis reprise, mise en veille) : son titulaire,
 * qui le rafraîchit, arrête d'abord sa surveillance, qui ne reprend pas avec le siège rafraîchi.
 */
export const isSeatGap = (seat: CooSeat | unknown, now: number): boolean => {
  const s = soundSeat(seat)
  return s !== undefined && now - s.seenAt > NIGHT_SEAT_FRESH_MS
}

/** Pourquoi une surveillance relue ne vaut pas pour un geste. */
export type NightRefusal = 'absent' | 'unread' | 'other-id' | 'ended' | 'future' | 'seat-free' | 'seat-other' | 'seat-retaken' | 'seat-stale'

/**
 * La surveillance relue vaut-elle pour un geste, à `now` ? Seulement lue (absente ou illisible : éteinte), au
 * même id que le geste quand il en porte un (`id`), allumée au plus une minute dans le futur, avant son heure
 * de fin, et tant que la discussion qui l'a allumée tient encore le siège (`seat`, relu du fichier des missions),
 * par la même prise, vue vivante depuis 10 minutes au plus.
 */
export const nightValidity = (read: NightRead, seat: CooSeat | unknown, now: number, id?: string): { ok: true; watch: NightWatch } | { ok: false; why: NightRefusal } => {
  if (read.state !== 'read') return { ok: false, why: read.state === 'unread' ? 'unread' : 'absent' }
  const w = read.watch
  if (id !== undefined && id !== w.id) return { ok: false, why: 'other-id' }
  if (w.at > now + SKEW_MS || w.seatAt > now + SKEW_MS) return { ok: false, why: 'future' }
  if (now >= w.until) return { ok: false, why: 'ended' }
  // Un siège daté au-delà d'une minute dans le futur ne se périmerait pas : éteinte.
  if (isSeatAhead(seat, now)) return { ok: false, why: 'future' }
  const holder = seatHolder(seat, now)
  if (holder === null) return { ok: false, why: 'seat-free' }
  if (holder !== w.by) return { ok: false, why: 'seat-other' }
  const s = soundSeat(seat)
  if (!s || s.at !== w.seatAt) return { ok: false, why: 'seat-retaken' }
  if (now - s.seenAt > NIGHT_SEAT_FRESH_MS) return { ok: false, why: 'seat-stale' }
  return { ok: true, watch: w }
}

/**
 * Le message de la personne qui arrête la surveillance : une origine de l'utilisateur, comme les compte
 * `docs/evenements-moteur.md` (« Filiation d'une requête ») : `composer`, `bridge`, `sdk`, `slack-ping`,
 * `unclassified`, une origine absente ou inconnue, et `plugin` avec `asUser`. N'arrêtent pas : un tour envoyé
 * par un mod (`plugin` sans `asUser`, le réveil de nuit compris), le message d'une autre session (`peer`,
 * `peer-send-message`), une notification de tâche (`task-notification`).
 */
export const isPersonOrigin = (origin: unknown): boolean => {
  if (origin === null || typeof origin !== 'object') return true
  const o = origin as Record<string, unknown>
  if (o.kind === 'plugin') return o.asUser === true
  return o.kind !== 'peer' && o.kind !== 'peer-send-message' && o.kind !== 'task-notification'
}

/** Seul un message tapé allume la surveillance par `/flow-board:nuit` : `composer`, `bridge`, `sdk`, jamais un mod. */
export const isTypedOrigin = (origin: unknown): boolean => {
  if (origin === null || typeof origin !== 'object') return false
  const kind = (origin as Record<string, unknown>).kind
  return kind === 'composer' || kind === 'bridge' || kind === 'sdk'
}

// ─── Journal des gestes de la nuit ─────────────────────────────────────────
//
// Un fichier par projet à côté du fichier de coordination, une ligne JSON par geste, écrit par le seul mod
// du COO ; jamais effacé par la surveillance, seulement relu pour le résumé du matin ; borné en lignes, les
// plus anciennes sortent au-delà de la borne.

/** Au plus, les lignes gardées du journal (comme le fichier de coordination) ; les plus anciennes sortent au-delà. */
export const NIGHT_LOG_MAX = 2000

/**
 * Une ligne du journal : l'heure, la surveillance, le geste (`start` et `stop` : l'allumage et l'arrêt ; ensuite
 * les gestes de nuit), la mission et le groupe visés, pourquoi, et ce qu'il a donné (`result`).
 */
export type NightLogLine = { at: number; watch: string; act: string; mission?: string; group?: string; why: string; result: string; entry?: string }

/** Un texte court du journal, sur une ligne : ni caractère de contrôle (C0, C1), de format ou ignorable par défaut (les invisibles), ni séparateur de ligne. */
const logText = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max && !/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u.test(v) ? v : null

/** L'id d'une entrée du fichier de coordination (`isEntryId` de `coordination.ts`, que ce module n'importe pas). */
const isEntryRef = (v: unknown): v is string => typeof v === 'string' && /^c[a-z0-9]{6,24}$/.test(v)

/** Une ligne relue, réduite à ses champs ; null quand elle est mal formée (elle est gardée telle quelle, jamais montrée). */
const soundLogLine = (raw: unknown): NightLogLine | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  const act = logText(x.act, 40)
  const why = logText(x.why, 400)
  const result = logText(x.result, 400)
  if (!isTime(x.at) || !isNightId(x.watch) || act === null || !/^[A-Za-z]+$/.test(act) || why === null || result === null) return null
  if (x.mission !== undefined && !isSafeId(x.mission)) return null
  if (x.group !== undefined && logText(x.group, 40) === null) return null
  if (x.entry !== undefined && !isEntryRef(x.entry)) return null
  return { at: x.at, watch: x.watch, act, ...(x.mission !== undefined ? { mission: x.mission as string } : {}), ...(x.group !== undefined ? { group: x.group as string } : {}), why, result, ...(x.entry !== undefined ? { entry: x.entry as string } : {}) }
}

/** La lecture du journal : absent (vide), illisible (rien ne s'écrit par-dessus, le résumé le dit), ou ses lignes, telles qu'écrites. */
export type NightLogRead = { state: 'absent' } | { state: 'unread' } | { state: 'read'; lines: string[] }

/**
 * Lit le texte du journal : une ligne JSON par geste. Une ligne qui ne se lit pas en JSON (une écriture coupée)
 * rend tout le journal illisible : il n'est alors jamais réécrit.
 */
export const parseNightLog = (text: string): NightLogRead => {
  const lines = text.split('\n').filter(l => l.trim() !== '')
  for (const l of lines) {
    try {
      JSON.parse(l)
    } catch {
      return { state: 'unread' }
    }
  }
  return { state: 'read', lines }
}

/** Le journal avec une ligne de plus, borné : les plus anciennes lignes sortent au-delà de `max` ; rien d'autre ne change. */
export const appendNightLog = (lines: readonly string[], line: NightLogLine, max = NIGHT_LOG_MAX): string[] => [...lines, JSON.stringify(line)].slice(-Math.max(1, max))

/** Les résultats déjà recopiés au journal (« <entrée>:<résultat> ») : chacun l'est une fois, un refus de l'app venu après l'envoi aussi. */
export const nightLogEntries = (lines: readonly string[]): Set<string> =>
  new Set(
    lines.flatMap(l => {
      try {
        const x = soundLogLine(JSON.parse(l))
        return x?.entry !== undefined ? [`${x.entry}:${x.result}`] : []
      } catch {
        return []
      }
    }),
  )

/** Les coupures de l'auto écrites pendant une surveillance, avec l'id de leur entrée et leur mission, dans l'ordre du journal. */
export const nightCutsWritten = (lines: readonly string[]): NightLogLine[] =>
  lines.flatMap(l => {
    try {
      const x = soundLogLine(JSON.parse(l))
      return x && x.act === 'cutAuto' && x.result === 'written' && x.entry !== undefined && x.mission !== undefined ? [x] : []
    } catch {
      return []
    }
  })

// ─── Résultats des gestes de nuit ──────────────────────────────────────────
//
// Le mod d'une mission applique un geste de nuit ; seul le mod du COO écrit le journal. Le résultat passe par un
// fichier par mission, à côté du fichier de coordination, écrit par le seul mod de cette mission, et que le mod
// du COO recopie au journal une fois par entrée.

/** Au plus, les résultats gardés par mission ; les plus anciens sortent au-delà. */
const NIGHT_RESULTS_MAX = 200

/** Le résultat d'un geste de nuit appliqué (ou refusé) par le mod d'une mission : son entrée, sa surveillance, quand, quoi, pourquoi. */
export type NightResult = { entry: string; watch: string; at: number; act: string; group?: string; result: string; why: string }

/** Un résultat relu, réduit à ses champs ; null quand il est mal formé. */
const soundNightResult = (raw: unknown): NightResult | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  const act = logText(x.act, 40)
  const result = logText(x.result, 40)
  const why = logText(x.why, 400)
  if (!isEntryRef(x.entry) || !isNightId(x.watch) || !isTime(x.at) || act === null || !/^[A-Za-z]+$/.test(act) || result === null || why === null) return null
  if (x.group !== undefined && logText(x.group, 40) === null) return null
  return { entry: x.entry, watch: x.watch, at: x.at, act, ...(x.group !== undefined ? { group: x.group as string } : {}), result, why }
}

/** Le fichier des résultats d'une mission, relu : ceux qui se lisent, d'elle seule ; illisible, il n'est jamais réécrit. */
export const parseNightResults = (text: string, run: string): { state: 'read'; results: NightResult[] } | { state: 'unread' } => {
  if (text.trim() === '') return { state: 'read', results: [] }
  try {
    const x = JSON.parse(text) as Record<string, unknown>
    if (x === null || typeof x !== 'object' || x.v !== 1 || x.run !== run || !Array.isArray(x.results)) return { state: 'unread' }
    return { state: 'read', results: x.results.flatMap(r => soundNightResult(r) ?? []) }
  } catch {
    return { state: 'unread' }
  }
}

/** Le texte du fichier des résultats avec un résultat de plus (un seul par entrée), borné. */
export const nightResultsText = (run: string, results: readonly NightResult[], r: NightResult): string =>
  JSON.stringify({ v: 1, run, results: [...results.filter(x => x.entry !== r.entry), r].slice(-NIGHT_RESULTS_MAX) })

/** Les lignes bien formées d'une surveillance, dans l'ordre du journal. */
export const nightLogOf = (lines: readonly string[], watch: string): NightLogLine[] =>
  lines.flatMap(l => {
    try {
      const x = soundLogLine(JSON.parse(l))
      return x && x.watch === watch ? [x] : []
    } catch {
      return []
    }
  })

// ─── Réouverture et résumé du matin ────────────────────────────────────────

/**
 * La commande qui rouvre la nuit une mission en auto arrêtée (décision R33) : `claude --bg --resume <id>` relance la
 * discussion de la mission elle-même (`session` : la discussion qui la tient, ou où elle est née), jamais une session
 * neuve (une mission ne vit que dans sa discussion, choix de Mathis du 09/11/2026). Ce que fait `--resume` d'une
 * discussion qui tourne encore, ou née dans un autre dossier (un worktree), reste à confirmer ; une discussion qui
 * tient une autre mission n'en reçoit pas (`nightReopensNow`). Son premier message ne cite que l'id contrôlé :
 * reprendre la mission par `{"resume": "<id>"}` (permis dans sa discussion), en manuel, son auto éteint (la nuit ne
 * rallume jamais l'auto). Null pour un id de mission ou de discussion hors forme sûre.
 */
export const reopenCommand = (id: unknown, session: unknown): string | null => {
  if (!isSafeId(id) || !isSafeId(session)) return null
  // Sans apostrophe : aucune ne ferme la citation POSIX de `shellQuote`.
  const prompt = `Reprends la mission ${id} du tableau de bord : commence par appeler flow avec {"resume": "${id}"}, puis continue cette mission là où elle en est, en manuel. Son auto reste éteint : ne pas allumer, la personne le fera depuis la vue Coordination.`
  return `claude --bg --resume ${shellQuote(session)} ${shellQuote(prompt)}`
}

/**
 * Ce que le relevé dit d'une mission à rouvrir : la commande à lancer (`cli`, dans le CLI), pour le matin (`app` :
 * l'app Desktop), pas encore (`unseen` : la discussion pas encore dessinée, sa surface inconnue), déjà rouverte
 * pendant cette surveillance (`done`), ou sans commande
 * (`unsafe` : son id n'a pas la forme sûre ; `unread` : le journal ne se lit pas, une réouverture déjà faite ne se
 * distinguerait pas).
 */
export type NightReopen = { how: 'cli'; command: string } | { how: 'app' } | { how: 'unseen' } | { how: 'done' } | { how: 'unsafe' } | { how: 'unread' } | { how: 'busy' }

/** Le résumé de la nuit : la surveillance arrêtée (son id, l'heure et la cause de l'arrêt), ses lignes du journal, ou un journal illisible. */
export type NightMorning = { watch: string; at: number; why: NightStop } & ({ lines: NightLogLine[] } | { unread: true })

// ─── Blocages de la nuit ───────────────────────────────────────────────────
//
// Ce que le mod du COO voit bloqué, pendant la surveillance, dans les missions en auto, chacun avec le geste de
// nuit qui le lève : il réveille la discussion du COO, et la section « Nuit » de son relevé les liste.

/** Les gestes de nuit qui lèvent un blocage (la coupure de l'auto n'en lève aucun). */
export type NightBlockAct = 'wave' | 'resend' | 'relaunch' | 'reopen' | 'force'

/**
 * Un blocage d'une mission en auto et le geste de nuit qui le lève : le groupe visé (`group`), la question
 * du mod (`question`, pour `resend` et `relaunch`), les groupes des autres missions qui le retiennent, tous (`awaited`, pour `force`).
 */
export type NightBlock = { mission: string; title: string; act: NightBlockAct; group?: string; question?: string; awaited?: { mission: string; group: string; on?: 'plan' }[] }

/** Un worker se tient pour fini quand, après un signe sûr de fin (fin de session, compte rendu), sa dernière date relayée a plus que ce délai. */
export const NIGHT_DEAD_MS = 30 * 60_000

/**
 * Ce que la relecture lit déjà, mission par mission, réduit à ce dont les blocages ont besoin : l'auto allumé
 * (`isAuto`) ou mis en pause par le mod (`isPaused`), la mission ouverte quelque part (`isOpen`), ses groupes aux
 * tickets pas tous faits (`hasOpenGroups`), ses questions (avec le groupe qu'elles bloquent), les groupes que sa
 * vague propose sans qu'ils partent (`waveDue`), ses retenues (son unité retenue, l'unité d'une autre mission qui la tient).
 */
export type NightMissionView = {
  id: string
  title: string
  isAuto: boolean
  isPaused: boolean
  isOpen: boolean
  /** En pause sur un groupe revenu trop de fois (`isRelaunchPause`) : la relance y vaut encore. */
  isRelaunchPause: boolean
  /** Les groupes qu'une question de la personne bloque (pas une question du mod) : aucun geste de nuit ne les lance. */
  heldByUser: readonly string[]
  hasOpenGroups: boolean
  questions: readonly { id: string; group?: string }[]
  waveDue: readonly string[]
  holds: readonly { held: string; mission: string; group: string; isPlan: boolean }[]
}

/**
 * Les blocages des missions en auto, dans l'ordre des missions : un groupe de la vague en cours qui ne part pas
 * (`wave`, l'auto allumé), une question « sans-suite: » (`resend`, l'auto allumé) ou « relance: » d'un groupe (`relaunch`),
 * celle-ci l'auto allumé ou dans la pause d'un groupe revenu trop de fois, une mission en auto arrêtée avec des groupes
 * ouverts et ouverte nulle part (`reopen`), un groupe d'une mission dont l'auto est allumé dont chaque retenue (8 au
 * plus) est tenue par un groupe d'une mission ouverte nulle part dont le worker a fini depuis plus de 30 minutes
 * (`force`, un blocage pour toutes ses retenues). `deadSince` : pour le groupe d'une mission, la date relayée la plus
 * récente après un signe sûr de fin, absente sans signe sûr (une supposition ne force rien).
 */
export const nightBlocks = (missions: readonly NightMissionView[], deadSince: (mission: string, group: string) => number | undefined, now: number): NightBlock[] => {
  const out: NightBlock[] = []
  const byId = new Map(missions.map(m => [m.id, m]))
  for (const m of missions) {
    if (!m.isAuto && !m.isPaused) continue
    const at = { mission: m.id, title: m.title }
    // Un groupe qu'une question de la personne bloque ne part pas la nuit, ni par la vague, ni relancé, ni forcé.
    const isFree = (g: string) => !m.heldByUser.includes(g)
    if (m.isAuto) for (const g of m.waveDue.filter(isFree)) out.push({ ...at, act: 'wave', group: g })
    // Renvoyer fait repartir l'auto : seulement une mission dont l'auto est allumé. Relancer un groupe revenu trop
    // souvent, aussi dans la pause que pose ce retour (« deuxième échec du groupe »), comme « ↗ Worker ».
    for (const q of m.questions) {
      if (q.id.startsWith('sans-suite:') && m.isAuto) out.push({ ...at, act: 'resend', question: q.id, ...(q.group !== undefined ? { group: q.group } : {}) })
      else if (q.id.startsWith('relance:') && q.group !== undefined && isFree(q.group) && (m.isAuto || m.isRelaunchPause)) out.push({ ...at, act: 'relaunch', question: q.id, group: q.group })
    }
    if (m.isPaused && !m.isOpen && m.hasOpenGroups) out.push({ ...at, act: 'reopen' })
    // Forcer fait partir un groupe d'une mission dont l'auto est allumé, comme la vague.
    if (!m.isAuto) continue
    // Une paire retenue par le plan et par un fichier n'est qu'un blocage : son forçage lève les deux (`on` absent).
    const pairs = new Map<string, { held: string; mission: string; group: string; isPlan: boolean }>()
    for (const h of m.holds) {
      const key = JSON.stringify([h.held, h.mission, h.group])
      pairs.set(key, { ...h, isPlan: (pairs.get(key)?.isPlan ?? true) && h.isPlan })
    }
    // Un groupe retenu ne se force que si chacune de ses retenues remplit les conditions : un seul blocage, toutes ses paires.
    const byHeld = new Map<string, { mission: string; group: string; isPlan: boolean }[]>()
    for (const h of pairs.values()) byHeld.set(h.held, [...(byHeld.get(h.held) ?? []), h])
    for (const [held, list] of byHeld) {
      const isDead = (h: { mission: string; group: string }) => {
        const holder = byId.get(h.mission)
        const since = deadSince(h.mission, h.group)
        return holder !== undefined && !holder.isOpen && isNightGroup(h.group) && since !== undefined && now - since > NIGHT_DEAD_MS
      }
      if (!isNightGroup(held) || !isFree(held) || list.length > NIGHT_FORCE_PAIRS_MAX || !list.every(isDead)) continue
      out.push({ ...at, act: 'force', group: held, awaited: list.map(h => ({ mission: h.mission, group: h.group, ...(h.isPlan ? { on: 'plan' as const } : {}) })) })
    }
  }
  return out
}

/** Au plus, les retenues qu'un même forçage de nuit lève (le format de l'entrée `night` les borne aussi). */
export const NIGHT_FORCE_PAIRS_MAX = 8

/** Un groupe qu'un geste de nuit peut viser : un id de groupe, jamais le lot sans groupes (`*`). */
const isNightGroup = (g: string): boolean => g !== '*'

/** L'empreinte d'un ensemble de blocages : le même ensemble, dans n'importe quel ordre, a la même ; vide sans blocage. */
export const nightBlocksPrint = (blocks: readonly NightBlock[]): string =>
  [...new Set(blocks.map(b => JSON.stringify([b.mission, b.act, b.group ?? '', b.question ?? '', (b.awaited ?? []).map(a => `${a.mission}/${a.group}`).sort()])))].sort().join('|')

/** Le texte fixe du réveil de nuit, sans aucune valeur venue d'ailleurs. */
export const NIGHT_WAKE_TEXT = "Surveillance de nuit : relis ton relevé et débloque ce qui peut l'être, avec les seuls gestes de nuit."

/** Au plus un réveil de nuit par ce délai. */
export const NIGHT_WAKE_MS = 10 * 60_000

/** Les ensembles de blocages signalés qu'une surveillance retient, les plus anciens sortant au-delà. */
const NIGHT_WAKE_PRINTS_MAX = 200

/** Ce que le COO a déjà signalé pendant une surveillance : ses ensembles de blocages, et l'heure du dernier réveil. */
export type NightWakes = { watch: string; prints: readonly string[]; at: number }

/**
 * Faut-il réveiller la discussion du COO ? Seulement pendant une surveillance valide (`watch` : son id, null
 * sinon), hors d'un tour, au plus une fois par 10 minutes, et pour un ensemble de blocages non vide qu'aucun
 * réveil de cette surveillance n'a déjà signalé tel quel (`last`).
 */
export const isNightWakeDue = (o: { watch: string | null; isTurnOpen: boolean; print: string; last: NightWakes | null; now: number }): boolean => {
  if (o.watch === null || o.isTurnOpen || o.print === '') return false
  if (o.last === null || o.last.watch !== o.watch) return true
  return !o.last.prints.includes(o.print) && o.now - o.last.at >= NIGHT_WAKE_MS
}

/** Le réveil de nuit noté : son ensemble ajouté à ceux de la même surveillance (une autre repart de zéro). */
export const withNightWake = (last: NightWakes | null, watch: string, print: string, now: number): NightWakes => ({
  watch,
  prints: [...(last?.watch === watch ? last.prints.filter(p => p !== print) : []), print].slice(-NIGHT_WAKE_PRINTS_MAX),
  at: now,
})
