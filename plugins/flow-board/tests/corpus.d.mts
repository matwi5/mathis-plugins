// Les types du corpus hostile commun (corpus.mjs), pour les tests en TypeScript.

/** Une chaîne de ces points de code. */
export declare const ch: (...codes: number[]) => string

/** Le corpus : chaque entrée, glissée au milieu d'une valeur par ailleurs valide, doit la rendre refusée. */
export declare const CORPUS: Record<string, string>
