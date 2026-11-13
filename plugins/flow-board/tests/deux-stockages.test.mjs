// Un fichier de test dont le faux moteur sert le board dans les deux modes de stockage (fichier commun
// ou `$.store`, selon l'emplacement de la copie du plugin : tests/stockage.ts) porte la ligne
// « Stockage : les deux modes », que scripts/check.py lit pour le relancer dans le mode qu'il n'a pas
// eu (`$.store`, la première passe se faisant partout en mode fichier). Sans elle, un test vert dans
// un mode échouait dans l'autre (constaté entre `check.sh --test`, alors en `$.store`, et la suite
// complète d'un worktree, sous `.claude/`).
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit les sources des tests. Un faux
// moteur « des deux modes » se reconnaît à son drapeau `isUsed` (le board lu ou écrit au fichier
// commun) ou à l'import du monde partagé `monde-coordination.ts`, qui le porte.

import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const MARK = 'Stockage : les deux modes'
const DIR = new URL('./', import.meta.url)
const ENGINE_TEST = /\.test\.tsx?$/

/** Ce qui fait d'un source un test des deux modes. */
const servesBothStorages = src => /\bisUsed\b/.test(src) || /from '\.\/monde-coordination\.ts'/.test(src)

/** Les fichiers de test du moteur des deux modes qui ne portent pas la ligne. */
const unmarked = files => files.filter(([, src]) => servesBothStorages(src) && !src.includes(MARK)).map(([name]) => name)

const engineTests = () =>
  readdirSync(DIR)
    .filter(name => ENGINE_TEST.test(name))
    .sort()
    .map(name => [name, readFileSync(new URL(name, DIR), 'utf8')])

test('chaque test du moteur qui sert le board dans les deux modes porte la ligne « Stockage : les deux modes »', () => {
  const files = engineTests()
  assert.ok(files.some(([name]) => name === 'mode-auto.test.ts'))
  assert.deepEqual(unmarked(files), [], `sans la ligne « ${MARK} » : ${unmarked(files).join(', ')}`)
})

test('le contrôle voit un test des deux modes sans sa ligne, et laisse un test qui ne touche pas au stockage', () => {
  const withWorld = "const disk = { isUsed: false }\non('fs.read', () => { disk.isUsed = true })\n"
  const shared = "import { world } from './monde-coordination.ts'\n"
  assert.deepEqual(unmarked([['a.test.ts', withWorld], ['b.test.ts', shared], ['c.test.ts', "import { x } from '../hooks/model.ts'\n"]]), ['a.test.ts', 'b.test.ts'])
  assert.deepEqual(unmarked([['a.test.ts', `// ${MARK}.\n${withWorld}`]]), [])
})

test('tests/stockage.ts et scripts/check.py reprennent la règle de claudeHome (register.tsx) : « /.claude/ » dans le dossier du plugin, sans casse', () => {
  const hook = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8')
  const helper = readFileSync(new URL('stockage.ts', DIR), 'utf8')
  assert.match(hook, /export function claudeHome\(\$: any\): string \| null \{\n {2}try \{\n {4}const root = String\(\$\.plugin\.root \?\? ''\)\.replace\(\/\\\\\/g, '\/'\)\n {4}const at = root\.toLowerCase\(\)\.indexOf\('\/\.claude\/'\)/)
  assert.match(helper, /root\.replace\(\/\\\\\/g, '\/'\)\.toLowerCase\(\)\.includes\('\/\.claude\/'\)/)
  // Et scripts/check.py, qui pose la copie de l'autre mode par la même règle.
  const check = readFileSync(new URL('../../../scripts/check.py', import.meta.url), 'utf8')
  // Sa première passe tourne partout dans le mode de l'usage réel, le fichier commun ; la relance, en $.store.
  assert.match(check, /^FIRST_STORAGE = "fichier"$/m)
  assert.match(check, /def storage_mode\(folder\):\n {4}"""[^\n]*claudeHome[^\n]*"""\n {4}return "fichier" if "\/\.claude\/" in Path\(folder\)\.resolve\(\)\.as_posix\(\)\.lower\(\) else "\$\.store"\n/)
})
