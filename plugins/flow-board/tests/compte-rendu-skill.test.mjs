// Le skill /flow-board:compte-rendu (skills/compte-rendu/SKILL.md) : des comptes rendus de fin de
// parcours trop longs avaient été coupés à l'affichage puis redonnés ; la règle « Court » n'avait
// pas de borne. Les tests du côté du mod sont dans compte-rendu.test.ts ; celui-ci lit le skill.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const skill = readFileSync(new URL('../skills/compte-rendu/SKILL.md', import.meta.url), 'utf8')

test('le compte rendu a une borne chiffrée, et « Trouvé » se range par thème', () => {
  assert.ok(skill.includes('Le rapport entier tient en 60 lignes au plus, titres compris'), 'borne absente')
  assert.ok(skill.includes('plutôt que de couper'), 'la borne ne dit pas de regrouper')
  const found = skill.slice(skill.indexOf('## Trouvé'), skill.indexOf('## Documentation'))
  assert.ok(found.includes('- **<thème>** :'), '« Trouvé » ne se range pas par thème')
  assert.ok(found.includes('Rangé par thème'), '« Trouvé » ne dit pas son rangement')
})
