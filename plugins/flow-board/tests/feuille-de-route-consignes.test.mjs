// Les consignes du COO recopient le format de la feuille de route que lit le mod (`hooks/roadmap.ts`) :
// l'exemple à l'identique, et chaque statut permis nommé. Une copie qui dérive ferait écrire au Claude du
// COO une feuille de route que le mod lit hors format. Un test Node (node --test, lancé par
// scripts/check.sh) : il lit les sources.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const SOURCE = read('hooks/roadmap.ts')
const SKILL = read('skills/coo/SKILL.md')

test('l’exemple du format est recopié tel quel dans les consignes du COO', () => {
  const example = /export const ROADMAP_EXAMPLE = `([^`]*)`/.exec(SOURCE)?.[1]
  assert.ok(example, 'ROADMAP_EXAMPLE introuvable dans hooks/roadmap.ts')
  const copied = /```markdown\n([\s\S]*?)```/.exec(SKILL)?.[1]
  assert.equal(copied, example)
})

test('chaque statut permis du format est nommé dans les consignes du COO', () => {
  const block = /export const ROADMAP_STATUSES[^{]*\{([\s\S]*?)\n\}/.exec(SOURCE)?.[1] ?? ''
  const statuses = [...block.matchAll(/'([^']+)'(?=[,\]])/g)].map(m => m[1].trim())
  assert.ok(statuses.length >= 10, `statuts relus : ${statuses.length}`)
  const missing = statuses.filter(s => !SKILL.includes(`« ${s}`))
  assert.deepEqual(missing, [])
})

// Au lancement d'une mission, le COO rattache les entrées « À reprendre » que nomme son premier message, et celle du
// bouton « Lancer », d'une seule écriture. Invariant : il ne change que l'état d'une entrée ouverte que nomme ce
// message, ou de celle du bouton ; jamais son id ni son texte ; une entrée déjà « lancée », close ou rattachée
// ailleurs n'est jamais touchée ; une entrée ne quitte jamais le fichier.
test('la section « Lancer une mission » fait rattacher, une fois la mission lancée, les entrées que nomme son premier message', () => {
  const launch = SKILL.slice(SKILL.indexOf('## Lancer une mission'), SKILL.indexOf('## La feuille de route'))
  for (const part of [
    'une fois la mission lancée (ton relevé la montre), passe à « rattachée à <titre> » chaque entrée « À reprendre » ouverte (« à décider » ou « plus tard ») que son premier message donne comme sujet de la mission (pas un id qu\'il cite comme hors sujet ou pour le contexte : dans le doute, demande à la personne), et l\'entrée dont ce lancement part du bouton « Lancer »',
    'le titre de la carte que tu proposes commence par son id et tient en 70 signes au plus',
    'une entrée qui n\'est plus ouverte ne se cite pas dans le titre',
    'une seule fois : au premier tour où ton relevé montre la mission lancée',
    'ne se rattache plus jamais d\'après cette carte, même si ton relevé la montre encore',
    'Selon l\'id que le premier message donne comme sujet (ou celui du bouton « Lancer »)',
    'Le clic sur la carte vaut la décision de la personne de les rattacher, une seule fois',
    'l\'état se défait à la demande de la personne (« plus tard » ou « écarter »), par les boutons « Plus tard » et « Écarter » que la vue Coordination montre sur une entrée rattachée, ou dans le chat',
    'Tu ne changes que leur état, jamais leur id ni leur texte, et une entrée ne quitte jamais le fichier',
    'écrit sans « · »',
    'une entrée « À reprendre » à « à décider » ou « plus tard », donnée comme sujet de la mission : elle passe à « rattachée à <titre> »',
    'une seule écriture, « rattachée à <titre> », jamais « lancée »',
    'une entrée déjà « rattachée à <ce titre> » : rien à faire',
    'une entrée déjà « lancée » avant ce lancement, « rattachée à <une autre mission> », « écartée : … » ou « faite : … » : tu ne la touches pas, et tu le dis à la personne',
    'l\'id d\'une autre section (une idée, un jalon, une étape) : cette consigne ne la touche pas',
    'un id absent de la feuille de route, ou hors forme : rien ne change, et tu le dis à la personne',
  ]) assert.ok(launch.includes(part), `absent : « ${part} »`)
})

// Au relevé d'une mission de tri close, le COO lit la section « Entrées triées » de son compte rendu validé. Invariant,
// fixé par la personne : il ne change que l'état d'une entrée « À reprendre » rattachée à la mission qu'il relève.
test('le relevé d’une mission de tri : le skill du COO porte l’invariant mot pour mot et les sept sorts, et nomme la section comme le gabarit du compte rendu', () => {
  const section = SKILL.slice(SKILL.indexOf('## Les choses à reprendre'), SKILL.indexOf('## D\'où viennent tes faits'))
  const invariant = '« Le COO ne change que l\'état d\'une entrée « À reprendre » rattachée à la mission qu\'il relève ; jamais son id ni son texte ; une entrée ne quitte jamais le fichier ; elle ne passe à « faite : » que d\'après le compte rendu validé de cette mission ; une ligne hors forme ne change rien. »'
  assert.ok(section.includes(invariant), 'invariant absent ou reformulé')
  for (const part of [
    'dite « faite, ticket(s) … » : écris « faite : <mission>, ticket <n> » (ou « tickets <n>, <m> »)',
    'dite « écartée — <raison> » : propose « écartée : <raison> », et ne l\'écris qu\'avec l\'accord de la personne',
    'dite « renvoyée » : propose de la remettre « à décider », et ne l\'écris qu\'avec son accord',
    'dite « pour toi » ou « question ouverte » : elle reste rattachée',
    'l\'id d\'une entrée à un autre état (« à décider », rattachée à une autre mission, déjà « faite : » ou « écartée : ») : rien ne change',
    'un id absent de la feuille de route, d\'une autre section, ou hors forme : rien ne change',
    'une ligne hors forme, une section absente ou « Rien. » : rien ne change',
    'tu ne changes aucun état d\'après lui',
    'quand ton relevé dit qu\'une autre mission du projet a le même titre, « rattachée à » ne dit plus laquelle : tu ne changes aucun état d\'après ce compte rendu',
    'chaque « · » d\'un titre ou d\'une raison s\'écrit « - »',
    'ou son fichier ne porte pas le tour validé que donne ton relevé',
    'Les entrées qui restent « rattachée à » cette mission, quel que soit le cas, tu les nommes à la personne avant d\'envoyer `gleaned`',
    'Si c\'est ta ligne et qu\'elle est fausse (« faite : » sans suite, hors de « À reprendre », un « · » resté dans un titre ou une raison), propose à la personne de la remettre au format (« ↺ Réparer » de la vue Coordination), en ne changeant que son statut, jamais son id ni son texte',
    'Une autre ligne que la tienne : ne touche pas à ta ligne',
    'un fichier qui ne se relit pas : rien non plus, et tu n\'envoies pas `gleaned`',
    'jamais après un relevé qui ne montre plus la mission close et validée',
    'une sous-ligne renvoyée devient une entrée neuve parce que le manager l\'a déclarée mise de côté',
    'n\'envoie `gleaned` qu\'une fois ces états écrits ou refusés par la personne',
    'sans jamais réécrire l\'état pour contourner',
    'ou valider le compte rendu d\'une mission qui l\'a corrigée',
  ]) assert.ok(section.includes(part), `absent : « ${part} »`)
  // Le même titre de section au gabarit du compte rendu, au skill du COO et à la ligne du relevé.
  const template = read('skills/compte-rendu/SKILL.md')
  assert.ok(/^## Entrées triées$/m.test(template), 'le gabarit n’a plus la section « Entrées triées »')
  assert.ok(section.includes('sa section « Entrées triées »'), 'le skill du COO ne nomme pas la section')
  assert.ok(read('hooks/coo.ts').includes('also read its section « Entrées triées »'), 'la ligne du relevé ne nomme pas la section')
})
