// Le fichier commun des missions, absent et qui refuse d'être écrit, pour les tests dont le faux moteur
// ne répondait pas aux appels `$.fs` : sans réponse, quand le mod sait où est ~/.claude (la suite
// complète de `scripts/check.sh`), la lecture de ce fichier rate, et ce qui exige une relecture réussie
// (un lancement de groupe ou de lot) ne part pas. Absent, il se lit bien, et le board reste dans
// `$.store`, comme ces tests l'attendent. Tout autre chemin reste sans réponse, comme avant. Un module
// d'aide, pas un fichier de test.

const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

export const memoryDisk = (on: any): void => {
  const refuse = (path: string): never => {
    throw new Error(`pas de disque dans ce test : ${path}`)
  }
  on('fs.exists', (_$: unknown, e: { path: string }) => (isBoardFile(e.path) ? ({ value: false } as any) : refuse(e.path)))
  on('fs.read', (_$: unknown, e: { path: string }) => refuse(e.path))
  on('fs.write', (_$: unknown, e: { path: string }) => refuse(e.path))
}
