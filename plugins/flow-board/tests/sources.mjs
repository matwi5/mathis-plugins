// L'aide commune des tests Node qui lisent le texte des sources du mod : elle lit tout `hooks/*.ts`
// et `hooks/*.tsx`, sans liste de fichiers à tenir. Un test qui listait ses fichiers à la main ne
// voyait plus le code déplacé dans un nouveau module (l'extraction du relais dans `relay.ts`).

import { readdirSync, readFileSync } from 'node:fs'

const HOOKS = new URL('../hooks/', import.meta.url)

/** Chaque module de `hooks/`, `{ file: 'hooks/<nom>', text }`, dans l'ordre alphabétique de son nom. */
export const hookSources = () =>
  readdirSync(HOOKS)
    .filter(name => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
    .sort()
    .map(name => ({ file: `hooks/${name}`, text: readFileSync(new URL(name, HOOKS), 'utf8') }))
