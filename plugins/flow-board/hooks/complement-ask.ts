/**
 * Ce que les demandes des boutons de la vue Coordination ajoutent pour un complément (`hooks/complement.ts`) : la demande
 * d'écarter une entrée nomme ses compléments, que le COO redit à la personne avant d'écrire ; la demande de lancer un
 * complément lu comme une chose à décider le dit encore ouvert. Seuls des ids en forme y entrent, jamais un texte relu.
 * Pur : ni moteur ni fichier.
 */

import { complementsOf, isOpenPending } from './complement.ts'
import { isRoadmapId, type Roadmap, type RoadmapEntry } from './roadmap.ts'

/** Les entrées d'une feuille de route lue ; aucune quand elle manque, ne se lit pas ou est hors format. */
const entriesOf = (read: Roadmap | null | 'unread'): RoadmapEntry[] => (read !== null && read !== 'unread' && read.ok ? read.entries : [])

/** La phrase ajoutée à la demande d'écarter l'entrée `id` quand des compléments sont rangés avec elle ; vide sinon. */
export const dropComplementsNote = (id: string, read: Roadmap | null | 'unread'): string => {
  const ids = complementsOf(id, entriesOf(read)).map(e => e.id).filter(isRoadmapId)
  if (ids.length === 0) return ''
  return ` Elle a ${ids.length === 1 ? 'un complément rangé' : `${ids.length} compléments rangés`} avec elle, à l'état « complète ${id} » : ${ids.join(', ')}. Redis-${ids.length === 1 ? 'le' : 'les'}-moi avec elle avant d'écrire : ${ids.length === 1 ? 'il se clôt avec elle, sans que tu changes son état ni son texte' : 'ils se closent avec elle, sans que tu changes leur état ni leur texte'} ; sauf si son statut écrit commence par « écartée : corrigée », tel quel, en minuscules (une entrée seulement reformulée) : ${ids.length === 1 ? 'il reste ouvert' : 'ils restent ouverts'}, à décider, et dis-le aussi.`
}

/** La phrase ajoutée à la demande de lancer l'entrée `id` quand c'est un complément lu comme une chose à décider ; vide sinon. */
export const launchComplementNote = (id: string, read: Roadmap | null | 'unread'): string => {
  const entries = entriesOf(read)
  const e = entries.find(x => x.id === id)
  if (!e || !e.status.startsWith('complète ') || !isOpenPending(e, entries)) return ''
  return ` ${id} est un complément que le tableau de bord lit comme une chose à décider (son entrée n'est pas de celles que la vue montre ouvertes : faite, lancée, seulement reformulée, absente, hors forme, d'une autre section, ou elle-même un complément) : compte-la comme encore ouverte, comme « à décider », au lancement comme pour la passer ensuite à « rattachée à <titre> ».`
}
