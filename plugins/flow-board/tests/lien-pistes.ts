import { activeRun, currentPhase } from '../hooks/model.ts'
import type { Board } from '../types'

/**
 * Un envoi de pistes enregistré par une version d'avant la demande de découpage, encore sans
 * session : l'état de départ des tests de l'ancien chemin à un seul lien, que le panneau ne crée
 * plus. Les pistes gardent l'ordre de la phase, l'envoi prend le numéro suivant, et une session
 * fermée laisse la place en restant notée à côté, comme le faisaient ces versions.
 */
export const withItemsLink = (board: Board, ids: readonly string[], at: number): Board => {
  const b = structuredClone(board)
  const phase = currentPhase(activeRun(b)!)
  const link = phase.linked
  if (link?.session !== undefined && link.closing) phase.linkedEarlier = { at: link.at, session: link.session, closing: link.closing }
  const seq = (phase.linkedSends ?? 0) + 1
  phase.linked = { items: phase.items.map(i => i.id).filter(id => ids.includes(id)), at, seq }
  phase.linkedSends = seq
  return b
}
