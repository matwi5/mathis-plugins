// Tests du rendu du récap : `node --test plugins/stats-board/skills/recap/recap.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render as rawRender, modelName, heatOf, sessionInfo, labelsOf, labelOf } from './recap.mjs'

// Les espaces insécables fines des nombres deviennent des espaces, pour des motifs lisibles.
const render = (data) => rawRender(data).replace(/\u202f/g, ' ')

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
