// Tests du rendu du récap : `node --test plugins/stats-board/skills/recap/recap.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render as rawRender, renderParcours as rawRenderParcours, titleOf, modelName, heatOf, sessionInfo, labelsOf, labelOf } from './recap.mjs'

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

test('la discussion compte ses sous-agents et ses modèles', () => {
  const out = render(base)
  assert.match(out, /### Cette discussion\n\n- \*\*12,00 \$\*\* · 12 M tokens, dont 90 % lus en cache/)
  assert.match(out, /14:00 → 17:30 \(3 h 30\) · projet app/)
  assert.match(out, /Opus 5.5 10,00 \$ \(83 %\) · Sonnet 5.5 2,00 \$ \(17 %\)/)
  assert.match(out, /Dont 1 sous-agent de workflow : 2,00 \$/)
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

test('noms de modèles, rythme et rattachement des sous-agents', () => {
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

// ─── Récap d'un parcours ────────────────────────────────────────────────────

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

test('le parcours par préfixe de titre somme ses sessions et leurs sous-agents', () => {
  const out = renderParcours({ ...parcours, prefix: 'Refonte UI' })
  assert.match(out, /^## Récap du parcours « Refonte UI »/)
  assert.match(out, /- \*\*17,00 \$\*\* · 2 sessions · /)
  assert.match(out, /Opus 5.5 12,00 \$ \(71 %\) · Sonnet 5.5 5,00 \$ \(29 %\)/)
  assert.match(out, /^\| Refonte UI \| app \| 12\/10 10:00 → 14\/10 17:00 \| 2 j 7 h \| 10,00 \$ \|$/m)
  assert.match(out, /^\| Refonte UI › Groupe A · Incognito \| app · groupe-A \| 13\/10 11:00 → 13\/10 13:30 \| 2 h 30 \| 7,00 \$ \|$/m)
  assert.doesNotMatch(out, /Autre chose|40,00/)
})

test('le parcours par worktrees groupe-* prend leurs sessions, et la discussion principale si elle est donnée', () => {
  const out = renderParcours({ ...parcours, worktreesKey: '-Users-m-app', sessionId: MAIN })
  assert.match(out, /^## Récap du parcours · worktrees groupe-\* de app/)
  assert.match(out, /- \*\*24,00 \$\*\* · 3 sessions · /)
  assert.match(out, /^\| \(sans titre\) \| app · groupe-A \| 01\/10 10:00 → 01\/10 11:00 \| 1 h 00 \| 7,00 \$ \|$/m)
  assert.match(out, /\| Refonte UI \| app \|/)
  assert.doesNotMatch(out, /Autre chose|40,00|non comptée/)

  const alone = renderParcours({ ...parcours, worktreesKey: '-Users-m-app' })
  assert.match(alone, /- \*\*14,00 \$\*\* · 2 sessions · /)
  assert.match(alone, /Discussion principale non comptée/)
  assert.doesNotMatch(renderParcours({ ...parcours, worktreesKey: '-Users-m-ap' }), /groupe-A/)
})

test('le titre complet d’un parcours retrouve aussi les sessions liées au titre raccourci', () => {
  const long = 'Cloisonnement « espace » privé, file et saisie'
  const titles = { [MAIN]: long, [LINKED]: 'Cloisonnement espace… › Groupe A · Saisie', other: 'Cloisonnement… autre' }
  const out = renderParcours({ ...parcours, titles, prefix: long })
  assert.match(out, /- \*\*17,00 \$\*\* · 2 sessions · /)
  assert.match(out, /\| Cloisonnement espace… › Groupe A · Saisie \|/)
  assert.doesNotMatch(renderParcours({ ...parcours, titles, prefix: 'Cloisonnement privé' }), /Groupe A/)
})

test('une période bornée à la fin est rappelée', () => {
  const out = renderParcours({ ...parcours, prefix: 'Refonte UI', until: '2026-10-20' })
  assert.match(out, /sessions retrouvées du 15\/08\/2026 au 20\/10\/2026\./)
})

test('un parcours sans session retrouvée le dit', () => {
  const out = renderParcours({ ...parcours, prefix: 'Inconnu' })
  assert.match(out, /Aucune session retrouvée depuis le 15\/08\/2026/)
  assert.doesNotMatch(out, /\| Session \|/)
})
