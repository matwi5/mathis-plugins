// L'état des cases d'autonomie dit à une discussion par la réponse de l'outil `flow` : le bloc « mode auto » est écrit à
// l'envoi et lu pendant toute la phase, et un worker ne le reçoit jamais. Ce module garde, dans la mémoire du processus,
// l'état que chaque mission a déjà reçu (le bloc, la consigne d'allumage ou une réponse de l'outil), et rend l'avis à
// ajouter quand l'état relu a changé depuis. Mémoire vide (un processus neuf, un rechargement des plugins) : « aucune case
// cochée », de sorte qu'une case cochée se redit une fois et qu'aucune case cochée n'ajoute rien. Sans le moteur (`$`) :
// les cases relues sont données par l'appelant (`autonomyCasesNow` d'`autonomy-store.ts`).

import { autonomyLine, tickedBoxes } from './auto-consignes.ts'
import type { AutonomyCases } from './autonomy-setting.ts'

/** Par mission : les libellés des cases cochées déjà dits à cette discussion, joints par « + » ; absent : aucun. */
const said = new Map<string, string>()

const keyOf = (cases: AutonomyCases | null): string => tickedBoxes(cases).join('+')

/** Note l'état que la discussion vient de recevoir par le bloc « mode auto » ou la consigne d'allumage. */
export const markAutonomySaid = (runId: string, cases: AutonomyCases | null): void => {
  said.set(runId, keyOf(cases))
}

/** Le début fixe de l'avis d'un changement des cases. */
export const AUTONOMY_CHANGED_HEAD = '⚡ flow-board: the autonomy boxes of this project changed since this discussion was last told.'

/** Ce que l'avis dit quand plus aucune case n'est cochée (ou qu'elles ne se lisent plus). */
const NONE_TICKED =
  '- No autonomy box is ticked now: from now on, every question of the kinds that stay with the user is a blocking question, and a choice declared beginning with « Réglage : » is refused.'

/**
 * L'avis à ajouter à une réponse de l'outil pour la mission `runId` : vide quand l'état relu est celui déjà dit ; sinon
 * l'état neuf (la phrase des cases, ou « aucune case cochée »), qui devient celui dit. Une question déjà posée reste posée.
 */
export const autonomyChangeNotice = (runId: string, cases: AutonomyCases | null): string => {
  const key = keyOf(cases)
  if ((said.get(runId) ?? '') === key) return ''
  said.set(runId, key)
  return ['', '', '---', AUTONOMY_CHANGED_HEAD, autonomyLine(cases) ?? NONE_TICKED, 'A question already asked stays asked until the user answers it.'].join('\n')
}
