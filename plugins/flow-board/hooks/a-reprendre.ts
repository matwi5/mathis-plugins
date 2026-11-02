// La boîte « À reprendre » d'une discussion : ce qu'un manager met de côté pour plus tard ou pour une
// autre mission, déclaré par l'outil `flow` au moment où il le note. Un fichier par discussion, écrit par
// elle seule ; le COO le lit, recopie chaque déclaration dans la section « À reprendre » de la feuille de
// route, et son mod note la déclaration recopiée dans le fichier de coordination une fois qu'il l'y voit ;
// le mod de la discussion déclarante retire alors de sa boîte ce qui est recopié, et seulement cela.
//
// Module pur, sans import du modèle.
//
// Invariants :
// - « Une chose mise de côté par une mission ne sort de la liste que par ta décision ; elle ne disparaît
//   jamais seule. »
// - « Une chose déclarée n'est retirée de sa boîte qu'une fois recopiée dans la feuille de route. »

import { isTime } from './basics.ts'
import { isSafeId } from './closing.ts'

/** Une déclaration : son id (tiré au hasard), le texte tel qu'écrit, sa source (la mission, le ticket…), la mission qui la déclare, sa date. */
export type SetAside = { id: string; text: string; source: string; run?: string; at: number }

/** La boîte d'une discussion, telle qu'écrite : ses déclarations gardées telles quelles, même celles qu'aucune version ne sait lire. */
export type Box = { v: 1; root: string; session: string; items: unknown[] }

/** Le texte et la source d'une déclaration : bornés, jamais vides. */
export const SET_ASIDE_TEXT_MAX = 2000
export const SET_ASIDE_SOURCE_MAX = 200

/** Au-delà, une boîte refuse une nouvelle déclaration (rien n'en sort sans être recopié). */
export const BOX_MAX = 200

/** Le message d'une déclaration qui n'a pas pu s'écrire. */
export const SET_ASIDE_UNWRITTEN = 'Déclaration non enregistrée : redemande-la.'

/** L'id d'une déclaration : `a` puis 6 à 24 lettres minuscules ou chiffres. */
export const isSetAsideId = (v: unknown): v is string => typeof v === 'string' && /^a[a-z0-9]{6,24}$/.test(v)

/** Un id neuf, d'après la date et un tirage (`rand` dans [0, 1)). */
export const newSetAsideId = (now: number, rand: number): string =>
  `a${Math.max(0, Math.floor(now)).toString(36)}${Math.floor(Math.min(Math.max(rand, 0), 0.999999) * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`.slice(0, 25)

/** Une déclaration relue, réduite à ses champs ; null quand elle est mal formée (gardée telle quelle, jamais recopiée). */
export const soundSetAside = (raw: unknown): SetAside | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (!isSetAsideId(x.id) || typeof x.text !== 'string' || typeof x.source !== 'string' || !isTime(x.at)) return null
  if (x.text.trim() === '' || x.text.length > SET_ASIDE_TEXT_MAX || x.source.length > SET_ASIDE_SOURCE_MAX) return null
  if (x.run !== undefined && !isSafeId(x.run)) return null
  return { id: x.id, text: x.text, source: x.source, at: x.at, ...(x.run !== undefined ? { run: x.run as string } : {}) }
}

/** La boîte relue : absente (rien de déclaré), illisible (rien ne s'y écrit, rien n'en sort), ou lue. */
export type BoxRead = { state: 'absent' } | { state: 'unread' } | { state: 'read'; box: Box }

/** Lit le texte d'une boîte pour le projet `root` et la discussion `session` ; illisible sinon. */
export const parseBox = (text: string, root: string, session: string): BoxRead => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'unread' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'unread' }
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || x.root !== root || x.session !== session || !Array.isArray(x.items)) return { state: 'unread' }
  return { state: 'read', box: { v: 1, root, session, items: x.items } }
}

/** La clé d'une déclaration relue : son id quand il est en forme, sinon son texte entier. */
const itemKey = (raw: unknown): string => {
  const id = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).id : undefined
  return isSetAsideId(id) ? `id:${id}` : `raw:${JSON.stringify(raw)}`
}

/** La boîte sans les déclarations recopiées (`copied`, les ids que le COO a vus dans la feuille de route) ; une déclaration mal formée reste. */
export const withoutCopied = (items: readonly unknown[], copied: ReadonlySet<string>): unknown[] =>
  items.filter(raw => {
    const s = soundSetAside(raw)
    return !s || !copied.has(s.id)
  })

/** Une écriture de la boîte garde-t-elle chaque déclaration, sauf celles recopiées ? La garde de toute écriture. */
export const keepsItems = (before: readonly unknown[], after: readonly unknown[], copied: ReadonlySet<string>): boolean => {
  const kept = new Set(after.map(itemKey))
  return before.every(raw => {
    const s = soundSetAside(raw)
    return (s !== null && copied.has(s.id)) || kept.has(itemKey(raw))
  })
}

/**
 * Le texte d'une déclaration tel qu'il entre dans la feuille de route, une entrée par ligne : ses sauts de
 * ligne écrits « / », ses « · » (le séparateur du format) écrits « - », ses blancs resserrés.
 */
export const roadmapText = (text: string): string =>
  text
    .replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' / ')
    .replace(/·/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Les déclarations que la section « À reprendre » d'une feuille de route lue montre recopiées : une entrée
 * dont la source commence par « boîte <id> » et dont le texte est celui de la déclaration (`texts`, par id),
 * tel qu'il entre dans la feuille de route. Une copie résumée, coupée ou fusionnée ne vide jamais la boîte.
 */
export const copiedIn = (entries: readonly { section: string; source: string; text: string; id?: string }[], texts: ReadonlyMap<string, string>): Set<string> =>
  new Set(
    [...copiesOf(entries)]
      .filter(([id, e]) => {
        const declared = texts.get(id)
        return declared !== undefined && roadmapText(e.text) === roadmapText(declared)
      })
      .map(([id]) => id),
  )

/**
 * Les entrées de la section « À reprendre » dont la source commence par « boîte <id> », par id de
 * déclaration (la première trouvée) : l'id de l'entrée et son texte. Une entrée au texte différent de la
 * déclaration se corrige, sans en ajouter une autre.
 */
export const copiesOf = (entries: readonly { section: string; source: string; text: string; id?: string }[]): Map<string, { entry?: string; text: string }> => {
  const out = new Map<string, { entry?: string; text: string }>()
  for (const e of entries) {
    if (e.section !== 'À reprendre') continue
    const id = /^boîte (a[a-z0-9]{6,24})\b/.exec(e.source.trim())?.[1]
    if (id !== undefined && !out.has(id)) out.set(id, { ...(e.id !== undefined ? { entry: e.id } : {}), text: e.text })
  }
  return out
}

