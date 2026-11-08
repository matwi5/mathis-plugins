// Le script des rapports des spécialistes d'une session (scripts/rapports-specialistes.mjs) : la rétro et
// la lecture d'un transcript compacté le nomment, pour lire les rapports sans relire chaque transcript
// (l'extraction des 1 041 spécialistes d'une mission avait manqué ceux rendus par la remise de fin).
// Ces tests le lancent pour de vrai sur un faux dossier de projet.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const SCRIPT = fileURLToPath(new URL('../scripts/rapports-specialistes.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

const line = o => JSON.stringify(o)
const assistant = (content, model = 'claude-opus-5-5', at = '2026-11-01T10:00:00.000Z') =>
  line({ type: 'assistant', timestamp: at, message: { model, role: 'assistant', content } })
const handback = (message, at) => assistant([{ type: 'tool_use', id: 't', name: 'SubagentHandback', input: { message } }], 'claude-opus-5-5', at)
const text = (t, at) => assistant([{ type: 'thinking', thinking: '' }, { type: 'text', text: t }], 'claude-opus-5-5', at)

/** Un dossier de projet avec la session `s` et ses spécialistes ; rend le chemin du transcript. */
const project = agents => {
  const dir = mkdtempSync(join(tmpdir(), 'rapports-'))
  const transcript = join(dir, 's.jsonl')
  writeFileSync(transcript, `${line({ type: 'user', message: { role: 'user', content: 'go' } })}\n`)
  const sub = join(dir, 's', 'subagents')
  mkdirSync(sub, { recursive: true })
  for (const a of agents) {
    if (a.meta !== undefined) writeFileSync(join(sub, `agent-${a.id}.meta.json`), typeof a.meta === 'string' ? a.meta : JSON.stringify(a.meta))
    writeFileSync(join(sub, `agent-${a.id}.jsonl`), `${a.lines.join('\n')}\n`)
  }
  return { dir, transcript }
}

const AGENTS = [
  {
    id: 'a1',
    meta: { agentType: 'general-purpose', description: 'Spec · 03', model: 'opus', effort: 'high', finished: true },
    lines: [text('je commence', '2026-11-01T10:00:00.000Z'), handback('premier rapport', '2026-11-01T10:01:00.000Z'), text('relancé', '2026-11-01T10:02:00.000Z'), handback('## Spec\nrapport final', '2026-11-01T10:03:00.000Z')],
  },
  {
    id: 'a2',
    meta: { agentType: 'agents:explorer', description: 'Carte du code', launchedWithDefaults: true, finished: false },
    lines: [text('premier texte', '2026-11-01T09:00:00.000Z'), 'pas du JSON {', assistant([{ type: 'text', text: 'dernier texte' }], 'claude-haiku-5-5', '2026-11-01T09:05:00.000Z')],
  },
  { id: 'a3', meta: '{ illisible', lines: [handback('rapport sans meta', '2026-11-01T11:00:00.000Z')] },
]

test('chaque spécialiste : nom, type, modèle, effort, fin et rapport final, la dernière remise de fin d’abord', () => {
  const { dir, transcript } = project(AGENTS)
  try {
    const r = run(transcript)
    assert.equal(r.status, 0, r.stderr)
    const out = r.stdout
    // Dans l'ordre de leur première ligne : a2 (9 h), a1 (10 h), a3 (11 h).
    assert.ok(out.indexOf('Carte du code') < out.indexOf('Spec · 03') && out.indexOf('Spec · 03') < out.indexOf('agent-a3'), out)
    assert.match(out, /=== Spec · 03\ntype : general-purpose · modèle : opus · effort : high · fini : oui · rapport : remise de fin\n/)
    assert.ok(out.includes('## Spec\nrapport final'), out)
    assert.ok(!out.includes('premier rapport'), 'une remise de fin plus ancienne a été prise')
    // Sans modèle ni effort dans le meta.json : le modèle du transcript, l'effort non donné au lancement.
    assert.match(out, /=== Carte du code\ntype : agents:explorer · modèle : claude-haiku-5-5 · effort : non donné au lancement · fini : non · rapport : dernier texte\n/)
    assert.ok(out.includes('dernier texte') && !out.includes('premier texte'), out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un meta.json ou une ligne illisible se signale et se saute sans arrêter le script', () => {
  const { dir, transcript } = project(AGENTS)
  try {
    const r = run(transcript)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /agent-a3\.meta\.json illisible/)
    assert.match(r.stderr, /agent-a2\.jsonl:2 illisible/)
    // Le spécialiste au meta.json illisible garde son rapport, sous le nom de son fichier.
    assert.match(r.stdout, /=== agent-a3\ntype : inconnu · modèle : claude-opus-5-5 · effort : non donné au lancement · fini : inconnu · rapport : remise de fin\n/)
    assert.ok(r.stdout.includes('rapport sans meta'), r.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--prefixe ne garde que les spécialistes dont le nom commence ainsi', () => {
  const { dir, transcript } = project(AGENTS)
  try {
    const r = run(transcript, '--prefixe', 'Spec · ')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(r.stdout.includes('=== Spec · 03'), r.stdout)
    assert.ok(!r.stdout.includes('Carte du code') && !r.stdout.includes('agent-a3'), r.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sans dossier subagents/ : une ligne, code 0 ; un argument qui n’est pas un transcript, ou un transcript absent : code 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rapports-'))
  try {
    const transcript = join(dir, 'seul.jsonl')
    writeFileSync(transcript, '\n')
    const r = run(transcript)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /aucun spécialiste/)
    assert.equal(run(join(dir, 'seul.txt')).status, 1)
    // Un transcript absent échoue, au lieu de passer pour une session sans spécialiste.
    const absent = run(join(dir, 'absent.jsonl'))
    assert.equal(absent.status, 1)
    assert.match(absent.stderr, /transcript introuvable/)
    assert.doesNotMatch(absent.stdout, /aucun spécialiste/)
    assert.equal(run().status, 1)
    assert.equal(run(transcript, '--prefixe').status, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('les spécialistes d’un Workflow, sous workflows/<run>/, comptent aussi ; un message d’erreur <synthetic> n’est ni le modèle ni le dernier texte', () => {
  const { dir, transcript } = project([AGENTS[0]])
  try {
    const run1 = join(dir, 's', 'subagents', 'workflows', 'wf_1')
    mkdirSync(run1, { recursive: true })
    writeFileSync(join(run1, 'agent-w1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'review:bugs', finished: true }))
    const lines = [text('vrai texte', '2026-11-01T12:00:00.000Z'), assistant([{ type: 'text', text: 'API Error: overloaded' }], '<synthetic>', '2026-11-01T12:01:00.000Z')]
    writeFileSync(join(run1, 'agent-w1.jsonl'), `${lines.join('\n')}\n`)
    const r = run(transcript)
    assert.equal(r.status, 0, r.stderr)
    // Le spécialiste a fini sur l'erreur : la ligne le dit, sans la prendre pour son rapport.
    assert.match(r.stdout, /=== review:bugs\ntype : general-purpose · modèle : claude-opus-5-5 · effort : non donné au lancement · fini : oui · rapport : dernier texte\nfin sur une erreur : API Error: overloaded\nfichier : workflows\/wf_1\/agent-w1\.jsonl\n\nvrai texte\n/)
    assert.ok(!r.stdout.includes('\n\nAPI Error'), r.stdout)
    // Un meta.json illisible d'un Workflow se signale avec son dossier.
    writeFileSync(join(run1, 'agent-w1.meta.json'), '{')
    assert.match(run(transcript).stderr, /workflows\/wf_1\/agent-w1\.meta\.json illisible/)
    assert.ok(r.stdout.includes('=== Spec · 03'), r.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('seuls les fichiers agent-<id>.jsonl du dossier comptent : ni sous-dossier ni autre fichier', () => {
  const { dir, transcript } = project([AGENTS[0]])
  try {
    const sub = join(dir, 's', 'subagents')
    writeFileSync(join(sub, 'notes.jsonl'), `${handback('intrus', '2026-11-01T08:00:00.000Z')}\n`)
    mkdirSync(join(sub, 'agent-x.jsonl'))
    // Un lien cassé se signale et se saute, sans arrêter le script (Windows sans droit de créer un lien : sauté).
    let hasLink = true
    try {
      symlinkSync(join(sub, 'absent'), join(sub, 'agent-casse.jsonl'))
    } catch {
      hasLink = false
    }
    const r = run(transcript)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!r.stdout.includes('intrus') && !r.stdout.includes('agent-x') && !r.stdout.includes('agent-casse'), r.stdout)
    if (hasLink) assert.match(r.stderr, /agent-casse\.jsonl illisible/)
    assert.ok(r.stdout.includes('=== Spec · 03'), r.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
