export type LastRequestAt = number | null;
// Chrono de la dernière réponse : `endedAt` vaut null tant que l'agent répond.
export type ResponseTimer = { startedAt: number; endedAt: number | null } | null;
// Depuis le dernier message : tokens générés par le fil principal et temps passé à les générer.
export type GenerationSpeed = { tokens: number; ms: number } | null;

declare module "claude-code" {
  interface PluginState {
    "mods-mathis": {
      lastRequestAt: LastRequestAt;
      ultracode: boolean;
      responseTimer: ResponseTimer;
      generationSpeed: GenerationSpeed;
    };
  }
}
