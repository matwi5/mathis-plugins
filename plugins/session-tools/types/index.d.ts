export type LastRequestAt = number | null;
// Chrono de la dernière requête : `endedAt` vaut null tant qu'elle n'est pas finie ; `tasks`, ses
// tâches de fond encore en cours ; `own`, toutes celles qu'elle a eues ; `others`, celles des
// requêtes d'avant, déjà là à son début ; `isIdle`, vrai quand le fil principal a fini son tour ;
// `isInterrupted`, vrai quand elle a fini sur un tour interrompu (ou en erreur), sans liste à jour.
// Ces cinq champs manquent dans un chrono écrit par une version d'avant la 0.21.0.
export type ResponseTimer = {
  startedAt: number;
  endedAt: number | null;
  tasks?: string[];
  own?: string[];
  others?: string[];
  isIdle?: boolean;
  isInterrupted?: boolean;
} | null;
// Les identifiants des tâches de fond vues au dernier arrêt (fil principal ou agent).
export type BackgroundTasks = string[];
// Depuis le dernier message : tokens générés par le fil principal et temps passé à les générer.
export type GenerationSpeed = { tokens: number; ms: number } | null;

declare module "claude-code" {
  interface PluginState {
    "session-tools": {
      lastRequestAt: LastRequestAt;
      // Vrai pendant qu'Opus réécrit le brouillon (bouton « Réécrire »).
      rewriting: boolean;
      // Vrai pendant qu'Opus choisit le niveau d'effort du brouillon (bouton « Effort auto »).
      choosingEffort: boolean;
      responseTimer: ResponseTimer;
      generationSpeed: GenerationSpeed;
      backgroundTasks: BackgroundTasks;
    };
  }
}
