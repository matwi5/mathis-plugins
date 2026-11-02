// Les décisions opposées entre missions : le relevé, par le code, des décisions nouvelles de chaque
// mission non archivée depuis le relevé précédent ; le Claude du COO juge si deux portent sur le même sujet
// et s'opposent (c'est du texte), et le mod de la mission qui a décidé en second pose la question.
//
// Invariant : « Deux décisions opposées de deux missions ne passent jamais sans question à l'utilisateur ;
// une décision n'est marquée "remplacée" que sur sa réponse. »

import type { Run } from '../types'
import { neutralLine } from './closing.ts'
import { OPPOSITION_PREFIX } from './model.ts'

/** Une série du `DECISIONS.md` d'une mission : son numéro, son titre, sa ligne et l'empreinte de son contenu. */
export type DecisionSeries = { n: number; title: string; line: number; print: string }

/**
 * Une décision d'une mission, telle que le relevé la montre : sa source (une série ou un choix déclaré), son texte,
 * sa date quand on la connaît (un choix déclaré), et sa clé : ce qui l'identifie, contenu compris.
 */
export type NewDecision = { mission: string; title: string; ref: string; text: string; at: number | null; key: string }

/** Ce que le COO a déjà relevé d'une mission : les clés des décisions montrées. */
export type DecisionsSeen = Record<string, { keys: string[] }>

/** Le plus de clés gardées vues par mission, et de décisions nouvelles montrées par relevé. */
const SEEN_MAX = 800
export const NEW_MAX = 30

/** L'empreinte d'un texte : une somme de 32 bits et sa longueur (la clé d'une décision, pas une protection). */
export const printOf = (text: string): string => {
  let h = 5381
  for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0
  return `${h.toString(36)}.${text.length.toString(36)}`
}

/** Les séries d'un `DECISIONS.md` : chaque titre « ## Série N — titre » (ou « ## Série N : titre »), avec sa ligne et l'empreinte de son contenu. */
export const seriesOf = (text: string): DecisionSeries[] => {
  const lines = text.split(/\r?\n/)
  const heads: { n: number; title: string; at: number }[] = []
  for (const [i, line] of lines.entries()) {
    const m = /^##\s+Série\s+(\d{1,6})\b\s*(?:[—:–-]\s*)?(.*)$/.exec(line)
    if (m) heads.push({ n: Number(m[1]), title: m[2]!.trim().slice(0, 200), at: i })
  }
  // Le contenu d'une série court jusqu'au titre de niveau 2 suivant, sans ses lignes vides de fin : une décision ajoutée
  // sous une série déjà vue la fait revenir, une série ajoutée après elle non.
  const level2 = lines.flatMap((l, i) => (/^##\s/.test(l) ? [i] : []))
  return heads.map(h => {
    let stop = level2.find(i => i > h.at) ?? lines.length
    while (stop > h.at + 1 && lines[stop - 1]!.trim() === '') stop -= 1
    return { n: h.n, title: h.title, line: h.at + 1, print: printOf(lines.slice(h.at, stop).join('\n')) }
  })
}

/** La date d'un choix déclaré, en minutes UTC ; rien pour une date hors forme. */
const minuteOf = (at: number): string => (Number.isFinite(at) && at >= 0 && at < 8.64e15 ? `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'date inconnue')

/**
 * Les décisions nouvelles d'une mission depuis le relevé précédent : ses séries jamais vues à ce contenu
 * (`file`, le chemin de son `DECISIONS.md` depuis la racine) et ses choix déclarés jamais vus, reconnus à leur
 * date et leur texte (un choix relayé plus tard avec une date plus ancienne n'est pas sauté).
 */
export const newDecisionsOf = (run: Run, file: string | null, series: readonly DecisionSeries[], seen: DecisionsSeen[string] | undefined): NewDecision[] => {
  const known = new Set(seen?.keys ?? [])
  const out: NewDecision[] = []
  for (const s of series) {
    const key = `s:${s.n}:${s.print}`
    if (!known.has(key)) out.push({ mission: run.id, title: run.title, ref: `${file ?? 'DECISIONS.md'}:${s.line} (série ${s.n})`, text: s.title, at: null, key })
  }
  for (const d of Array.isArray(run.decided) ? run.decided : []) {
    if (typeof d?.what !== 'string' || typeof d.at !== 'number') continue
    const key = `c:${d.at}:${printOf(d.what)}`
    if (!known.has(key)) out.push({ mission: run.id, title: run.title, ref: `choix déclaré du ${minuteOf(d.at)}`, text: d.what, at: d.at, key })
  }
  return out
}

/** Ce qu'un relevé a montré, marqué vu, et cela seulement (une décision au-delà du plafond, ou arrivée depuis, revient au relevé suivant). */
export const markSeen = (seen: DecisionsSeen, shown: readonly NewDecision[]): DecisionsSeen => {
  const out: DecisionsSeen = { ...seen }
  for (const id of new Set(shown.map(d => d.mission))) {
    const before = out[id]?.keys ?? []
    out[id] = { keys: [...new Set([...before, ...shown.filter(d => d.mission === id).map(d => d.key)])].slice(-SEEN_MAX) }
  }
  return out
}

/** Relit ce qui est vu : null quand la forme est fausse (le relevé reprend alors tout, une question de trop plutôt qu'une opposition qui passe). */
export const parseSeen = (raw: unknown): DecisionsSeen | null => {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: DecisionsSeen = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const x = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null
    if (!x || !Array.isArray(x.keys)) return null
    out[id] = { keys: x.keys.filter((k): k is string => typeof k === 'string' && k.length <= 80).slice(-SEEN_MAX) }
  }
  return out
}

/** Une décision citée par une contradiction : sa mission, sa source et son texte mot pour mot. */
export type OpposedSide = { mission: string; ref: string; text: string }

/**
 * La question que le mod de la mission qui a décidé en second pose sur sa phase en cours : les deux
 * décisions mot pour mot, avec leur source, les titres et les textes neutralisés (une ligne chacun).
 */
export const contradictionQuestion = (mine: OpposedSide, theirs: OpposedSide & { title: string }, subject: string): string =>
  `Décision opposée à celle de la mission « ${neutralLine(theirs.title).slice(0, 60)} » sur ${neutralLine(subject).slice(0, 80)} : ici « ${neutralLine(mine.text).slice(0, 300)} » (${neutralLine(mine.ref).slice(0, 120)}) ; là-bas « ${neutralLine(theirs.text).slice(0, 300)} » (${neutralLine(theirs.ref).slice(0, 120)}). Laquelle garder ? Ta réponse s'écrit chez le COO dans les deux DECISIONS.md, et la décision non gardée y est marquée « remplacée le … ».`

/** L'id de la question bloquante d'une contradiction : il nomme son entrée, une seule question par entrée. */
export const contradictionQuestionId = (entryId: string): string => `${OPPOSITION_PREFIX}${entryId}`
