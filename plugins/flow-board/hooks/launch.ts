// La carte de lancement du COO : le Claude du COO propose de lancer une mission (titre, point de départ
// d'après ask-matt, mode, effort, dossier `travail/<sujet>/`), la personne clique, et le mod écrit un
// enregistrement de lancement dans son stockage (`$.store`) ; la nouvelle discussion le consomme à son
// premier appel de l'outil `flow`, et sa mission se rattache à la carte.
//
// Module pur, sans import du modèle : `register.tsx` écrit et relit l'enregistrement, ce module dit sa
// forme, ce qu'une carte montre et pourquoi une consommation est refusée.
//
// Invariant : « Une carte ne lance qu'une mission ; un enregistrement de lancement n'est consommé qu'une
// fois, par une seule discussion, dans les 10 minutes. » La garde, décidée avec la personne : l'enregistrement
// porte la marque de la discussion qui le prend, relue 1,5 s plus tard ; la mission lancée porte l'id de
// l'enregistrement (`Run.launch`, posé une fois), et un id déjà porté par une mission du fichier des
// missions est refusé ; seule une mission créée après le clic peut le consommer.

import type { Run, RunLaunch } from '../types'
import { clip, isTime } from './basics.ts'
import { isSafeId } from './closing.ts'
import { isRoadmapId } from './roadmap.ts'

export type { RunLaunch }

/** Au-delà, un enregistrement de lancement est périmé : il ne se consomme plus, et s'efface au clic ou au chargement suivant. */
export const LAUNCH_TTL_MS = 10 * 60_000

/**
 * Une carte en « lancement en cours » revient un peu après la péremption de son enregistrement : une
 * mission consommée juste avant la péremption a le temps d'arriver au fichier des missions relu.
 */
export const LAUNCH_GRACE_MS = 60_000

/** Une date de clic venue d'ailleurs ne vaut pas au-delà de cette avance sur l'horloge d'ici. */
const CLOCK_SKEW_MS = 60_000

/** Ce que dit une mission qui n'a pas pu consommer son lancement : elle reste en manuel. */
export const LAUNCH_STALE = "Accord de lancement périmé : la mission est en manuel, allume l'auto ici si tu veux"

/** Le temps qu'une discussion laisse à une autre, après avoir pris l'enregistrement à son nom, avant de relire. */
export const LAUNCH_CLAIM_SETTLE_MS = 1500

/** La clé d'un enregistrement de lancement dans le stockage du mod. */
export const launchKey = (id: string): string => `coo-launch:${id}`
export const LAUNCH_KEY_PREFIX = 'coo-launch:'

/** Les points de départ d'une mission que la carte propose : les skills d'ask-matt qui ouvrent une mission. */
export const LAUNCH_STARTS = ['grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'tdd', 'diagnosing-bugs', 'triage', 'improve-codebase-architecture', 'code-review', 'research', 'to-questionnaire', 'wizard', 'prototype'] as const
export type LaunchStart = (typeof LAUNCH_STARTS)[number]
const isStart = (v: unknown): v is LaunchStart => typeof v === 'string' && (LAUNCH_STARTS as readonly string[]).includes(v)

/**
 * Le départ d'une rétro proposée par le mod du COO à la livraison d'une mission : jamais par Claude (le champ
 * `card` le refuse), toujours avec l'id de la mission close (`of`).
 */
export const RETRO_START = 'retro'
export type CardStart = LaunchStart | typeof RETRO_START

/** Le départ et la mission close d'une carte, d'un enregistrement ou d'un rattachement relus : une rétro porte son `of`, un autre départ jamais. */
const startOf = (start: unknown, of: unknown): { start: CardStart; of?: string } | null =>
  isStart(start) && of === undefined ? { start } : start === RETRO_START && isSafeId(of) ? { start: RETRO_START, of } : null

export type LaunchMode = 'auto' | 'manual'
export type LaunchEffort = 'medium' | 'high' | 'xhigh'
const EFFORTS: readonly LaunchEffort[] = ['medium', 'high', 'xhigh']

/** Une carte de lancement, gardée par la discussion du COO (`$.state`), recalculée à chaque envoi de Claude. */
export type LaunchCard = {
  id: string
  title: string
  /** L'idée de la feuille de route qu'elle lance, par son id. */
  idea?: string
  start: CardStart
  /** Une rétro : l'id de la mission close qu'elle étudie, posé par le mod du COO. */
  of?: string
  /** La ligne d'ask-matt qui justifie le départ, telle que Claude l'a citée (une rétro : pourquoi elle est recommandée ou non). */
  askMatt: string
  /** Les autres départs possibles, que la personne peut choisir avant de cliquer. */
  alts: LaunchStart[]
  mode: LaunchMode
  modeWhy: string
  effort: LaunchEffort
  effortWhy: string
  /** Le sujet du dossier de la mission : `travail/<folder>/` du projet. */
  folder: string
  at: number
  /** Le dernier clic : l'id de son enregistrement, sa date, son mode. */
  launch?: { id: string; at: number; mode: LaunchMode }
}

/** L'enregistrement de lancement, écrit par le clic dans le stockage du mod, consommé une fois par la nouvelle discussion. */
export type LaunchRecord = {
  v: 1
  id: string
  card: string
  root: string
  title: string
  start: CardStart
  /** Une rétro : l'id de la mission close. */
  of?: string
  mode: LaunchMode
  effort: LaunchEffort
  folder: string
  at: number
  /** La discussion du clic. */
  by: string
  /** La discussion qui l'a pris à son nom, en train de le consommer. */
  claim?: { by: string; at: number }
}

/** L'id d'un enregistrement : `l` puis 8 à 24 lettres minuscules ou chiffres. */
export const isLaunchId = (v: unknown): v is string => typeof v === 'string' && /^l[a-z0-9]{8,24}$/.test(v)

/** Un id neuf, d'après la date et un tirage (`rand` dans [0, 1)). */
export const newLaunchId = (now: number, rand: number): string =>
  `l${Math.max(0, Math.floor(now)).toString(36)}${Math.floor(Math.min(Math.max(rand, 0), 0.999999) * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`.slice(0, 25)

/** L'id d'une carte : `k` puis 6 à 24 lettres minuscules ou chiffres. */
export const isCardId = (v: unknown): v is string => typeof v === 'string' && /^k[a-z0-9]{6,24}$/.test(v)

/** Le sujet du dossier d'une mission : lettres, chiffres et tirets (jamais `..` ni `/`), 60 au plus. */
export const isFolderName = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(v) && v.length <= 60

/** Un texte de la carte : sur une ligne, coupé. */
const line = (v: unknown, max: number): string => (typeof v === 'string' ? clip(v.replace(/\s+/g, ' ').trim(), max) : '')

/**
 * La carte que propose Claude (le champ `card` de l'outil `flow`), contrôlée : un départ de la liste, un
 * mode et un effort connus, jamais xhigh en auto, un dossier en forme. Rend la carte, ou la raison du refus.
 */
export const parseCard = (raw: unknown, now: number, id: string, isMod = false): { card: LaunchCard } | { refused: string } => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { refused: '"card" must be a JSON object' }
  const x = raw as Record<string, unknown>
  const title = line(x.title, 70)
  if (title === '') return { refused: 'the card has no title' }
  // Une rétro (`of` compris) ne vient que du mod ; une carte de Claude ne porte jamais `of`.
  const started = isMod ? startOf(x.start, x.of) : isStart(x.start) ? { start: x.start } : null
  if (!started) return { refused: `"start" must be one of ${LAUNCH_STARTS.join(', ')}` }
  const askMatt = line(x.askMatt, 240)
  if (askMatt === '') return { refused: '"askMatt" must quote the line of ask-matt that justifies the start (read it first)' }
  if (x.mode !== 'auto' && x.mode !== 'manual') return { refused: '"mode" must be "auto" or "manual"' }
  if (!EFFORTS.includes(x.effort as LaunchEffort)) return { refused: '"effort" must be "medium", "high" or "xhigh"' }
  if (x.mode === 'auto' && x.effort === 'xhigh') return { refused: 'xhigh is never proposed for a mission in auto: high at most' }
  if (!isFolderName(x.folder)) return { refused: `"folder" must be the subject of travail/<subject>/: letters, digits and dashes only (no "/", no ".."); ask the user for one` }
  if (x.idea !== undefined && !isRoadmapId(x.idea)) return { refused: '"idea" must be the id of an idea of the roadmap, as the COO statement gives it' }
  const alts = (Array.isArray(x.alts) ? x.alts : []).filter(isStart).filter((s, i, all) => s !== x.start && all.indexOf(s) === i).slice(0, 4)
  return {
    card: {
      id,
      title,
      ...(typeof x.idea === 'string' ? { idea: x.idea } : {}),
      start: started.start,
      ...(started.of ? { of: started.of } : {}),
      askMatt,
      alts,
      mode: x.mode,
      modeWhy: line(x.modeWhy, 160),
      effort: x.effort as LaunchEffort,
      effortWhy: line(x.effortWhy, 160),
      folder: x.folder,
      at: now,
    },
  }
}

/** Une carte relue de l'état de la discussion : seulement en forme ; null sinon. */
export const soundCard = (raw: unknown): LaunchCard | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (!isCardId(x.id) || !isTime(x.at)) return null
  const parsed = parseCard(x, x.at, x.id, true)
  if ('refused' in parsed) return null
  const l = x.launch as Record<string, unknown> | undefined
  const launch = l && isLaunchId(l.id) && isTime(l.at) && (l.mode === 'auto' || l.mode === 'manual') ? { id: l.id, at: l.at, mode: l.mode as LaunchMode } : undefined
  return { ...parsed.card, ...(launch ? { launch } : {}) }
}

/** Un enregistrement relu du stockage : seulement en forme ; null sinon (il ne se consomme pas). */
export const soundRecord = (raw: unknown): LaunchRecord | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  const started = startOf(x.start, x.of)
  if (x.v !== 1 || !isLaunchId(x.id) || !isCardId(x.card) || typeof x.root !== 'string' || !started || (x.mode !== 'auto' && x.mode !== 'manual')) return null
  if (!EFFORTS.includes(x.effort as LaunchEffort) || !isFolderName(x.folder) || !isTime(x.at) || !isSafeId(x.by) || typeof x.title !== 'string') return null
  const c = x.claim as Record<string, unknown> | undefined
  const claim = c && isSafeId(c.by) && isTime(c.at) ? { by: c.by, at: c.at } : undefined
  if (x.claim !== undefined && !claim) return null
  return { v: 1, id: x.id, card: x.card, root: x.root, title: clip(x.title, 70), start: started.start, ...(started.of ? { of: started.of } : {}), mode: x.mode, effort: x.effort as LaunchEffort, folder: x.folder, at: x.at, by: x.by, ...(claim ? { claim } : {}) }
}

/** Le rattachement d'une mission relu du fichier des missions : seulement en forme ; null sinon. */
export const soundRunLaunch = (raw: unknown): RunLaunch | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  const started = startOf(x.start, x.of)
  if (!isLaunchId(x.id) || !isCardId(x.card) || !isTime(x.at) || !isFolderName(x.folder) || !started || (x.mode !== 'auto' && x.mode !== 'manual')) return null
  if (x.lostAt !== undefined && !isTime(x.lostAt)) return null
  return { id: x.id, card: x.card, at: x.at, folder: x.folder, start: started.start, ...(started.of ? { of: started.of } : {}), mode: x.mode, ...(isTime(x.lostAt) ? { lostAt: x.lostAt } : {}) }
}

/**
 * Le rattachement qui compte d'une mission : en forme, et pas perdu (une autre mission, qui le précède,
 * porte le même lancement ou la même carte). Un rattachement présent mais hors forme compte aussi comme
 * posé pour la consommation (la mission ne prend jamais un second lancement), jamais pour la carte.
 */
export const liveLaunchOf = (run: Run): RunLaunch | null => {
  const l = soundRunLaunch(run.launch)
  return l && l.lostAt === undefined ? l : null
}

/** Deux sujets de dossier désignent le même dossier (macOS et Windows ne tiennent pas compte de la casse). */
export const sameFolder = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** L'enregistrement est périmé (ou daté loin dans le futur) à cet instant. */
export const isRecordStale = (r: { at: number }, now: number): boolean => now - r.at >= LAUNCH_TTL_MS || r.at > now + CLOCK_SKEW_MS

/** La mission du fichier des missions qui porte déjà cet enregistrement, cette carte, ou ce dossier. */
export const runOfLaunch = (runs: readonly Run[], id: string): Run | undefined => runs.find(r => liveLaunchOf(r)?.id === id)
export const runOfCard = (runs: readonly Run[], card: string, folder?: string): Run | undefined =>
  runs.find(r => {
    const l = liveLaunchOf(r)
    return l !== null && (l.card === card || (folder !== undefined && sameFolder(l.folder, folder)))
  })

/**
 * Une autre mission que `self` qui porte, vivant, le même lancement, la même carte ou le même dossier que
 * `launch`. La règle est à sens unique : la mission qui en voit une autre perd (au pire les deux perdent et
 * restent en manuel, jamais les deux gagnent).
 */
export const otherCarrierOf = (runs: readonly Run[], launch: RunLaunch, self: string): Run | undefined =>
  runs.find(r => {
    if (r.id === self) return false
    const l = liveLaunchOf(r)
    return l !== null && (l.id === launch.id || l.card === launch.card || sameFolder(l.folder, launch.folder))
  })

/** Où en est une carte, d'après le fichier des missions relu : prête, en lancement, ou lancée (sa mission). */
export type CardState = { kind: 'ready' } | { kind: 'launching'; mode: LaunchMode } | { kind: 'launched'; run: { id: string; title: string } }

export const cardStateOf = (card: LaunchCard, runs: readonly Run[], now: number): CardState => {
  // Une mission qui porte la carte, ou son dossier (une carte reproposée après un redémarrage a un autre id) : lancée.
  const run = runOfCard(runs, card.id, card.folder)
  if (run) return { kind: 'launched', run: { id: run.id, title: run.title } }
  if (card.launch && now - card.launch.at < LAUNCH_TTL_MS + LAUNCH_GRACE_MS) return { kind: 'launching', mode: card.launch.mode }
  return { kind: 'ready' }
}

/**
 * Pourquoi la mission `run` ne consomme pas l'enregistrement `record` (null : elle le peut). Contrôlés :
 * le même projet, pas périmé, pas déjà porté par une mission du fichier des missions, la mission pas déjà
 * rattachée, et créée après le clic.
 */
export const consumeRefusal = (record: LaunchRecord | null, run: Run, runs: readonly Run[], root: string, now: number): string | null => {
  if (run.launch !== undefined) return 'attached'
  if (!record) return 'unknown'
  if (record.root !== root) return 'unknown'
  if (isRecordStale(record, now)) return 'stale'
  // Déjà porté par une mission : ce lancement, sa carte, ou son dossier (une carte ne lance qu'une mission).
  if (runOfLaunch(runs, record.id) || runOfCard(runs, record.card, record.folder)) return 'consumed'
  // Seule une mission ouverte après le clic (le COO et la mission tournent sur le même poste, à la même horloge) :
  // une mission plus ancienne qui recevrait l'id ne s'en sert pas.
  if (run.startedAt < record.at) return 'older'
  return null
}

/**
 * Les chemins possibles du skill ask-matt d'après le registre des plugins de Claude Code
 * (`<home>/plugins/installed_plugins.json`, relu tel quel) : l'`installPath` de chaque installation de
 * `mattpocock-skills`, seulement sous `<home>/plugins/` et sans « .. ». L'appelant garde le premier qui existe.
 */
export const askMattCandidates = (raw: unknown, home: string): string[] => {
  const plugins = raw !== null && typeof raw === 'object' ? (raw as { plugins?: unknown }).plugins : undefined
  if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) return []
  const out: string[] = []
  for (const [key, list] of Object.entries(plugins as Record<string, unknown>)) {
    if (!key.startsWith('mattpocock-skills@') || !Array.isArray(list)) continue
    for (const one of list) {
      const path = one !== null && typeof one === 'object' ? (one as { installPath?: unknown }).installPath : undefined
      const install = typeof path === 'string' ? path.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      if (!install.startsWith(`${home}/plugins/`) || install.split('/').includes('..')) continue
      out.push(`${install}/skills/engineering/ask-matt/SKILL.md`)
    }
  }
  return out
}

/** La carte, dite à Claude dans le relevé du COO (textes de Claude, neutralisés par l'appelant). */
export const cardStatus = (s: CardState): string => (s.kind === 'launched' ? 'launched' : s.kind === 'launching' ? `launching (${s.mode})` : 'ready')
