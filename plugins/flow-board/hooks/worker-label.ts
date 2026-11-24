// L'état du worker d'un groupe confié, en texte et en couleur : la ligne du groupe de la page Mission (`linkLabel`,
// `view.tsx`) et la liste des managers et de leurs workers du COO (`cooAgentRows`, `coo.ts`) le lisent ici, pour
// qu'un même worker dise la même chose aux deux endroits. Module pur, qui ne dessine rien.

import type { GroupLink } from '../types'
import { C } from './catalog.ts'
import { isAwaitingSession } from './link.ts'
import { shownWorkerStop } from './relay.ts'
import { dur } from './road.ts'

const NB = ' '

/**
 * Où en est le worker d'un groupe : à lancer, arrêté par une erreur (rouge, tant que sa note d'arrêt est son dernier
 * signal et que sa session n'a pas fini depuis : `shownWorkerStop`, un des textes fixes du mod), au travail, ou terminé
 * avec des tickets ouverts (ambre). `page` : le texte de la ligne du groupe de la page Mission ; `list` : celui de la
 * liste du COO, où « en cours » se dit sans « · worker » (la ligne est déjà celle d'un worker) ; `isWorking` : sa
 * session est au travail (ni à lancer, ni arrêtée, ni finie), la seule dont la liste du COO compte les spécialistes.
 */
export const workerLabel = (
  link: GroupLink,
  relay: { last?: unknown; endedAt?: number } | null,
  open: number,
  now: number,
): { page: string; list: string; color: string; isWorking: boolean } => {
  const stop = shownWorkerStop(relay)
  // Un envoi marqué (`sessionClash`) : des sessions s'y sont déclarées, il n'est plus « à lancer » même sans id noté.
  if (isAwaitingSession(link)) return { page: `↗${NB}worker à lancer`, list: `worker${NB}à${NB}lancer`, color: C.blue, isWorking: false }
  if (stop !== null) {
    const text = `⚠${NB}${stop.text.replace(/ /g, NB)}`
    return { page: text, list: text, color: C.red, isWorking: false }
  }
  if (relay?.endedAt !== undefined) {
    if (open > 0) return { page: `↗${NB}worker terminé il y a ${dur(now - relay.endedAt)}`, list: `worker terminé il y a ${dur(now - relay.endedAt)}`, color: C.amber, isWorking: false }
    return { page: `↗${NB}worker terminé · à rendre`, list: `worker terminé · à rendre`, color: C.blue, isWorking: false }
  }
  return { page: `↗${NB}en cours · worker`, list: `en${NB}cours`, color: C.blue, isWorking: true }
}
