// Tarifs publics des modèles, pour le coût de chaque appel d'une requête. Aucun appel au moteur ici.
//
// Les prix sont recopiés de la référence du skill `claude-api` livré avec Claude Code 2.1.310
// (tableau « Current Models » de son SKILL.md, `shared/models.md` et `shared/prompt-caching.md`),
// relevés le 26/10/2026, jamais saisis de mémoire. Pour les mettre à jour : charger le skill
// `claude-api` (outil Skill), qui donne ces fichiers ; son dossier change d'une version et d'une
// session à l'autre, ne pas le chercher sur le disque. Puis changer la date ici et dans le README
// (« Tarifs »). Un modèle que cette référence ne chiffre pas
// (Opus 4.5 et plus ancien) est inconnu : son coût est estimé au prorata du coût de la session
// (`estimateUnknown`). Le mode rapide d'Opus (2× le tarif) n'est pas vu : l'usage que le moteur
// donne n'a pas de champ de vitesse, un tel appel est compté au tarif normal.
//
// Cache écrit : 2× le prix d'entrée, celui du cache d'une heure (la référence : 1,25× pour
// 5 min, 2× pour 1 h). Claude Code écrit presque tout en cache d'une heure (transcripts de ce
// Mac, 26/10/2026 : 138 écritures d'une heure pour 5 de 5 min). ccusage compte 1,25× partout.

/** Les prix d'un modèle, en dollars par million de tokens. */
type Price = { input: number; output: number; cacheRead: number }

/** Les quatre comptes d'un appel, dans l'orthographe de l'API. */
export type CallUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const CACHE_WRITE = 2

/** Le prix d'un modèle dont le cache lu vaut 0,1× l'entrée, la règle générale de la référence. */
const tenthCacheRead = (input: number, output: number): Price => ({ input, output, cacheRead: input / 10 })

const PRICES: Record<string, Price | ((prompt: number) => Price)> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': tenthCacheRead(5, 25),
  'claude-opus-4-8': tenthCacheRead(5, 25),
  'claude-opus-4-7': tenthCacheRead(5, 25),
  'claude-opus-4-6': tenthCacheRead(5, 25),
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': tenthCacheRead(3, 15),
  // Deux paliers selon la taille du prompt (entrée, cache lu et cache écrit) : 100 000 tokens au plus, ou au-delà.
  'claude-haiku-5-5': (prompt) => (prompt <= 100_000 ? tenthCacheRead(0.1, 0.5) : tenthCacheRead(0.5, 2.5)),
  'claude-haiku-4-5': tenthCacheRead(1, 5),
}

/** Les alias de Claude Code : le modèle courant de chaque famille. */
const ALIASES: Record<string, string> = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }

/**
 * L'identifiant d'un modèle tel que la table le connaît : sans le suffixe de contexte (`[1m]`),
 * la date (`-20251001`), le préfixe d'un fournisseur (`us.anthropic.`) ni sa version (`-v1:0`) ;
 * un alias (`opus`) donne le modèle courant de sa famille.
 */
export function canonicalModel(id: string): string {
  const bare = id
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/^.*anthropic\./, '')
    .replace(/-v\d+(:\d+)?$/, '')
    .replace(/@.*$/, '')
    .replace(/-\d{8}$/, '')
  return ALIASES[bare] ?? bare
}

/** Le modèle a un tarif dans la table. */
export const isPriced = (model: string): boolean => canonicalModel(model) in PRICES

/** Le coût d'un appel au tarif de son modèle, en dollars ; null pour un modèle inconnu de la table. */
export function priceOf(model: string, u: CallUsage): number | null {
  const entry = PRICES[canonicalModel(model)]
  if (!entry) return null
  const p = typeof entry === 'function' ? entry(u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens) : entry
  return (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.cacheRead + u.cache_creation_input_tokens * p.input * CACHE_WRITE) / 1e6
}

/**
 * Les poids relatifs du tarif suivi, l'entrée valant 1 : cache écrit 2 (une heure), cache lu 0,1,
 * sortie 5. Le barème de ccusage (`units` de model.ts) compte le cache écrit 1,25.
 */
export const trackedUnits = (input: number, output: number, cacheWrite: number, cacheRead: number): number => input + CACHE_WRITE * cacheWrite + 0.1 * cacheRead + 5 * output

/**
 * Le coût estimé des appels de modèles inconnus : ce que la session a coûté (`sessionCost`, celui
 * du moteur) moins ce que coûtent les appels chiffrés, réparti selon leurs unités pondérées. Rien
 * à répartir (coût de la session inconnu ou déjà couvert) : 0 chacun.
 */
export function estimateUnknown(sessionCost: number | null, priced: number, units: readonly number[]): number[] {
  const all = units.reduce((n, v) => n + v, 0)
  const rest = sessionCost === null ? 0 : Math.max(0, sessionCost - priced)
  return units.map((v) => (all > 0 ? (rest * v) / all : 0))
}
