// Le skill /flow-board:compte-rendu (skills/compte-rendu/SKILL.md) : des comptes rendus de fin de
// parcours trop longs avaient été coupés à l'affichage puis redonnés ; la règle « Court » n'avait
// pas de borne. Les tests du côté du mod sont dans compte-rendu.test.ts ; celui-ci lit le skill.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const skill = readFileSync(new URL('../skills/compte-rendu/SKILL.md', import.meta.url), 'utf8')

// Les tickets de jugement (en xhigh le temps du ticket) : nommés au rapport avec le coût de leurs groupes, d'après
// le récap d'une mission de stats-board ; jamais le coût d'un ticket seul ; sans stats-board, coût non disponible.
test('le compte rendu nomme les tickets de jugement et donne le coût de leurs groupes', () => {
  const sources = skill.slice(skill.indexOf('## 1. Rassembler les faits'), skill.indexOf('## 2. Rédiger'))
  for (const part of ['ligne « Judgement tickets »', 'charge le skill `stats-board:recap`', 'Le coût est celui du groupe, jamais d\'un ticket seul', 'Sans le plugin stats-board (le skill absent), le rapport nomme ces tickets et dit que le coût n\'est pas disponible'])
    assert.ok(sources.includes(part), `absent : « ${part} »`)
  const decided = skill.slice(skill.indexOf('## Décidé sans toi'), skill.indexOf('## Ce qui s\'est mal passé'))
  assert.ok(decided.includes('Tickets de jugement, traités en xhigh le temps du ticket (sur Fable 5.2 high dans un groupe parti par « ↗ Fable ») : <id> (groupe <G>, <xhigh ou Fable 5.2 high>)'), 'la ligne des tickets de jugement manque à « Décidé sans toi »')
  assert.ok(decided.includes('(coût du groupe, pas du ticket)'), 'le coût n’est pas dit par groupe')
})

// Une obligation du compte rendu décidée par la personne (un coût, un bilan, une question à lui poser) avait été
// mise de côté (`setAside`) au lieu d'être faite : le skill fait relire les décisions de la mission pour elles.
test('le compte rendu fait ce que les décisions de la mission lui demandent, sans rien mettre de côté', () => {
  const sources = skill.slice(skill.indexOf('## 1. Rassembler les faits'), skill.indexOf('## 2. Rédiger'))
  for (const part of [
    '- ce que les décisions de la mission demandent au compte rendu lui-même : relis son fichier de décisions (son index « Décisions en vigueur » d\'abord, puis les séries en vigueur)',
    '(un chiffre à donner, un bilan, une question à poser à la personne)',
    'chacune se fait dans le rapport, à la section qui lui convient, ou le rapport dit pourquoi elle ne peut pas l\'être ; aucune ne se met de côté (`setAside`)',
  ])
    assert.ok(sources.includes(part), `absent : « ${part} »`)
})

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
  // Les notes de l'auto par phase, sorties de register.tsx vers auto-consignes.ts.
  const register = readFileSync(new URL('../hooks/auto-consignes.ts', import.meta.url), 'utf8')
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

// Une mission qui commence par un tri dit au compte rendu ce que chaque entrée triée est devenue,
// sous six formes fixes que le COO relit au relevé de la mission close.
test('le compte rendu a une section « Entrées triées », après « Fait », avec ses six formes et la règle d’une entrée découpée', () => {
  const template = skill.slice(skill.indexOf('```'), skill.lastIndexOf('```'))
  const sections = [...template.matchAll(/^## (.+)$/gm)].map(m => m[1])
  assert.equal(sections[sections.indexOf('Fait') + 1], 'Entrées triées', '« Entrées triées » ne suit pas « Fait »')
  const sorted = template.slice(template.indexOf('## Entrées triées'), template.indexOf('## Décidé sans toi'))
  const forms = sorted.split('\n').filter(l => l.startsWith('- <id> : '))
  assert.deepEqual(forms, [
    '- <id> : faite, ticket <n> (commit <hash>)',
    '- <id> : faite, tickets <n>, <m> (commits <hash>, <hash>)',
    '- <id> : écartée — <raison>',
    '- <id> : renvoyée',
    '- <id> : pour toi — <ce qui t\'attend>',
    '- <id> : question ouverte — <la question>',
  ])
  for (const part of ['sans `tri.md` dans le dossier de la mission', 'laissé par une mission plus ancienne du même dossier), « Rien. »', 'Une ligne par entrée de la feuille de route, jamais par sous-ligne', 'toutes ses sous-lignes « corrige » ont leur ticket fait et qu\'aucune n\'attend', 'une entrée « corrige » dont un ticket n\'est pas fait n\'est jamais « faite »'])
    assert.ok(sorted.includes(part), `absent : « ${part} »`)
  // Chaque combinaison de lignes tombe sur une seule forme : des règles dans l'ordre, la première l'emporte, et un « sinon » final.
  const rules = ['la première qui s\'applique donne sa forme', '1. Une ligne « question »', '2. Une ligne « pour l\'utilisateur »', '3. Une ligne « corrige » dont la colonne « ticket » est vide ou dont un ticket n\'est pas fait', '4. Au moins une ligne « corrige », toutes avec leurs tickets faits', '5. Toutes ses lignes « écarte »', '6. Sinon']
  for (const rule of rules) assert.ok(sorted.includes(rule), `règle absente : « ${rule} »`)
  assert.deepEqual(rules.map(r => sorted.indexOf(r)), rules.map(r => sorted.indexOf(r)).sort((a, b) => a - b), 'les règles ne sont pas dans l’ordre')
  // Les copies de la règle : le README (l'exception à la borne) et la description du skill.
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').split('\n').find(l => l.startsWith('- sections fixes : '))
  assert.ok(readme.includes('le tout tient en 60 lignes au plus, hors des lignes de « Entrées triées »'), 'le README ne dit pas l’exception à la borne')
  assert.ok(skill.match(/^description: "(.*)"$/m)[1].includes('ce que chaque entrée triée est devenue'), 'la description ne nomme pas les entrées triées')
  const sources = skill.slice(skill.indexOf('## 1. Rassembler les faits'), skill.indexOf('## 2. Rédiger'))
  assert.ok(sources.includes('`tri.md`') && sources.includes('la colonne « ticket » et l\'état de chaque ticket'), 'la collecte ne lit pas tri.md')
  const blocked = template.slice(template.indexOf('## Bloqué par moi'), template.indexOf('## Trouvé'))
  assert.ok(blocked.includes('Les entrées « pour toi » et « question ouverte » de « Entrées triées » y paraissent aussi'), '« Bloqué par moi » ne reprend pas les entrées en attente')
  assert.ok(skill.includes('Les lignes de « Entrées triées » ne comptent pas dans ces 60 lignes'), 'la borne compte les entrées triées')
})

// Au compte rendu d'une mission sans groupes, le rapport déjà écrit dans un fichier avait été donné par `reportPath`,
// que l'outil refuse au manager, puis recollé en entier dans `report` : le skill dit d'avance de passer par `report`.
test('le compte rendu se donne par « report », jamais par « reportPath », que l’outil refuse ici', () => {
  const at = skill.indexOf('{"report": "<le rapport entier>"}')
  assert.ok(at > 0, 'l’envoi par report manque')
  const sentence = skill.slice(at, skill.indexOf('.', skill.indexOf('le refuse ici', at)))
  assert.ok(sentence.includes('jamais par `reportPath` : l\'outil ne lit un chemin que d\'un worker'), 'pas de reportPath au compte rendu : absent')
  assert.ok(sentence.includes('le refuse ici, même pour un rapport déjà écrit dans un fichier'), 'le refus de l’outil n’est pas dit')
})

// Le 18/11, le compte rendu en auto avait dit seulement en fin de texte la question COURSE-05 encore ouverte et le
// worker B pas fermé (piste cr1) : les faits les nomment, et le skill les met en tête, dans « En bref ».
test('une question ouverte ou une fermeture arrêtée se dit en tête, dans « En bref », et « À toi » redit la question', () => {
  const rule = skill.slice(skill.indexOf('- **Ce qui attend, en tête.**'), skill.indexOf('\n', skill.indexOf('- **Ce qui attend, en tête.**')))
  for (const part of [
    'Quand les faits nomment une question bloquante encore ouverte (« Blocking question still open », une ligne par question) ou une fermeture arrêtée (« Closing stopped », une ligne par worker)',
    '« En bref » le dit dans sa première phrase',
    '« À toi » redit chaque question ouverte',
    'Un rapport ne dit jamais que tout est fermé, ni « tous les workers fermés », quand une fermeture est arrêtée.',
  ])
    assert.ok(rule.includes(part), `absent : « ${part} »`)
})

// La section « Contexte et coût » : le bloc du récap de mission de stats-board, lancé avec les arguments de la ligne
// « Discussions of the mission » des faits, recopié tel quel ; aucun id ajouté à la main ; ses replis ; hors des 60 lignes.
test('le compte rendu a une section « Contexte et coût », entre « Pistes » et « Documentation », recopiée du récap', () => {
  const template = skill.slice(skill.indexOf('```'), skill.lastIndexOf('```'))
  const sections = [...template.matchAll(/^## (.+)$/gm)].map(m => m[1])
  assert.equal(sections[sections.indexOf('Pistes') + 1], 'Contexte et coût', '« Contexte et coût » ne suit pas « Pistes »')
  assert.equal(sections[sections.indexOf('Contexte et coût') + 1], 'Documentation', '« Documentation » ne suit pas « Contexte et coût »')
  const sources = skill.slice(skill.indexOf('## 1. Rassembler les faits'), skill.indexOf('## 2. Rédiger'))
  const point = sources.slice(sources.indexOf('- les discussions de la mission'), sources.indexOf('\n', sources.indexOf('- les discussions de la mission')))
  for (const part of [
    'la ligne « Discussions of the mission »',
    'charge le skill `stats-board:recap`',
    'recopiés tels quels',
    'N\'y ajoute, n\'y complète ni n\'y corrige aucun id',
    'n\'y mets aucune discussion que la ligne dit sans id utilisable',
    'sans `--since` quand la ligne n\'en donne pas (n\'en calcule aucun)',
    'ne recopie que ce bloc, sans le reste de la sortie du récap',
  ])
    assert.ok(point.includes(part), `absent : « ${part} »`)
  // Le skill du compte rendu ne porte jamais la ligne de commande du récap : elle vit dans le skill du récap.
  assert.ok(!skill.includes('recap.mjs'), 'la ligne de commande du récap est dans le skill du compte rendu')
  const section = template.slice(template.indexOf('## Contexte et coût'), template.indexOf('## Documentation'))
  for (const part of [
    'recopie le bloc tel quel, titre compris, sans en écrire un second',
    'sans calculer, arrondir ni retoucher aucun chiffre',
    '« | <rôle> | non mesurée (sans id utilisable) | | | | — | »',
    '« Mesures non disponibles (stats-board absent). »',
    'le récap en échec, la première ligne de son erreur',
    '« Mesures non disponibles (discussions de la mission non données). »',
    '« Hors norme : rien à juger, aucune discussion mesurée. »',
    '« | Discussion | Départ | Maximum | Fin | Compactions | Coût | »',
    '« | **Total** | | | | — | — | », une ligne vide, puis « Hors norme',
    'Cette section ne dit jamais « Rien. »',
  ])
    assert.ok(section.includes(part), `absent : « ${part} »`)
  assert.ok(skill.includes('celles de « Contexte et coût » non plus'), 'les lignes de « Contexte et coût » comptent dans les 60 lignes')
  // Le coût des groupes des tickets de jugement vient de ce même bloc, sans second lancement du récap.
  assert.ok(sources.includes('lu dans le bloc « Contexte et coût » du récap du point suivant') && sources.includes('sans second lancement du récap'), 'le coût des tickets de jugement ne vient pas du bloc')
  // Sans bloc (récap en échec ou pas lancé) ou pour un groupe non mesuré, le coût n'est pas disponible, avec sa raison.
  assert.ok(sources.includes('quand le bloc manque (récap en échec ou pas lancé) ou que la ligne du groupe ne porte pas de coût'), 'le coût de jugement n’a pas de repli sans bloc')
  const decided = template.slice(template.indexOf('## Décidé sans toi'), template.indexOf('## Ce qui s\'est mal passé'))
  assert.ok(decided.includes('(un par envoi)') && decided.includes('« coût non disponible (<raison>) »'), 'le coût d’un groupe envoyé plusieurs fois ou indisponible n’a pas sa forme')
})

// Les choix tranchés par une case d'autonomie (« Réglage : <case> : … ») : un groupe à part, juste après la zone sensible,
// avec la question entière et les options écartées lues dans le fichier de décisions ; les phrases des fichiers chargés
// partout fusionnées sans relecture (case « Relecture après la fusion »), sous un titre à part, à relire avant la livraison.
test('le compte rendu range à part les choix des cases d’autonomie et liste les phrases fusionnées sans relecture', () => {
  const decided = skill.slice(skill.indexOf('## Décidé sans toi'), skill.indexOf('## Ce qui s\'est mal passé'))
  for (const part of ['sous leur propre sous-titre « Tranché par réglage »', 'dont le texte commence par « Réglage : » (ou « Zone sensible : Réglage : » pour un choix sensible, rangé là seulement)', 'recopie la question entière et les options écartées, lues dans le `DECISIONS.md` de la mission à son entrée « acceptée par réglage (<case>) »'])
    assert.ok(decided.includes(part), `absent : « ${part} »`)
  assert.ok(decided.includes('## Phrases fusionnées sans relecture'), 'le titre des phrases fusionnées manque')
  for (const part of ['« Réglage : Relecture après la fusion : <fichier> »', 'à relire avant la livraison', 'Sans un tel choix : « Rien. ».'])
    assert.ok(decided.includes(part), `absent : « ${part} »`)
  const sources = skill.slice(skill.indexOf('## 1. Rassembler les faits'), skill.indexOf('## 2. Rédiger'))
  assert.ok(sources.includes('(la zone sensible en tête, puis « Tranché par réglage », puis une origine par groupe)'), 'les faits ne nomment pas le groupe des cases')
})

test('la suite de « Autres » et la définition des sensibles n’y reprennent pas les choix de réglage', () => {
  assert.ok(skill.includes('pour « Autres », les lignes qui ne portent aucune des trois origines, sans celles qui commencent par « - Zone sensible : » ou « - Réglage : »'))
  assert.ok(skill.includes('dont le texte commence par « Zone sensible : » (sauf « Zone sensible : Réglage : », rangé sous « Tranché par réglage »)'))
})
