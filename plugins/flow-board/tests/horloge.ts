// L'horloge des tests de flow-board : `settle` fait avancer l'horloge du faux moteur seconde par seconde,
// pour laisser le mod écrire. Un fichier neutre, sans import : un test qui n'a besoin que d'elle ne se
// déclare pas « Stockage : les deux modes » (`deux-stockages.test.mjs` ne vise, parmi les imports, que celui
// du monde partagé, `monde-coordination.ts`, qui la réexporte pour ses importeurs ; ou un faux moteur à drapeau `isUsed`). Elle était recopiée dans plus
// de vingt fichiers de test.

/** Avance l'horloge de `seconds` secondes, une à la fois, pour laisser le mod écrire entre deux. */
export const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
