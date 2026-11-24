/**
 * Le complément d'une entrée de la feuille de route (« complète <id> ») : une chose mise de côté qui précise une entrée
 * déjà notée, recopiée en entrée neuve de « À reprendre » au lieu d'une chose de plus à décider. Son sort se lit, il ne
 * s'écrit jamais : rangé avec son entrée tant qu'elle est de celles que la vue montre, clos avec elle quand elle est
 * écartée sur le fond, et, dans le doute (entrée absente, hors forme, elle-même un complément, faite, lancée, seulement
 * reformulée, « écartée : corrigée … », d'une autre section), lu comme une chose à décider. Pur : ni moteur ni fichier.
 */

import { isRoadmapId, type RoadmapEntry } from './roadmap.ts'

/** Le début du statut d'un complément ; sa suite est l'id de l'entrée qu'il complète. */
const COMPLEMENT_PREFIX = 'complète '

/** Le sort d'un complément : rangé avec son entrée (`with`), clos avec elle (`closed`), ou lu comme une chose à décider (`open`). */
export type ComplementFate = { kind: 'with'; of: RoadmapEntry } | { kind: 'closed'; of: RoadmapEntry } | { kind: 'open' }

/** Une entrée « À reprendre » à l'état « complète … » (quelle que soit sa suite). */
const isComplement = (e: Pick<RoadmapEntry, 'section' | 'status'>): boolean => e.section === 'À reprendre' && e.status.startsWith(COMPLEMENT_PREFIX)

/**
 * Une entrée qui peut recevoir un complément : une chose à reprendre « à décider », « plus tard » ou « rattachée à … »,
 * ou une idée « à lancer » ou « plus tard » : celles que la vue et le relevé montrent. Une chose « lancée », une idée
 * « devenue mission … » n'en sont pas : un complément rangé sous elles ne se verrait nulle part.
 */
const takesComplement = (e: Pick<RoadmapEntry, 'section' | 'status'>): boolean =>
  e.section === 'À reprendre'
    ? e.status === 'à décider' || e.status === 'plus tard' || (e.status.startsWith('rattachée à ') && e.status.length > 'rattachée à '.length)
    : e.section === 'Idées' && (e.status === 'à lancer' || e.status === 'plus tard')

/**
 * Une entrée écartée sur le fond (une idée ou une chose à reprendre) : ses compléments se ferment avec elle. Une entrée
 * dont la raison commence par « corrigée » (« écartée : corrigée par <id> », la consigne du COO, ou une variante : deux
 * ids, une note) n'est que reformulée : ses compléments ne se ferment pas, ils se lisent comme une chose à décider ; dans
 * le doute, rien ne se ferme (réponse de Mathis : rien ne se perd sur une simple reformulation).
 */
const isDropped = (e: Pick<RoadmapEntry, 'section' | 'status'>): boolean =>
  (e.section === 'À reprendre' || e.section === 'Idées') && e.status.startsWith('écartée : ') && !e.status.startsWith('écartée : corrigée')

/**
 * Le sort d'un complément, d'après la feuille de route lue : l'id de sa suite comparé aux ids du fichier, rien d'autre.
 * Une entrée qui n'est pas un complément se lit comme une chose à décider (`open`) : la fonction ne cache jamais rien.
 */
export const complementFate = (e: RoadmapEntry, entries: readonly RoadmapEntry[]): ComplementFate => {
  if (!isComplement(e)) return { kind: 'open' }
  const target = e.status.slice(COMPLEMENT_PREFIX.length)
  if (!isRoadmapId(target) || target === e.id) return { kind: 'open' }
  const of = entries.find(x => x.id === target)
  if (!of || isComplement(of)) return { kind: 'open' }
  if (takesComplement(of)) return { kind: 'with', of }
  if (isDropped(of)) return { kind: 'closed', of }
  return { kind: 'open' }
}

/**
 * Une chose « À reprendre » ouverte, celles que comptent la vue et le relevé : « à décider », « plus tard », ou un
 * complément lu comme une chose à décider. Un complément rangé avec son entrée ou clos avec elle n'en est pas.
 */
export const isOpenPending = (e: RoadmapEntry, entries: readonly RoadmapEntry[]): boolean =>
  e.section === 'À reprendre' && (e.status === 'à décider' || e.status === 'plus tard' || (isComplement(e) && complementFate(e, entries).kind === 'open'))

/** Une entrée dont le COO écrit le titre : une chose ouverte, ou un complément rangé avec son entrée (pas un complément clos). */
export const needsTitle = (e: RoadmapEntry, entries: readonly RoadmapEntry[]): boolean => isOpenPending(e, entries) || (isComplement(e) && complementFate(e, entries).kind === 'with')

/** La tête stricte d'une déclaration : une majuscule, un à quatre chiffres, puis « : », au tout début du texte. */
const HEAD = /^([A-Z][0-9]{1,4}):/

/**
 * L'état à écrire pour une déclaration recopiée dans « À reprendre » : « complète <id> » quand son texte commence par
 * l'id, en forme stricte, d'une entrée qui peut recevoir un complément ; « à décider » dans tous les autres cas (tête
 * hors forme ou absente, entrée close, absente, elle-même un complément, feuille de route illisible : `null`). L'id
 * lu n'est que comparé aux ids du fichier ; le reste du texte n'est jamais lu.
 */
export const copyStatusFor = (text: string, entries: readonly RoadmapEntry[] | null): string => {
  const id = HEAD.exec(text)?.[1]
  if (id === undefined || entries === null) return 'à décider'
  const of = entries.find(x => x.id === id)
  return of && !isComplement(of) && takesComplement(of) ? `${COMPLEMENT_PREFIX}${id}` : 'à décider'
}

/** Les compléments rangés avec une entrée, dans l'ordre du fichier. */
export const complementsOf = (id: string, entries: readonly RoadmapEntry[]): RoadmapEntry[] =>
  entries.filter(e => isComplement(e) && complementFate(e, entries).kind === 'with' && e.status === `${COMPLEMENT_PREFIX}${id}`)
