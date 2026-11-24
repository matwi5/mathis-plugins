// Tests du rendu du récap : `node --test plugins/stats-board/skills/recap/recap.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render as rawRender, renderParcours as rawRenderParcours, titleOf, modelName, heatOf, sessionInfo, labelsOf, labelOf, readRequestLogs, measureTranscript, measureSession, countSpecialists, sessionPath, parcoursArgs, attachDiscussions } from './recap.mjs'

// Les espaces insécables fines des nombres deviennent des espaces, pour des motifs lisibles.
const render = (data) => rawRender(data).replace(/\u202f/g, ' ')

const renderParcours = (data) => rawRenderParcours(data).replace(/\u202f/g, ' ')

const ID = '11111111-2222-3333-4444-555555555555'
const tz = 'Europe/Paris'
const now = Date.parse('2026-10-14T16:00:00Z')
const today = '2026-10-14'

const session = (id, projectPath, first, last, cost, model = 'claude-opus-5-5') => ({
  sessionId: id,
  projectPath,
  firstActivity: first,
  lastActivity: last,
  totalCost: cost,
  totalTokens: cost * 1e6,
  cacheReadTokens: cost * 9e5,
  outputTokens: cost * 1e4,
  modelBreakdowns: [{ modelName: model, cost }],
})

const base = {
  now,
  tz,
  today,
  sessionId: ID,
  version: '20.0.32',
  daily: {
    projects: {
      '-Users-m-app': [{ date: today, project: '-Users-m-app', totalCost: 30, totalTokens: 5e7, modelBreakdowns: [{ modelName: 'claude-opus-5-5', cost: 30 }] }],
      '-Users-m-old': [{ date: '2026-10-13', project: '-Users-m-old', totalCost: 99, totalTokens: 1, modelBreakdowns: [] }],
    },
  },
  sessions: [
    session(ID, '-Users-m-app', '2026-10-14T12:00:00Z', '2026-10-14T15:30:00Z', 10),
    session('sub', `-Users-m-app/${ID}/subagents`, '2026-10-14T13:00:00Z', '2026-10-14T13:10:00Z', 2, 'claude-sonnet-5-5'),
    session('other', '-Users-m-app', '2026-10-14T08:00:00Z', '2026-10-14T09:00:00Z', 18),
    session('yesterday', '-Users-m-old', '2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z', 50),
  ],
  blocks: { blocks: [{ isActive: true, isGap: false, startTime: '2026-10-14T12:00:00Z', endTime: '2026-10-14T17:00:00Z', costUSD: 40, burnRate: { costPerHour: 25 }, projection: { totalCost: 50 } }] },
  projectNames: { '-Users-m-app': 'app', '-Users-m-old': 'old' },
  machine: 'Mac',
  others: [{ machine: 'Portable', updatedAt: now, cost: 5, tokens: 1e6 }],
}

test('la discussion compte ses spécialistes et ses modèles', () => {
  const out = render(base)
  assert.match(out, /### Cette discussion\n\n- \*\*12,00 \$\*\* · 12 M tokens, dont 90 % lus en cache/)
  assert.match(out, /14:00 → 17:30 \(3 h 30\) · projet app/)
  assert.match(out, /Opus 5.5 10,00 \$ \(83 %\) · Sonnet 5.5 2,00 \$ \(17 %\)/)
  assert.match(out, /Dont 1 spécialiste de workflow : 2,00 \$/)
})

test('la journée ne prend que les lignes du jour, et les autres postes s\'y ajoutent', () => {
  const out = render(base)
  assert.match(out, /### Aujourd'hui sur Mac\n\n- \*\*30,00 \$\*\* · 50 M tokens/)
  assert.doesNotMatch(out, /\| old \|/)
  assert.match(out, /Discussions actives aujourd'hui : 2 /)
  assert.match(out, /\| app \(celle-ci\) \| 14:00–17:30 \| 12,00 \$ \|/)
  assert.match(out, /Bloc de 5 h en cours \(depuis 14:00\) : 40,00 \$ · rythme 25,00 \$\/h, intense · projection 50,00 \$ à 19:00/)
  assert.match(out, /- Portable : 5,00 \$/)
  assert.match(out, /\*\*Tous les postes : 35,00 \$\*\*/)
})

test('une discussion sans appel enregistré le dit', () => {
  const out = render({ ...base, sessionId: '99999999-2222-3333-4444-555555555555' })
  assert.match(out, /Pas encore d'appel enregistré/)
})

test('une discussion devinée est signalée', () => {
  assert.match(render({ ...base, isGuessed: true }), /Discussion devinée/)
})

test('noms de modèles, rythme et rattachement des spécialistes', () => {
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5')
  assert.equal(modelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5')
  assert.equal(heatOf(6.9), 'calme')
  assert.equal(heatOf(32), 'en feu')
  assert.equal(sessionInfo({ projectPath: 'C--w-app\\abc\\subagents' }).parent, 'abc')
})

test('noms d’affichage de names.json : par nom de dossier, sans la casse, worktree après le projet', () => {
  const labels = labelsOf({ 'Qwen-Image-Local': ' Chambre noire ', vide: '  ', nombre: 3 })
  assert.deepEqual(labels, { 'qwen-image-local': 'Chambre noire' })
  assert.deepEqual(labelsOf(['x']), {})
  assert.deepEqual(labelsOf(null), {})
  assert.equal(labelOf('/Users/m/qwen-image-local', labels), 'Chambre noire')
  assert.equal(labelOf('C:\\dev\\qwen-image-local', labels), 'Chambre noire')
  assert.equal(labelOf('/Users/m/qwen-image-local/.claude/worktrees/dev', labels), 'Chambre noire · dev')
  assert.equal(labelOf('C:\\dev\\qwen-image-local\\.claude\\worktrees\\dev\\tools', labels), 'Chambre noire · dev')
  assert.equal(labelOf('/Users/m/autre', labels), null)
  assert.equal(labelOf('/Users/m/autre/.claude/worktrees/dev', labels), null)
})

// ─── Récap d'une mission ────────────────────────────────────────────────────

test('le titre d’une session est le dernier de sa transcription', () => {
  const text = [
    '{"type":"user","message":{"content":"customTitle"}}',
    '{"type":"custom-title","customTitle":"Avant","sessionId":"x"}',
    '{"type":"assistant"}',
    '{"type":"custom-title","customTitle":"L\'app › Groupe A · \\"Retrait\\"","sessionId":"x"}',
    '',
  ].join('\n')
  assert.equal(titleOf(text), 'L\'app › Groupe A · "Retrait"')
  // Une session jamais renommée n'a que son titre automatique ; un `custom-title` l'emporte toujours.
  const auto = '{"type":"ai-title","aiTitle":"Ancien","sessionId":"x"}\n{"type":"ai-title","aiTitle":"Refonte UI","sessionId":"x"}\n'
  assert.equal(titleOf(auto), 'Refonte UI')
  assert.equal(titleOf(`{"type":"custom-title","customTitle":"Donné","sessionId":"x"}\n${auto}`), 'Donné')
  assert.equal(titleOf('{"type":"user"}'), null)
  assert.equal(titleOf(''), null)
})

const MAIN = 'aaaaaaaa-0000-0000-0000-000000000001'
const LINKED = 'aaaaaaaa-0000-0000-0000-000000000002'
const WT = '-Users-m-app--claude-worktrees-groupe-A'
const parcours = {
  tz,
  since: '2026-08-15',
  sessions: [
    session(MAIN, '-Users-m-app', '2026-10-12T08:00:00Z', '2026-10-14T15:00:00Z', 10),
    session(LINKED, WT, '2026-10-13T09:00:00Z', '2026-10-13T11:30:00Z', 5, 'claude-sonnet-5-5'),
    session('sub-linked', `${WT}/${LINKED}/subagents`, '2026-10-13T10:00:00Z', '2026-10-13T10:20:00Z', 2),
    session('other', '-Users-m-app', '2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z', 40),
    session('sub-other', `-Users-m-app/other/subagents`, '2026-10-13T08:10:00Z', '2026-10-13T08:20:00Z', 3),
    session('untitled', WT, '2026-10-01T08:00:00Z', '2026-10-01T09:00:00Z', 7),
  ],
  titles: { [MAIN]: 'Refonte UI', [LINKED]: 'Refonte UI › Groupe A · Incognito', other: 'Autre chose' },
  projectNames: { '-Users-m-app': 'app', [WT]: 'app · groupe-A' },
}

test('la mission par préfixe de titre somme ses sessions et leurs spécialistes', () => {
  const out = renderParcours({ ...parcours, prefix: 'Refonte UI' })
  assert.match(out, /^## Récap de la mission « Refonte UI »/)
  assert.match(out, /Coût équivalent API d'après ccusage, spécialistes compris,/)
  assert.match(out, /- \*\*17,00 \$\*\* · 2 sessions · /)
  assert.match(out, /Opus 5.5 12,00 \$ \(71 %\) · Sonnet 5.5 5,00 \$ \(29 %\)/)
  assert.match(out, /^\| Refonte UI \| app \| 12\/10 10:00 → 14\/10 17:00 \| 2 j 7 h \| — \| 10,00 \$ \|$/m)
  assert.match(out, /^\| Refonte UI › Groupe A · Incognito \| app · groupe-A \| 13\/10 11:00 → 13\/10 13:30 \| 2 h 30 \| — \| 7,00 \$ \|$/m)
  assert.doesNotMatch(out, /Autre chose|40,00/)
})

test('la mission par worktrees groupe-* prend leurs sessions, et le manager s’il est donné', () => {
  const out = renderParcours({ ...parcours, worktreesKey: '-Users-m-app', sessionId: MAIN })
  assert.match(out, /^## Récap de la mission · worktrees groupe-\* de app/)
  assert.match(out, /- \*\*24,00 \$\*\* · 3 sessions · /)
  assert.match(out, /^\| \(sans titre\) \| app · groupe-A \| 01\/10 10:00 → 01\/10 11:00 \| 1 h 00 \| — \| 7,00 \$ \|$/m)
  assert.match(out, /\| Refonte UI \| app \|/)
  assert.doesNotMatch(out, /Autre chose|40,00|non compté/)

  const alone = renderParcours({ ...parcours, worktreesKey: '-Users-m-app' })
  assert.match(alone, /- \*\*14,00 \$\*\* · 2 sessions · /)
  assert.match(alone, /Manager non compté : son identifiant manque/)
  assert.doesNotMatch(renderParcours({ ...parcours, worktreesKey: '-Users-m-ap' }), /groupe-A/)
})

test('le titre complet d’une mission retrouve aussi ses workers au titre raccourci', () => {
  const long = 'Cloisonnement « espace » privé, file et saisie'
  const titles = { [MAIN]: long, [LINKED]: 'Cloisonnement espace… › Groupe A · Saisie', other: 'Cloisonnement… autre' }
  const out = renderParcours({ ...parcours, titles, prefix: long })
  assert.match(out, /- \*\*17,00 \$\*\* · 2 sessions · /)
  assert.match(out, /\| Cloisonnement espace… › Groupe A · Saisie \|/)
  assert.doesNotMatch(renderParcours({ ...parcours, titles, prefix: 'Cloisonnement privé' }), /Groupe A/)
  // Le séparateur « > » de flow-board 0.61.0, et « ' » tel que l'app affichait l'ancien « › ».
  for (const sep of ['>', "'"]) {
    const now = { ...titles, [LINKED]: `Cloisonnement espace… ${sep} Groupe A · Saisie` }
    assert.match(renderParcours({ ...parcours, titles: now, prefix: long }), /- \*\*17,00 \$\*\* · 2 sessions · /)
  }
})

test('une période bornée à la fin est rappelée', () => {
  const out = renderParcours({ ...parcours, prefix: 'Refonte UI', until: '2026-10-20' })
  assert.match(out, /sessions retrouvées du 15\/08\/2026 au 20\/10\/2026\./)
})

test('une mission sans session retrouvée le dit', () => {
  const out = renderParcours({ ...parcours, prefix: 'Inconnu' })
  assert.match(out, /Aucune session retrouvée depuis le 15\/08\/2026/)
  assert.doesNotMatch(out, /\| Session \|/)
})

// ─── Durées, d'après les fichiers de relevé des requêtes ───────────────────

/** Un fichier de relevé fictif : `[envoi ISO, minutes, durée API en s, coût]` par requête. */
const requestLog = (session, project, list) => ({
  schema: 1,
  session,
  openedAt: 0,
  project,
  requests: list.map(([sent, minutes, apiS, cost], i) => ({
    id: i + 1,
    sentAt: Date.parse(sent),
    endedAt: Date.parse(sent) + minutes * 60_000,
    realMs: minutes * 60_000,
    isOpen: false,
    tasks: 0,
    apiMs: apiS * 1000,
    agents: 0,
    models: { 'claude-opus-5-5': { calls: 1, input: 1, output: 1, cacheWrite: 0, cacheRead: 0, apiMs: apiS * 1000, genMs: 0, cost, isEstimated: false } },
  })),
  outside: {},
})

// Cette discussion : 14:00–14:30 et 14:20–14:50 (heure de Paris), 50 min sans double compte ; une autre sur l'API, 10:00–10:20.
const LOGS = [
  requestLog(ID, '-Users-m-app', [['2026-10-14T12:00:00Z', 30, 120, 1.5], ['2026-10-14T12:20:00Z', 30, 300, 4.25]]),
  requestLog('other', '-Users-m-api', [['2026-10-14T08:00:00Z', 20, 60, 0.5]]),
  // Hier : ne compte pas pour la journée.
  requestLog('yesterday', '-Users-m-old', [['2026-10-13T08:00:00Z', 60, 600, 9]]),
]

test('la discussion : temps actif sans double compte, temps API, requêtes, la plus chère', () => {
  const out = render({ ...base, requestLogs: LOGS })
  assert.match(out, /- Temps actif 50 min 00 · temps API 7 min 00 · 2 requêtes · la plus chère : 14:20, 4,25 \$/)
})

test('la journée : temps actif, temps cumulé et temps API du jour, par projet', () => {
  const out = render({ ...base, requestLogs: LOGS, projectNames: { ...base.projectNames, '-Users-m-api': 'api' } })
  assert.match(out, /- Temps actif 1 h 10 · temps cumulé 1 h 10 · temps API 8 min 00 · 3 requêtes/)
  assert.match(out, /\| Projet \| Coût \| Part \| Tokens \| Temps actif \| Temps cumulé \|/)
  assert.match(out, /\| app \| 30,00 \$ \| 100 % \| 50 M \| 50 min 00 \| 50 min 00 \|/)
  // Une discussion de plus en même temps (14:10–14:40) : le temps actif ne bouge pas, le temps cumulé l'ajoute.
  const busy = [...LOGS, requestLog('lie', '-Users-m-app', [['2026-10-14T12:10:00Z', 30, 60, 1]])]
  const both = render({ ...base, requestLogs: busy })
  assert.match(both, /- Temps actif 1 h 10 · temps cumulé 1 h 40 \(gagné 30 min 00 en parallèle\) · temps API 9 min 00 · 4 requêtes/)
  assert.match(both, /\| app \| 30,00 \$ \| 100 % \| 50 M \| 50 min 00 \| 1 h 20 \|/)
})

test('des spécialistes de fond en même temps : le temps cumulé compte chaque fil, le temps actif ne bouge pas', () => {
  // 14:00–14:30 (heure de Paris) : le fil principal à 14:00–14:05 et 14:25–14:30, un spécialiste de 14:05 à
  // 14:25, un autre de 14:10 à 14:20 : deux fils en même temps pendant 10 min.
  const at = (hhmm) => Date.parse(`2026-10-14T${hhmm}:00Z`)
  const log = requestLog(ID, '-Users-m-app', [['2026-10-14T12:00:00Z', 30, 60, 1]])
  log.requests[0].turnSpans = [[at('12:00'), at('12:05')], [at('12:25'), at('12:30')]]
  log.requests[0].agentSpans = [[at('12:05'), at('12:25')], [at('12:10'), at('12:20')]]
  const out = render({ ...base, requestLogs: [log] })
  // La discussion (suivie de sa requête la plus chère), puis la journée.
  assert.match(out, /- Temps actif 30 min 00 · temps cumulé 40 min 00 \(gagné 10 min 00 en parallèle\) · temps API 1 min 00 · 1 requête · la plus chère/)
  assert.match(out, /- Temps actif 30 min 00 · temps cumulé 40 min 00 \(gagné 10 min 00 en parallèle\) · temps API 1 min 00 · 1 requête\n/)
  assert.match(out, /\| app \| 30,00 \$ \| 100 % \| 50 M \| 30 min 00 \| 40 min 00 \|/)
  // Un spécialiste seul pendant que le fil principal attend : rien en parallèle, pas de temps gagné.
  log.requests[0].agentSpans = [[at('12:05'), at('12:25')]]
  assert.match(render({ ...base, requestLogs: [log] }), /- Temps actif 30 min 00 · temps API 1 min 00 · 1 requête/)
})

test('une question à boutons : son attente sort du temps actif, sauf les appels des spécialistes pendant ce temps', () => {
  // 14:00–14:30, une question de 14:05 à 14:25, un spécialiste appelé de 14:10 à 14:12 : 5 + 2 + 5 = 12 min actives.
  const at = (hhmm) => Date.parse(`2026-10-14T${hhmm}:00Z`)
  const log = requestLog(ID, '-Users-m-app', [['2026-10-14T12:00:00Z', 30, 120, 1.5]])
  log.requests[0].waits = [[at('12:05'), at('12:25')]]
  log.requests[0].busy = [[at('12:10'), at('12:12')]]
  const out = render({ ...base, requestLogs: [log] })
  assert.match(out, /- Temps actif 12 min 00 · attente de ta réponse 18 min 00 · temps API 2 min 00 · 1 requête/)
  // Une attente restée ouverte (redémarrage pendant la question) va jusqu'à la fin de la requête, jamais au-delà.
  log.requests[0].waits = [[at('12:20'), null]]
  log.requests[0].busy = []
  assert.match(render({ ...base, requestLogs: [log] }), /- Temps actif 20 min 00 · attente de ta réponse 10 min 00/)
})

test('sans fichier de relevé (avant la 0.10.0), les durées sont « — »', () => {
  const out = render({ ...base, requestLogs: [] })
  assert.match(out, /- Temps actif — · temps API — \(pas de relevé : discussion d'avant la 0\.10\.0\)/)
  assert.match(out, /\| app \| 30,00 \$ \| 100 % \| 50 M \| — \| — \|/)
})

test('fichiers de relevé lus sur le disque : récents ou de la discussion ; un JSON coupé est omis et signalé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recap-'))
  const put = (name, text, ageDays) => {
    writeFileSync(join(dir, name), text)
    const t = (now - ageDays * 86_400_000) / 1000
    utimesSync(join(dir, name), t, t)
  }
  put(`${ID}_1.json`, JSON.stringify(LOGS[0]), 5)
  put('other_2.json', JSON.stringify(LOGS[1]), 0)
  put('vieux_3.json', JSON.stringify(LOGS[2]), 30)
  // Une autre session l'écrit en ce moment.
  put('encours_4.json', JSON.stringify(LOGS[1]).slice(0, 40), 0)
  // Coupé pour de bon il y a un jour (plantage) : laissé de côté sans avertissement.
  put('plante_5.json', JSON.stringify(LOGS[1]).slice(0, 40), 1)
  const { logs, unreadable } = readRequestLogs(dir, (name, mtimeMs) => name.startsWith(`${ID}_`) || mtimeMs >= now - 2 * 86_400_000, now)
  assert.deepEqual(logs.map((l) => l.session).sort(), [ID, 'other'])
  assert.deepEqual(unreadable, ['encours_4.json'])
  const out = render({ ...base, requestLogs: logs, unreadable })
  assert.match(out, /⚠ 1 fichier de relevé illisible \(en cours d'écriture \?\), omis : relancer le récap\./)
  assert.match(out, /- Temps actif 50 min 00 · temps API 7 min 00 · 2 requêtes/)
  // Un fichier aux valeurs extrêmes (1e400 se lit Infinity, une requête nulle) : ses requêtes impossibles sont écartées.
  put('piege_6.json', JSON.stringify({ ...LOGS[1], session: 'piege' }).replace('"realMs":1200000', '"realMs":1e400').replace('"requests":[', '"requests":[null,'), 0)
  const trapped = readRequestLogs(dir, (name) => name === 'piege_6.json', now)
  assert.deepEqual(trapped.logs[0].requests, [])
  // Sans dossier de relevé : rien de lu, sans erreur.
  assert.deepEqual(readRequestLogs(join(dir, 'absent'), () => true), { logs: [], unreadable: [] })
})

test('la mission : temps actif sans double compte entre sessions qui tournent en même temps, et temps API total', () => {
  const sessions = [session(ID, '-Users-m-app', '2026-10-14T12:00:00Z', '2026-10-14T12:50:00Z', 10), session('lie', '-Users-m-app--claude-worktrees-groupe-A', '2026-10-14T12:40:00Z', '2026-10-14T13:10:00Z', 4)]
  const logs = [LOGS[0], requestLog('lie', '-Users-m-app--claude-worktrees-groupe-A', [['2026-10-14T12:40:00Z', 30, 240, 2]])]
  const out = renderParcours({ tz, since: '2026-10-01', worktreesKey: '-Users-m-app', sessionId: ID, sessions, titles: {}, projectNames: {}, requestLogs: logs })
  // 14:00–14:50 et 14:40–15:10 : 1 h 10 actives, 1 h 20 cumulées ; 2 + 5 + 4 min d'API.
  assert.match(out, /- Temps actif 1 h 10 \(sans double compte entre sessions\) · temps cumulé 1 h 20 \(gagné 10 min 00 en parallèle\) · temps API 11 min 00 · 3 requêtes/)
  assert.match(out, /\| Session \| Projet \| Heures \| Durée \| Actif \| Coût \|/)
  assert.match(out, /\| 30 min 00 \| 4,00 \$ \|/)
  // Une session de la mission sans relevé : le total le dit ; un fichier illisible d'une autre session ne compte pas.
  const partial = renderParcours({ tz, since: '2026-10-01', worktreesKey: '-Users-m-app', sessionId: ID, sessions, titles: {}, projectNames: {}, requestLogs: [LOGS[0]], unreadable: ['ailleurs_1.json'] })
  assert.match(partial, /\(sans double compte entre sessions, sans 1 session non relevée\)/)
  assert.doesNotMatch(partial, /illisible/)
})

// ─── Contexte et coût : mesure d'un transcript et bloc du récap de mission ───

/** Une réponse du fil principal (ou d'un spécialiste) : entrée, cache lu, cache écrit. */
const reply = (input, read, write, extra = {}) => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: 'REPERE-SECRET réponse' }], usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: 7 } }, ...extra })
const boundary = (trigger, pre, post) => JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { ...(trigger === undefined ? {} : { trigger }), preTokens: pre, postTokens: post, durationMs: 1000 } })
const userText = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const attachment = () => JSON.stringify({ type: 'attachment', attachment: { type: 'x' } })
const COMMAND = '<command-name>/compact</command-name>\n<command-message>compact</command-message>'

test('mesure : départ, maximum et fin du fil principal, spécialistes et réponses à zéro écartés', () => {
  const lines = [userText('REPERE-SECRET question'), reply(0, 0, 0), reply(10, 30_000, 1000), reply(5, 1_000_000, 0, { isSidechain: true }), reply(2, 80_000, 500), reply(1, 50_000, 0)]
  assert.deepEqual(measureTranscript(lines), { start: 31_010, max: 80_502, end: 50_001, compactions: [] })
  // Le maximum prend aussi la taille « avant » d'une compaction, plus grande que toute réponse.
  const compacted = [reply(1, 40_000, 0), boundary('auto', 500_000, 30_000), reply(1, 35_000, 0)]
  assert.deepEqual(measureTranscript(compacted), { start: 40_001, max: 500_000, end: 35_001, compactions: [{ before: 500_000, after: 30_000, kind: 'automatique' }] })
  // Une réponse en plusieurs passes (l'advisor entre deux) somme leurs usages : seule compte la dernière passe « message ».
  const passes = JSON.parse(reply(3, 1_359_854, 2309))
  passes.message.usage.iterations = [
    { type: 'message', input_tokens: 1, cache_read_input_tokens: 679_430, cache_creation_input_tokens: 994 },
    { type: 'advisor_message', input_tokens: 682_909, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    { type: 'message', input_tokens: 2, cache_read_input_tokens: 680_424, cache_creation_input_tokens: 1315 },
  ]
  assert.deepEqual(measureTranscript([reply(1, 1000, 0), JSON.stringify(passes)]), { start: 1001, max: 681_741, end: 681_741, compactions: [] })
  // Sans passe « message » lisible, l'usage d'ensemble reste.
  passes.message.usage.iterations = [{ type: 'advisor_message', input_tokens: 5 }, null]
  assert.equal(measureTranscript([JSON.stringify(passes)]).max, 1_362_166)
})

test('mesure : les trois genres de compaction, et un déclencheur illisible n’est jamais « automatique »', () => {
  const kinds = (lines) => measureTranscript([reply(1, 1000, 0), ...lines]).compactions.map((c) => c.kind)
  assert.deepEqual(kinds([boundary('auto', 9, 1), userText(COMMAND)]), ['automatique'])
  // Tapée, ou envoyée par flow-board à un manager : la commande suit la borne (à la 3e entrée, comme relevé).
  assert.deepEqual(kinds([boundary('manual', 9, 1), userText('résumé'), userText('méta'), userText(COMMAND)]), ['voulue'])
  // Un contenu en blocs de texte compte aussi.
  assert.deepEqual(kinds([boundary('manual', 9, 1), JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: COMMAND }] } })]), ['voulue'])
  // À la 7e entrée encore « voulue », à la 8e « plugin » : la fenêtre du relevé.
  const filler = (n) => Array.from({ length: n }, attachment)
  assert.deepEqual(kinds([boundary('manual', 9, 1), ...filler(6), userText(COMMAND)]), ['voulue'])
  assert.deepEqual(kinds([boundary('manual', 9, 1), ...filler(7), userText(COMMAND)]), ['plugin'])
  // Le plugin chez un worker : pas de commande, jusqu'à la fin du transcript.
  assert.deepEqual(kinds([boundary('manual', 9, 1), userText('résumé')]), ['plugin'])
  // Le résumé de la compaction, ou un message qui cite la balise sans commencer par elle, ne compte pas.
  assert.deepEqual(kinds([boundary('manual', 9, 1), JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: `${COMMAND} résumé` } })]), ['plugin'])
  assert.deepEqual(kinds([boundary('manual', 9, 1), userText(`Voici la commande : ${COMMAND}`)]), ['plugin'])
  // La commande d'une réponse (pas une entrée user) ne compte pas.
  assert.deepEqual(kinds([boundary('manual', 9, 1), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: COMMAND }] } })]), ['plugin'])
  // Une commande ne règle que la compaction qu'elle a lancée, la dernière : la précédente, sans commande, reste « plugin ».
  assert.deepEqual(kinds([boundary('manual', 9, 1), attachment(), boundary('manual', 8, 1), userText(COMMAND)]), ['plugin', 'voulue'])
  // Un déclencheur absent ou inconnu : « voulue », jamais « automatique ».
  assert.deepEqual(kinds([boundary(undefined, 9, 1)]), ['voulue'])
  assert.deepEqual(kinds([boundary('Auto', 9, 1)]), ['voulue'])
  assert.deepEqual(kinds([boundary(42, 9, 1)]), ['voulue'])
  assert.deepEqual(kinds([JSON.stringify({ type: 'system', subtype: 'compact_boundary' })]), ['voulue'])
})

test('mesure : ligne coupée sautée, transcript vide, mots d’une borne dans un texte, valeurs impossibles écartées', () => {
  // La dernière ligne d'un transcript en cours d'écriture.
  const cut = reply(1, 60_000, 0).slice(0, 40)
  assert.deepEqual(measureTranscript([reply(1, 1000, 0), cut]), { start: 1001, max: 1001, end: 1001, compactions: [] })
  // Sans réponse retenue : vide (tout à null), sans erreur.
  assert.deepEqual(measureTranscript([]), { start: null, max: null, end: null, compactions: [] })
  assert.deepEqual(measureTranscript([userText('x'), reply(0, 0, 0), reply(5, 5, 5, { isSidechain: true }), 'null', '[1]', '42']), { start: null, max: null, end: null, compactions: [] })
  // Une entrée dont le texte porte les mots d'une borne n'en est pas une.
  const mention = [reply(1, 1000, 0), userText('{"type":"system","subtype":"compact_boundary"} compact_boundary'), JSON.stringify({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'text', text: '"subtype":"compact_boundary"' }], usage: { input_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } })]
  assert.deepEqual(measureTranscript(mention).compactions, [])
  // Une taille infinie, négative ou d'un autre type est écartée, sans faire tomber le reste.
  const odd = [reply(1, 1000, 0), reply(1, 0, 0).replace('"cache_read_input_tokens":0', '"cache_read_input_tokens":1e400'), reply(-5, 1000, 0), reply('9', 1000, 0), boundary('auto', 1e400, -1).replace('null', '1e400')]
  assert.deepEqual(measureTranscript(odd), { start: 1001, max: 1001, end: 1001, compactions: [{ before: null, after: null, kind: 'automatique' }] })
})

test('mesure : le résultat ne porte que des nombres et des genres (liste blanche des clés), aucun texte de message', () => {
  const lines = [userText('REPERE-SECRET'), reply(1, 1000, 0), boundary('manual', 9, 1), userText(`${COMMAND} REPERE-SECRET`), reply(1, 2000, 0), '{"type":"user","message":"REPERE-SECRET coupé']
  const m = measureTranscript(lines)
  assert.deepEqual(Object.keys(m).sort(), ['compactions', 'end', 'max', 'start'])
  for (const c of m.compactions) assert.deepEqual(Object.keys(c).sort(), ['after', 'before', 'kind'])
  for (const v of [m.start, m.max, m.end, ...m.compactions.flatMap((c) => [c.before, c.after])]) assert.equal(typeof v, 'number')
  assert.deepEqual(m.compactions.map((c) => c.kind), ['voulue'])
  assert.doesNotMatch(JSON.stringify(m), /REPERE/)
  const out = renderParcours({ ...parcours, prefix: 'Refonte UI', measures: { [MAIN]: { measure: m, specialists: 0 } } })
  assert.match(out, /\| Manager · Refonte UI \| 1 k \| 2 k \| 2 k \| 1 : 9 → 1 \(voulue\) \| 10,00 \$ \|/)
  assert.doesNotMatch(out, /REPERE/)
})

test('mesure lue sur le disque par blocs, chemin construit du seul projet et id de ccusage, spécialistes listés', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recap-mesure-'))
  const project = '-Users-m-app'
  const id = 'aaaaaaaa-0000-0000-0000-00000000000f'
  // Une ligne plus longue que le bloc de lecture (1 Mio), faite de caractères sur deux octets.
  const lines = [reply(1, 1000, 0), userText('é'.repeat(1_500_000)), boundary('auto', 600_000, 40_000), reply(1, 45_000, 0)]
  mkdirSync(join(dir, project, id, 'subagents'), { recursive: true })
  writeFileSync(join(dir, project, `${id}.jsonl`), `${lines.join('\n')}\n${reply(1, 1, 0).slice(0, 30)}`)
  for (const f of ['agent-a1.jsonl', 'agent-a2.jsonl', 'agent-a2.meta.json', 'autre.jsonl']) writeFileSync(join(dir, project, id, 'subagents', f), '')
  const info = { project, id }
  assert.deepEqual(measureSession(dir, info), { start: 1001, max: 600_000, end: 45_001, compactions: [{ before: 600_000, after: 40_000, kind: 'automatique' }] })
  assert.equal(countSpecialists(dir, info), 2)
  // Transcript absent : non mesuré ; pas de dossier subagents : aucun spécialiste.
  assert.equal(measureSession(dir, { project, id: 'absent' }), null)
  assert.equal(countSpecialists(dir, { project, id: 'absent' }), 0)
  // Un projet ou un id qui sortirait du dossier des projets n'ouvre rien.
  for (const [p, i] of [['.', id], ['..', id], [project, `../${id}`], [`${project}/..`, id], [project, '..'], ['', id], [project, ''], [project, 'a\\b'], [project, `${id}\n`]]) {
    assert.equal(sessionPath(dir, p, i), null, `${p} ${i}`)
    assert.equal(measureSession(dir, { project: p, id: i }), null)
    assert.equal(countSpecialists(dir, { project: p, id: i }), 0)
  }
  assert.equal(sessionPath(dir, project, id), join(dir, project, `${id}.jsonl`))
  assert.equal(sessionPath(dir, project, id, 'subagents'), join(dir, project, id, 'subagents'))
})

/** Une mesure toute faite : départ, maximum, fin, et compactions `[avant, après, genre]`. */
const measured = (start, max, end, compactions = []) => ({ start, max, end, compactions: compactions.map(([before, after, kind]) => ({ before, after, kind })) })
const WB = '-Users-m-app--claude-worktrees-groupe-B'
const LINKED_B = 'aaaaaaaa-0000-0000-0000-000000000003'
const mission = {
  ...parcours,
  sessions: [...parcours.sessions, session(LINKED_B, WB, '2026-10-13T12:00:00Z', '2026-10-13T14:00:00Z', 4)],
  titles: { ...parcours.titles, [LINKED_B]: 'Refonte UI > Groupe B · Saisie' },
}

test('bloc « Contexte et coût » : un manager et deux workers, rôle et titre, compactions, spécialistes, total, hors norme', () => {
  const out = renderParcours({
    ...mission,
    prefix: 'Refonte UI',
    measures: {
      [MAIN]: { measure: measured(41_000, 386_000, 52_000, [[386_000, 38_000, 'voulue']]), specialists: 9 },
      [LINKED]: { measure: measured(38_000, 512_000, 204_000, [[512_000, 40_000, 'plugin']]), specialists: 1 },
      [LINKED_B]: { measure: measured(38_000, 590_000, 310_000, [[300_000, 30_000, 'plugin'], [590_000, 44_000, 'automatique']]), specialists: 0 },
    },
  })
  const block = out.slice(out.indexOf('## Contexte et coût'))
  assert.equal(block, [
    '## Contexte et coût',
    'Coût équivalent API, spécialistes compris.',
    '',
    '| Discussion | Départ | Maximum | Fin | Compactions | Coût |',
    '|---|---:|---:|---:|---|---:|',
    '| Manager · Refonte UI | 41 k | 386 k | 52 k | 1 : 386 k → 38 k (voulue) | 10,00 $ · 9 spécialistes |',
    '| Worker A · Refonte UI › Groupe A · Incognito | 38 k | 512 k | 204 k | 1 : 512 k → 40 k (plugin) | 7,00 $ · 1 spécialiste |',
    '| Worker B · Refonte UI > Groupe B · Saisie | 38 k | 590 k | 310 k | 2 : 300 k → 30 k (plugin), 590 k → 44 k (automatique) | 4,00 $ |',
    '| **Total** | | | | 4 | **21,00 $** |',
    '',
    'Hors norme : compaction automatique à 590 k chez Worker B ; contexte à 512 k chez Worker A et à 590 k chez Worker B (repère : 450 k pour un worker).',
  ].join('\n'))
  // Le récap existant ne change pas : le bloc s'ajoute à la fin.
  assert.ok(out.indexOf('| Session | Projet |') < out.indexOf('## Contexte et coût'))
})

test('bloc : « Rien hors norme. », une compaction automatique chez le manager, le repère au-delà de 450 000 pour un worker seul', () => {
  const at = (manager, worker, managerCompactions = []) => renderParcours({
    ...parcours,
    prefix: 'Refonte UI',
    measures: { [MAIN]: { measure: measured(1000, manager, 1000, managerCompactions), specialists: 0 }, [LINKED]: { measure: measured(1000, worker, 1000), specialists: 0 } },
  })
  assert.match(at(300_000, 450_000), /\n\nRien hors norme\.$/)
  assert.match(at(300_000, 450_001), /Hors norme : contexte à 450 k chez Worker A \(repère : 450 k pour un worker\)\.$/)
  // Un manager au-delà de 450 000 n'y paraît pas.
  assert.match(at(900_000, 1000), /\n\nRien hors norme\.$/)
  assert.match(at(600_000, 1000, [[600_000, 50_000, 'automatique']]), /Hors norme : compaction automatique à 600 k chez Manager\.$/)
  // « plugin » n'est sûr que chez un worker : chez le manager, la même compaction se dit « voulue ».
  assert.match(at(300_000, 1000, [[300_000, 30_000, 'plugin']]), /^\| Manager · Refonte UI \| 1 k \| 300 k \| 1 k \| 1 : 300 k → 30 k \(voulue\) \|/m)
  // Aucune discussion mesurée : ni total de compactions ni « Rien hors norme. ».
  const none = renderParcours({ ...parcours, prefix: 'Refonte UI' })
  assert.match(none, /\| \*\*Total\*\* \| \| \| \| — \| \*\*17,00 \$\*\* \|\n\nHors norme : rien à juger, aucune discussion mesurée\.$/)
})

test('bloc : transcript absent ou vide, rôle tiré du worktree ou du titre, barre verticale du titre échappée', () => {
  const out = renderParcours({
    ...parcours,
    worktreesKey: '-Users-m-app',
    sessionId: MAIN,
    titles: { [MAIN]: 'Refonte | UI', [LINKED]: 'Refonte UI › Groupe A · Incognito' },
    measures: { [LINKED]: { measure: measured(null, null, null), specialists: 2 } },
  })
  // Le manager sans mesure : « non mesuré » dans les trois colonnes, « — » pour ses compactions, le coût donné.
  assert.match(out, /^\| Manager · Refonte \\\| UI \| non mesuré \| non mesuré \| non mesuré \| — \| 10,00 \$ \|$/m)
  assert.match(out, /^\| Worker A · Refonte UI › Groupe A · Incognito \| non mesurée \(transcript vide\) \| \| \| 0 \| 7,00 \$ · 2 spécialistes \|$/m)
  // Un worktree groupe-* sans titre de worker : « Worker ».
  assert.match(out, /^\| Worker \| non mesuré \| non mesuré \| non mesuré \| — \| 7,00 \$ \|$/m)
  // Aucune mesure (absentes, ou transcript vide) : rien à juger.
  assert.match(out, /\| \*\*Total\*\* \| \| \| \| — \| \*\*24,00 \$\*\* \|\n\nHors norme : rien à juger, aucune discussion mesurée\.$/)
  // Une compaction automatique relevée dans un transcript sans réponse retenue reste nommée.
  const auto = renderParcours({ ...parcours, prefix: 'Refonte UI', measures: { [MAIN]: { measure: measured(null, null, null, [[600_000, 40_000, 'automatique']]), specialists: 0 } } })
  assert.match(auto, /\| \*\*Total\*\* \| \| \| \| 1 \| \*\*17,00 \$\*\* \|\n\nHors norme : compaction automatique à 600 k chez Manager\.$/)
  // Un id de groupe hors forme dans le titre : « Worker » seul.
  const odd = renderParcours({ ...parcours, prefix: 'Refonte UI', titles: { ...parcours.titles, [LINKED]: 'Refonte UI > Groupe Ä · x' } })
  assert.match(odd, /^\| Worker · Refonte UI > Groupe Ä · x \|/m)
})

// ─── Une mission désignée par ses discussions (`--discussions`) ─────────────

const UUID_M = 'abcdef01-0000-4000-8000-000000000001'
const UUID_A = 'abcdef02-0000-4000-8000-000000000002'
const UUID_A2 = 'abcdef03-0000-4000-8000-000000000003'

test('arguments : --discussions lu en couples rôle:id, majuscules acceptées, toute forme fautive refusée en nommant l’argument', () => {
  assert.equal(parcoursArgs(['abc']), null)
  const ok = parcoursArgs(['--discussions', `manager:${UUID_M},worker-A:ABCDEF02,diagnostic:${UUID_A2.toUpperCase()},worker-B12:abcdef04`, '--since', '2026-10-01'])
  assert.deepEqual(ok.discussions, [
    { role: 'manager', id: UUID_M },
    { role: 'worker-A', id: 'abcdef02' },
    { role: 'diagnostic', id: UUID_A2 },
    { role: 'worker-B12', id: 'abcdef04' },
  ])
  assert.equal(ok.since, '2026-10-01')
  const refused = (argv, pattern) => assert.throws(() => parcoursArgs(argv), (err) => pattern.test(err.message) && /<rôle>:<id>|--discussions/.test(err.message), argv.join(' '))
  const form = /attendu : <rôle>:<id>/
  for (const value of [
    `chef:${UUID_M}`, // rôle inconnu
    `worker-:${UUID_M}`, // id de groupe vide
    `worker-ABCDEFGHIJKLM:${UUID_M}`, // id de groupe de 13 signes
    `worker-Ä:${UUID_M}`, // id de groupe hors ASCII
    `Manager:${UUID_M}`, // rôle en majuscules
    'manager:abcdef0', // id de 7 signes
    'manager:abcdef012', // id de 9 signes
    'manager:local_0123abcd', // id de l'app Desktop
    `manager:${UUID_M.replace(/-/g, 'x')}`, // 36 signes hors forme
    `manager:${UUID_M.slice(0, 35)}-`, // 36 signes, tirets mal placés
    `manager:../${UUID_M}`, // chemin
    'manager:abcdef01/..', // chemin
    `manager${UUID_M}`, // couple sans « : »
    `manager:${UUID_M}:x`, // deux « : »
    `manager:${UUID_M},`, // couple vide en fin
    `,manager:${UUID_M}`, // couple vide en tête
    `manager:${UUID_M}, worker-A:abcdef02`, // espace
    `manager:${UUID_M}\nworker-A:abcdef02`, // saut de ligne
    'manager:abcdef0１', // chiffre pleine chasse
    `worker-K:${UUID_M}`, // signe Kelvin, sosie de « K »
    `worker-Аb:${UUID_M}`, // « А » cyrillique, sosie de « A »
    `manager:abcdef01\u200b`, // invisible
    `manager:abcdef01\u0085`, // C1
    `manager:abcdef01\u2028`, // séparateur de ligne
    `manager:abcdef01\t`, // tabulation
    `manager:${'a'.repeat(10_000)}`, // très longue
  ]) refused(['--discussions', value], form)
  refused([`--discussions=manager:${UUID_M}`], /argument inconnu : "--discussions=manager/)
  refused([` --Discussions=manager:${UUID_M}`], /argument inconnu : " --Discussions=manager/)
  // Avec --parcours, le refus d'un argument inconnu garde sa forme d'avant.
  assert.throws(() => parcoursArgs(['--parcours', 'X', `--discussions=manager:${UUID_M}`]), /^Error: argument inconnu : --discussions=manager:\S+ \(préfixe entre guillemets/)
  refused(['--discussions'], /--discussions attend une valeur/)
  refused(['--discussions', ''], /--discussions attend une valeur/)
  refused(['--discussions', `manager:${UUID_M}`, '--discussions', 'worker-A:abcdef02'], /--discussions donnée deux fois/)
  refused(['--discussions', `manager:${UUID_M}`, '--parcours', 'Refonte'], /--discussions ne se combine pas avec --parcours/)
  refused(['--worktrees', '/x', '--discussions', `manager:${UUID_M}`], /--discussions ne se combine pas avec --worktrees/)
  refused(['--discussions', `manager:${UUID_M}`, UUID_A], /--discussions ne se combine pas avec un id de manager/)
  // Un morceau de liste séparé par une espace : refusé, cité et suivi de la forme attendue.
  refused(['--discussions', `manager:${UUID_M}`, ',worker-A:abcdef02'], /argument inconnu : ",worker-A:abcdef02" \(une seule valeur après --discussions/)
  // C1, séparateurs, invisibles et direction : échappés dans le refus, jamais bruts.
  for (const c of ['\u009b', '\u0085', '\u2028', '\u2029', '\u202e', '\u200b', '\ufeff', '\u007f']) {
    assert.throws(() => parcoursArgs(['--discussions', `manager:${c}abc`]), (err) => !err.message.includes(c) && err.message.includes(`\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`))
  }
  // Le message ne recopie pas brute une valeur hors forme : les caractères de contrôle y sont échappés.
  assert.throws(() => parcoursArgs(['--discussions', 'manager:\u001b[31mabc']), (err) => !err.message.includes('\u001b') && err.message.includes('\\u001b'))
})

/** Des lignes de ccusage pour le rattachement : deux discussions de même début d'id, un spécialiste. */
const attachRows = [
  session(UUID_M, '-Users-m-app', '2026-10-12T08:00:00Z', '2026-10-14T15:00:00Z', 10),
  session(UUID_A, WT, '2026-10-13T09:00:00Z', '2026-10-13T11:30:00Z', 5),
  session('abcdef02-9999-4000-8000-000000000009', WT, '2026-10-13T12:00:00Z', '2026-10-13T12:30:00Z', 1),
  session(UUID_A2, WT, '2026-10-13T13:00:00Z', '2026-10-13T14:00:00Z', 3),
  session('abcdef05-0000-4000-8000-000000000005', `-Users-m-app/${UUID_M}/subagents`, '2026-10-13T10:00:00Z', '2026-10-13T10:20:00Z', 2),
].map(sessionInfo)

test('rattachement : id entier, id court unique, ambigu, introuvable, deux couples pour une ligne, ligne de spécialiste', () => {
  const pick = (discussions) => attachDiscussions(discussions, attachRows).map((d) => ({ role: d.role, id: d.id, row: d.row?.id ?? null, reason: d.reason ?? null }))
  assert.deepEqual(pick([{ role: 'manager', id: UUID_M }]), [{ role: 'manager', id: UUID_M, row: UUID_M, reason: null }])
  assert.deepEqual(pick([{ role: 'worker-A', id: 'abcdef03' }]), [{ role: 'worker-A', id: 'abcdef03', row: UUID_A2, reason: null }])
  assert.deepEqual(pick([{ role: 'worker-A', id: 'abcdef02' }]), [{ role: 'worker-A', id: 'abcdef02', row: null, reason: 'id ambigu' }])
  assert.deepEqual(pick([{ role: 'worker-C', id: '0123abcd' }, { role: 'diagnostic', id: 'ffffffff-0000-4000-8000-000000000000' }]), [
    { role: 'worker-C', id: '0123abcd', row: null, reason: 'discussion introuvable' },
    { role: 'diagnostic', id: 'ffffffff-0000-4000-8000-000000000000', row: null, reason: 'discussion introuvable' },
  ])
  // L'id court et l'id entier d'un même envoi : une seule ligne, sous le premier rôle donné.
  assert.deepEqual(pick([{ role: 'worker-B', id: 'abcdef03' }, { role: 'worker-A', id: UUID_A2 }]), [{ role: 'worker-B', id: 'abcdef03', row: UUID_A2, reason: null }])
  // Une ligne de spécialiste (`subagents`) n'est jamais une discussion, ni par son id entier ni par son début.
  assert.deepEqual(pick([{ role: 'worker-D', id: 'abcdef05-0000-4000-8000-000000000005' }, { role: 'worker-E', id: 'abcdef05' }]).map((d) => d.reason), ['discussion introuvable', 'discussion introuvable'])
  // Un id entier n'est jamais pris pour un début, et une ligne dont l'id n'a pas la forme d'un uuid n'est jamais rattachée.
  const odd = [...attachRows, ...['abcdef01-0000-4000-8000-000000000001x', 'abcdef06..x', 'abcdef07/../x'].map((id) => sessionInfo(session(id, '-Users-m-app', '2026-10-13T10:00:00Z', '2026-10-13T10:20:00Z', 1)))]
  const pickOdd = (discussions) => attachDiscussions(discussions, odd).map((d) => d.row?.id ?? d.reason)
  assert.deepEqual(pickOdd([{ role: 'manager', id: UUID_M }]), [UUID_M])
  assert.deepEqual(pickOdd([{ role: 'worker-A', id: 'abcdef06' }, { role: 'worker-B', id: 'abcdef07' }]), ['discussion introuvable', 'discussion introuvable'])
})

test('mission par ses discussions : seules celles données, rôles, non rattachées nommées, repère des workers et du diagnostic', () => {
  const discussions = attachDiscussions([
    { role: 'worker-A', id: UUID_A },
    { role: 'manager', id: UUID_M },
    { role: 'worker-C', id: '0123abcd' },
    { role: 'worker-A', id: 'abcdef02' },
    { role: 'diagnostic', id: UUID_A2 },
  ], attachRows)
  const out = renderParcours({
    tz,
    since: '2026-10-01',
    sessions: [...attachRows.map((r) => session(r.id, r.parent ? `${r.project}/${r.parent}/subagents` : r.project, new Date(r.first).toISOString(), new Date(r.last).toISOString(), r.cost)), session('autre', WT, '2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z', 40)],
    discussions,
    titles: { [UUID_M]: 'Refonte UI', [UUID_A]: 'Refonte UI > Groupe A · Saisie', autre: 'Refonte UI > Groupe Z · Autre' },
    projectNames: { '-Users-m-app': 'app', [WT]: 'app · groupe-A' },
    measures: {
      [UUID_M]: { measure: measured(40_000, 900_000, 50_000), specialists: 1 },
      [UUID_A]: { measure: measured(30_000, 450_001, 60_000), specialists: 0 },
      [UUID_A2]: { measure: measured(30_000, 500_000, 60_000), specialists: 0 },
    },
  })
  assert.match(out, /^## Récap de la mission · 5 discussions données\n/)
  // Le manager (10 $, et 2 $ de son spécialiste), le worker A (5 $) et le diagnostic (3 $) : ni « autre » ni la ligne ambiguë.
  assert.match(out, /- \*\*20,00 \$\*\* · 3 sessions · /)
  assert.doesNotMatch(out, /Groupe Z|40,00/)
  const block = out.slice(out.indexOf('## Contexte et coût'))
  assert.equal(block, [
    '## Contexte et coût',
    'Coût équivalent API, spécialistes compris.',
    '',
    '| Discussion | Départ | Maximum | Fin | Compactions | Coût |',
    '|---|---:|---:|---:|---|---:|',
    '| Manager · Refonte UI | 40 k | 900 k | 50 k | 0 | 12,00 $ · 1 spécialiste |',
    '| Worker A · Refonte UI > Groupe A · Saisie | 30 k | 450 k | 60 k | 0 | 5,00 $ |',
    '| Diagnostic | 30 k | 500 k | 60 k | 0 | 3,00 $ |',
    '| Worker C (0123abcd) | non mesurée (discussion introuvable) | | | | — |',
    '| Worker A (abcdef02) | non mesurée (id ambigu) | | | | — |',
    '| **Total** | | | | 0 | **20,00 $** |',
    '',
    'Hors norme : contexte à 450 k chez Worker A et à 500 k chez Diagnostic (repère : 450 k pour un worker).',
  ].join('\n'))
  // Le tableau des sessions ne porte que les discussions rattachées.
  assert.equal((out.match(/^\| .* \| app/gm) ?? []).length, 3)
})

test('mission par ses discussions : deux envois d’un même groupe ont chacun leur ligne, sous le même rôle ; aucune retrouvée', () => {
  const discussions = attachDiscussions([{ role: 'worker-A', id: UUID_A }, { role: 'worker-A', id: UUID_A2 }], attachRows)
  const out = renderParcours({ tz, since: '2026-10-01', sessions: attachRows.filter((r) => !r.parent).map((r) => session(r.id, r.project, new Date(r.first).toISOString(), new Date(r.last).toISOString(), r.cost)), discussions, titles: {} })
  assert.match(out, /^\| Worker A \| non mesuré \| non mesuré \| non mesuré \| — \| 5,00 \$ \|$/m)
  assert.match(out, /^\| Worker A \| non mesuré \| non mesuré \| non mesuré \| — \| 3,00 \$ \|$/m)
  // Aucune discussion retrouvée : le bloc dit encore chacune « non mesurée ».
  const none = renderParcours({ tz, since: '2026-10-01', sessions: [], discussions: attachDiscussions([{ role: 'manager', id: UUID_M }], []), titles: {} })
  assert.match(none, /^## Récap de la mission · 1 discussion donnée\n\nAucune discussion retrouvée depuis le 01\/10\/2026\./)
  assert.match(none, /^\| Manager \(abcdef01\) \| non mesurée \(discussion introuvable\) \| \| \| \| — \|$/m)
  assert.match(none, /\| \*\*Total\*\* \| \| \| \| — \| — \|\n\nHors norme : rien à juger, aucune discussion mesurée\.$/)
  // Deux couples du même id introuvable : une seule ligne.
  const twice = renderParcours({ tz, since: '2026-10-01', sessions: [], discussions: attachDiscussions([{ role: 'manager', id: 'abcdef01' }, { role: 'diagnostic', id: 'abcdef01' }], []), titles: {} })
  assert.equal((twice.match(/non mesurée \(discussion introuvable\)/g) ?? []).length, 1)
  // Un diagnostic a le repère de taille, mais « plugin » n'est sûr que chez un worker de groupe : « voulue ».
  const diag = renderParcours({ tz, since: '2026-10-01', sessions: [session(UUID_A2, WT, '2026-10-13T13:00:00Z', '2026-10-13T14:00:00Z', 3)], discussions: attachDiscussions([{ role: 'diagnostic', id: UUID_A2 }], attachRows), titles: {}, measures: { [UUID_A2]: { measure: measured(1000, 500_000, 1000, [[500_000, 40_000, 'plugin']]), specialists: 0 } } })
  assert.match(diag, /^\| Diagnostic \| 1 k \| 500 k \| 1 k \| 1 : 500 k → 40 k \(voulue\) \| 3,00 \$ \|$/m)
  assert.match(diag, /Hors norme : contexte à 500 k chez Diagnostic/)
})
