// Le faux flux `turn.step` des tests : recopié dans plusieurs fichiers, il avait été écrit une fois
// sous une forme que le mod ne lit pas (`kind: 'stop'` sans `stopReason` ni `usage`), payée d'un
// cycle de tests. Un seul modèle ici : un morceau `stop` complet, puis le résultat de l'étape.

/** L'usage d'une réponse du modèle, tel que le moteur le donne dans un morceau `stop`. */
export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

/** Un usage complet pour `model`, à 1 token d'entrée et de sortie sauf ce que `tokens` fixe. */
export const stepUsage = (model: string, tokens: Partial<Omit<StepUsage, 'model'>> = {}): StepUsage => ({
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  model,
  ...tokens,
})

/** Le hook d'un `turn.step` qui s'arrête aussitôt : un morceau `stop` (raison et usage), puis le résultat de l'étape. */
export const stoppedStep = (usage: StepUsage) =>
  async function* (_$: unknown, e: any) {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  }

/** Joue une étape du modèle jusqu'au bout : `$.turn.step` pour cette discussion ou un sous-agent (`agentId`), à un effort relevé ou non. */
export const playStep = async ($: any, o: { model: string; turnId?: string; index?: number; agentId?: string; effort?: string }): Promise<void> => {
  const input = { turnId: o.turnId ?? 't', index: o.index ?? 0, model: o.model, messageCount: 1, ...(o.agentId ? { agentId: o.agentId } : {}), ...(o.effort ? { effort: o.effort } : {}) }
  for await (const _ of $.turn.step(input)) {
    // la réponse
  }
}
