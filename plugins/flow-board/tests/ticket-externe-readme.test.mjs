// Le README dit la taille au-delà de laquelle le fichier du ticket qu'un bloqueur externe nomme n'est jamais lu, d'après
// la constante du module (`TICKET_FILE_BYTES` de hooks/externes.ts) : un texte qui décrit une règle se dérive d'elle
// (CODING_STANDARDS.md). Un test Node (node --test, lancé par scripts/check.sh) : il lit les sources.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('le README dit la taille limite du fichier d’un ticket nommé telle que la constante la fixe', () => {
  const m = /^export const TICKET_FILE_BYTES = (\d+) \* 1024$/m.exec(read('hooks/externes.ts'))
  assert.ok(m, 'TICKET_FILE_BYTES introuvable sous la forme « <n> * 1024 »')
  assert.ok(read('README.md').includes(`un fichier de plus de ${m[1]} KiB n'est jamais lu`), `le README ne dit pas ${m[1]} KiB`)
})
