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

// Ce qu'un worker rend au relais (le CHANGELOG, le code antérieur, les pistes) va au compte rendu
// de la mission dans tous les cas : repris des workers avec des groupes, rédigé par Claude sans groupes.
test('le compte rendu demande les trois rubriques, avec ou sans groupes, et dit d’où elles viennent', () => {
  const sections = [...skill.matchAll(/^## (.+)$/gm)].map(m => m[1])
  for (const title of ['Code antérieur au lot', 'Pistes', 'Ce que le CHANGELOG devra dire']) assert.ok(sections.includes(title), `rubrique absente : « ${title} »`)
  // Dans l'ordre du rapport : après « Trouvé », le CHANGELOG avant la livraison.
  const at = title => sections.indexOf(title)
  assert.ok(at('Trouvé') < at('Code antérieur au lot') && at('Code antérieur au lot') < at('Pistes') && at('Pistes') < at('Documentation'))
  assert.ok(at('Documentation') < at('Ce que le CHANGELOG devra dire') && at('Ce que le CHANGELOG devra dire') < at('Ce que la livraison enverra'))
  const sources = skill.slice(skill.indexOf('## 1. Rassembler les faits'), skill.indexOf('## 2. Rédiger'))
  assert.ok(sources.includes('**avec des groupes**, reprends-les des comptes rendus des workers'), 'origine avec groupes absente')
  assert.ok(sources.includes('**sans groupes**, rédige-les toi-même'), 'origine sans groupes absente')
  const older = skill.slice(skill.indexOf('## Code antérieur au lot'), skill.indexOf('## Pistes'))
  assert.ok(older.includes('groupe « durcissement »'), 'le code antérieur ne sert pas à décider d’un groupe « durcissement »')
  const tracks = skill.slice(skill.indexOf('## Pistes'), skill.indexOf('## Documentation'))
  assert.ok(tracks.includes('passe « bogues » qui ne viole pas l\'invariant') && tracks.includes('cas limite relevé en route'), 'les pistes ne disent pas leur source')
  const changelog = skill.slice(skill.indexOf('## Ce que le CHANGELOG devra dire'), skill.indexOf('## Ce que la livraison enverra'))
  assert.ok(changelog.includes('<plugin ou paquet>'), 'le CHANGELOG ne se range pas par plugin ou paquet')
  // La borne de longueur reste.
  assert.ok(skill.includes('Le rapport entier tient en 60 lignes au plus, titres compris'))
})

test('le README et la description du skill nomment les mêmes rubriques que le skill', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const line = readme.split('\n').find(l => l.startsWith('- sections fixes : '))
  assert.ok(line, 'liste des sections absente du README')
  const listed = line.slice('- sections fixes : '.length, line.indexOf(' ; ')).split(', ')
  const template = skill.slice(skill.indexOf('```'), skill.lastIndexOf('```'))
  const sections = ['En bref', ...[...template.matchAll(/^## (.+)$/gm)].map(m => m[1])]
  assert.deepEqual(listed, sections)
  const description = skill.match(/^description: "(.*)"$/m)[1]
  for (const part of ['code antérieur au lot', 'les pistes', 'ce que le CHANGELOG devra dire']) assert.ok(description.includes(part), `description sans « ${part} »`)
})

test('avec des groupes, le skill renvoie aux comptes rendus des workers ; « Trouvé » ne range plus de pistes', () => {
  // La consigne qui donne ce chemin se teste au chargement : compte-rendu.test.ts.
  assert.ok(skill.includes('dans leurs fichiers du relais, dont la consigne de flow-board plus bas donne le chemin'))
  // « Trouvé » ne range plus de pistes : elles vont sous « Pistes ».
  const found = skill.slice(skill.indexOf('## Trouvé'), skill.indexOf('## Code antérieur au lot'))
  assert.ok(!/piste(?!s des revues)/.test(found.replace('« Pistes »', '')), '« Trouvé » range encore des pistes')
})

test('la consigne auto du compte rendu renvoie à la rubrique du code antérieur au lot', () => {
  const register = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8')
  const auto = register.match(/'compte-rendu':\s*\n\s*'([^']*)'/)
  assert.ok(auto, 'consigne auto du compte rendu absente')
  assert.ok(auto[1].includes('« Code antérieur au lot »'), 'la consigne auto ne nomme pas la rubrique')
})

// Un compte rendu avait cherché les fichiers de suivi dans travail/tasks/ seulement, pas dans
// travail/<sujet>/, sans voir qu'une autre discussion avait posé une version en route, ni quels
// commits de la mission étaient déjà sur le dépôt distant.
test('le compte rendu lit les fichiers de suivi là où le CLAUDE.md les range, les versions posées en route et les commits déjà envoyés', () => {
  const sources = skill.slice(skill.indexOf('## 1. Rassembler les faits'), skill.indexOf('## 2. Rédiger'))
  assert.ok(sources.includes('là où le `CLAUDE.md` du projet les range (par exemple `travail/<sujet>/`'), 'les fichiers de suivi ne suivent pas le CLAUDE.md du projet')
  assert.ok(!/fichiers de suivi de la mission \(`travail\/tasks\/…`\)/.test(sources), 'travail/tasks/ reste le seul lieu cité')
  assert.ok(sources.includes('les versions posées depuis le début de la mission, par cette discussion ou une autre'), 'les versions posées en route ne sont pas relevées')
  assert.ok(sources.includes('`git log --oneline origin/<branche>..HEAD`'), 'les commits déjà envoyés ne sont pas relevés')
  const delivery = skill.slice(skill.indexOf('## Ce que la livraison enverra'), skill.indexOf('**À toi**'))
  assert.ok(delivery.includes('les commits de la mission déjà sur le dépôt distant') && delivery.includes('les versions déjà posées en route'), 'la livraison ne dit ni les commits déjà envoyés ni les versions posées')
})

test('le compte rendu cite à part les constats de la relecture du fond et de la forme', () => {
  const done = skill.slice(skill.indexOf('## Fait'), skill.indexOf('## Décidé sans toi'))
  assert.ok(done.includes('ceux de la relecture du fond et de la forme, chacun à part'), 'les constats de forme ne sont pas cités à part')
})

// Une mise de côté avait créé un doublon d'une entrée de la feuille de route : chaque point des deux rubriques dit où il est rangé.
test('chaque point de « Code antérieur au lot » et de « Pistes » se termine par l’endroit où il est rangé', () => {
  const part = skill.slice(skill.indexOf('## Code antérieur au lot'), skill.indexOf('## Documentation'))
  assert.equal(part.split('\n').filter(l => l.startsWith('- <') && l.endsWith(' <Où il est rangé.>')).length, 2, 'les deux rubriques ne finissent pas par leur rangement')
  for (const form of ['« feuille de route : <id> »', '« mis de côté (setAside) »', '« non rangé » avec la raison']) assert.ok(part.includes(form), form)
})
