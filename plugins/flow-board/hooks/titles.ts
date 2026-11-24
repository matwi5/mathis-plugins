// Les titres des entrées « À reprendre » de la feuille de route du COO : un titre court, écrit par le Claude du COO
// par l'outil `flow` (clé `titles` de `coordinate`), que le tableau de bord garde dans l'état de la feuille de route,
// lié à l'id de l'entrée et à l'empreinte du texte pour lequel il a été écrit. Le fichier de la feuille de route
// n'est jamais réécrit pour un titre.
//
// Module pur, sans import du modèle : `register.tsx` relit la feuille de route et écrit l'état, ce module dit la
// forme d'un titre, ce qu'un envoi enregistre ou refuse, et le titre qu'une entrée montre.
//
// Invariant : « Écrire, changer ou perdre un titre ne modifie jamais le texte d'une entrée, ne la fait jamais
// disparaître et ne la fait jamais passer pour changée ; un titre ne s'affiche que pour le texte pour lequel il a été
// écrit. »

import { isRoadmapId, roadmapTextPrint, type RoadmapEntry } from './roadmap.ts'
import { needsTitle } from './complement.ts'

/** Un titre gardé : le titre, et l'empreinte du texte de l'entrée à l'instant où il a été écrit. */
export type RoadmapTitle = { title: string; print: string }
export type RoadmapTitles = Record<string, RoadmapTitle>

/** Au plus, par appel de l'outil. */
export const TITLES_MAX = 50
/** Au plus, la longueur d'un titre (en caractères). */
const TITLE_MAX = 80

/**
 * Un caractère de contrôle, un saut ou un séparateur de ligne, ou un caractère invisible (que la vue retire en le
 * montrant) : refusés dans un titre, jamais retirés d'office.
 */
const CONTROL = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${String.fromCodePoint(0x2028, 0x2029)}\\p{Cf}\\p{Default_Ignorable_Code_Point}]`, 'u')

/** Pourquoi un titre est refusé (jamais coupé d'office) ; null quand il est en forme. */
const titleRefusal = (title: unknown): string | null => {
  if (typeof title !== 'string') return 'empty title'
  if (CONTROL.test(title)) return 'a line break, a control or an invisible character'
  if (title.trim() === '') return 'empty title'
  if ([...title].length > TITLE_MAX) return `over ${TITLE_MAX} characters`
  return null
}

const isPrintForm = (v: unknown): v is string => typeof v === 'string' && /^t[0-9a-z]{1,20}$/.test(v)

/**
 * Les titres relus de l'état gardé, titre par titre : ceux en forme, et si tous l'étaient (`isWhole`). Un id ou un
 * titre hors forme est écarté, et l'état entier se met de côté par le mécanisme de l'état gardé.
 */
export const partialTitles = (v: unknown): { titles: RoadmapTitles; isWhole: boolean } => {
  if (v === undefined || v === null) return { titles: {}, isWhole: true }
  if (typeof v !== 'object' || Array.isArray(v)) return { titles: {}, isWhole: false }
  const titles: RoadmapTitles = {}
  let isWhole = true
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const x = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    if (isRoadmapId(id) && x && titleRefusal(x.title) === null && isPrintForm(x.print)) titles[id] = { title: x.title as string, print: x.print }
    else isWhole = false
  }
  return { titles, isWhole }
}

/** Le titre que montre une entrée : seulement quand l'empreinte gardée est celle de son texte du moment. */
export const titleOf = (titles: RoadmapTitles | undefined, e: Pick<RoadmapEntry, 'id' | 'text'>): string | undefined => {
  const t = titles?.[e.id]
  return t && t.print === roadmapTextPrint(e.text) ? t.title : undefined
}

/**
 * Les ids des entrées ouvertes de « À reprendre » (et des compléments rangés avec leur entrée : `needsTitle`) sans titre
 * attaché à leur texte du moment, dans l'ordre du fichier ; `entries` : toutes les entrées lues, pour le sort d'un complément.
 */
export const untitledIds = (entries: readonly RoadmapEntry[], titles: RoadmapTitles | undefined): string[] => entries.filter(e => needsTitle(e, entries) && titleOf(titles, e) === undefined).map(e => e.id)

/** Ce qu'un envoi enregistre (id, titre, empreinte prise à l'instant) et ce qu'il refuse (id et raison). */
export type TitlesPlan = { kept: RoadmapTitles; refused: { id: string; why: string }[] }

/**
 * Un envoi de titres, sur la feuille de route relue à l'instant : chaque élément `{ id, title }` ; refusé, un id hors
 * forme, une entrée absente ou hors de « À reprendre », un titre hors forme. L'empreinte est celle du texte du moment,
 * prise par le mod, jamais lue de l'envoi. Un deuxième titre pour le même id dans l'envoi remplace le premier.
 */
export const planTitles = (raw: readonly unknown[], entries: readonly RoadmapEntry[]): TitlesPlan => {
  const kept: RoadmapTitles = {}
  const refused: { id: string; why: string }[] = []
  for (const item of raw) {
    const x = item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}
    const id: unknown = x.id
    if (!isRoadmapId(id)) {
      refused.push({ id: typeof id === 'string' ? id.slice(0, 12) : '', why: 'id out of form' })
      continue
    }
    const e = entries.find(y => y.id === id)
    if (!e || e.section !== 'À reprendre') {
      refused.push({ id, why: 'no such entry in « À reprendre »' })
      continue
    }
    const why = titleRefusal(x.title)
    if (why) {
      refused.push({ id, why })
      continue
    }
    kept[id] = { title: x.title as string, print: roadmapTextPrint(e.text) }
  }
  return { kept, refused }
}
