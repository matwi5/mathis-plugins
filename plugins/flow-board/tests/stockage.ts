// Le mode de stockage où tourne cette exécution des tests. Le mod le tire de `$.plugin.root`
// (`claudeHome`, hooks/register.tsx) : sous un dossier `.claude/`, le fichier commun des missions ;
// ailleurs, `$.store`. Un test ne peut pas fixer `$.plugin.root` (claude-code/testing n'en a pas
// l'option, et le module qu'il importe n'est pas celui que charge le moteur) : c'est l'emplacement
// de la copie du plugin qui le fixe, et scripts/check.py lance chaque fichier qui porte la ligne
// « Stockage : les deux modes » dans les deux (une copie sous `.claude/`, une hors de lui).
// Cette aide lit le chemin de son propre fichier, qui est dans la même copie que le mod, par la même
// règle que `claudeHome` : un test sait ainsi quel mode il doit voir, au lieu de le deviner.

export type StorageMode = 'fichier' | '$.store'

/** Le mode d'un dossier de plugin : la règle de `claudeHome`, reprise telle quelle. */
export const storageModeOf = (root: string): StorageMode =>
  root.replace(/\\/g, '/').toLowerCase().includes('/.claude/') ? 'fichier' : '$.store'

/** Le mode de cette exécution, d'après l'emplacement de la copie du plugin qui tourne. */
export const storageMode = (): StorageMode => storageModeOf(decodeURIComponent(new URL((import.meta as unknown as { url: string }).url).pathname))
