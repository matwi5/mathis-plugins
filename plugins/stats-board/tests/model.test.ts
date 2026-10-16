import { describe, expect, test } from 'claude-code/testing'

import {
  DRAFTS,
  baseKey,
  NB,
  UNKNOWN,
  blockRate,
  blocksOf,
  blocksOfDay,
  bucketMinutes,
  compareDay,
  cwdOf,
  discussionOf,
  discussionsOfDay,
  estimateCosts,
  heatOf,
  isStale,
  unitPricesOf,
  filterOf,
  fitGrain,
  fmtCost,
  fmtDuration,
  fmtPct,
  fmtTokens,
  funFact,
  groupOf,
  keepHistory,
  keepSessions,
  machineFile,
  mergeMachines,
  modelColors,
  modelName,
  monthPlan,
  nameOfPath,
  ownHistory,
  parsePublished,
  projectKey,
  projectLabels,
  projectsOf,
  publishedOf,
  rowsOfDaily,
  selectRows,
  seriesOf,
  sessionsOf,
  streaksOf,
  sum,
  unpricedOf,
} from '../hooks/model.ts'
import type { BlockRow, SessionRow, Ui, UsageRow } from '../types'

const nb = (s: string) => s.replace(/ /g, NB)

const row = (date: string, project: string, model: string, cost: number, tokens = 100, machine = 'Portable'): UsageRow => ({ date, project, machine, model, input: tokens, output: 0, cacheWrite: 0, cacheRead: 0, cost })
const session = (id: string, project: string, last: number, machine = 'Portable'): SessionRow => ({ id, machine, project, parent: null, first: last - 3_600_000, last, cost: 1, tokens: 10, output: 1, models: ['claude-opus-5-5'] })

const UI: Ui = {
  tab: 'overview',
  period: 'all',
  machine: 'all',
  metric: 'cost',
  grain: 'day',
  project: null,
  model: null,
  sessionSort: 'cost',
  expanded: { models: false, projects: false, sessions: false, days: false },
}

describe('model : formats français', () => {
  test('tokens, coûts, pourcentages, durées', async () => {
    expect(fmtTokens(999)).toBe('999')
    expect(fmtTokens(85_400)).toBe(nb('85,4 k'))
    expect(fmtTokens(46_500_000)).toBe(nb('46,5 M'))
    expect(fmtTokens(21_900_000_000)).toBe(nb('21,9 Md'))
    expect(fmtTokens(3_000_000_000)).toBe(nb('3 Md'))
    expect(fmtTokens(120_000)).toBe(nb('120 k'))
    expect(fmtCost(0)).toBe(nb('0 $'))
    expect(fmtCost(4.56)).toBe(nb('4,56 $'))
    expect(fmtCost(9977.3)).toBe(nb('9 977 $'))
    expect(fmtPct(0.973)).toBe(nb('97 %'))
    expect(fmtPct(0.004)).toBe(nb('< 1 %'))
    expect(fmtDuration(45 * 60_000)).toBe(nb('45 min'))
    expect(fmtDuration(125 * 60_000)).toBe(nb('2 h 05'))
    expect(fmtDuration((19 * 24 + 23) * 3_600_000)).toBe(nb('19 j 23 h'))
  })

  test('noms des modèles et couleurs stables par famille', async () => {
    expect(modelName('claude-opus-5-5')).toBe(nb('Opus 5.5'))
    expect(modelName('claude-haiku-4-5-20251001')).toBe(nb('Haiku 4.5'))
    expect(modelName('claude-opus-4-1-20250805')).toBe(nb('Opus 4.1'))
    expect(modelName('claude-fable-5')).toBe(nb('Fable 5'))
    expect(modelName('claude-3-5-sonnet-20241022')).toBe(nb('Sonnet 3.5'))
    expect(modelName('model_placeholder_m50')).toBe('model_placeholder_m50')
    // Dans l'ordre d'usage : deux Opus voisins ont deux teintes bien distinctes.
    const colors = modelColors(['claude-opus-5-5', 'claude-opus-4-8', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'])
    expect(colors['claude-opus-5-5']).toBe('#9B7BEA')
    expect(colors['claude-opus-4-8']).toBe('#56B4E9')
    expect(colors['claude-haiku-4-5-20251001']).toBe('#D9A520')
  })

  test('une comparaison parlante pour les tokens de sortie', async () => {
    expect(funFact(500)).toBeNull()
    expect(funFact(86_000_000)).toMatch(/×\sÀ la recherche du temps perdu/)
    expect(funFact(100_000)).toMatch(/Le Petit Prince/)
  })
})

describe('model : lecture de ccusage', () => {
  test('daily --instances : une ligne par jour, projet et modèle ; le seau unknown', async () => {
    const rows = rowsOfDaily({
      projects: {
        'C--a': [{ date: '2026-10-01', modelBreakdowns: [{ modelName: 'claude-opus-5-5', inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4, cost: 1.5 }, { modelName: '<synthetic>', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 }] }],
        unknown: [{ date: '2026-10-02', inputTokens: 5, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 2, modelBreakdowns: [] }],
      },
    }, 'Portable')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ date: '2026-10-01', project: 'C--a', machine: 'Portable', model: 'claude-opus-5-5', input: 1, output: 2, cacheWrite: 3, cacheRead: 4, cost: 1.5 })
    expect(rows[1]!.project).toBe(UNKNOWN)
    expect(sum(rows).tokens).toBe(20)
  })

  test('le rapport tous agents (period) et les modèles sans prix', async () => {
    expect(rowsOfDaily({ daily: [{ period: '2026-10-07', agent: 'all', modelBreakdowns: [{ modelName: 'x', inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 }] }] }, 'Portable')[0]!.date).toBe('2026-10-07')
    expect(
      unpricedOf({ totals: { unpricedModels: ['claude-sonnet-5-5'] } }, { sessions: [{ modelBreakdowns: [{ modelName: 'claude-x-9', missingPricing: true }] }] }),
    ).toEqual(['claude-sonnet-5-5', 'claude-x-9'])
  })

  test('sessions et blocs : dates, creux écartés, projection du bloc actif', async () => {
    const sessions = sessionsOf({ sessions: [{ sessionId: 's', projectPath: 'C--a', firstActivity: '2026-10-01T08:00:00.000Z', lastActivity: '2026-10-01T09:00:00.000Z', totalCost: 2, totalTokens: 10, outputTokens: 3, modelsUsed: ['claude-opus-5-5'] }] }, 'Mac')
    expect(sessions[0]!.last - sessions[0]!.first).toBe(3_600_000)
    expect(sessions[0]!.machine).toBe('Mac')
    const blocks = blocksOf({
      blocks: [
        { id: 'gap-x', isGap: true, startTime: '2026-10-01T00:00:00.000Z' },
        { startTime: '2026-10-01T08:00:00.000Z', endTime: '2026-10-01T13:00:00.000Z', actualEndTime: null, isActive: true, isGap: false, tokenCounts: { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 }, costUSD: 3, models: [], burnRate: { costPerHour: 1.5 }, projection: { totalCost: 6, remainingMinutes: 90 } },
      ],
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ tokens: 10, cost: 3, costPerHour: 1.5, projectedCost: 6, remainingMinutes: 90, isActive: true })
  })

  test('les jours effacés par Claude Code restent dans le relevé, pour ce poste seulement', async () => {
    // Les lignes des autres postes reviennent par leurs fichiers publiés : jamais gardées ici.
    const previous = [row('2026-08-01', 'C--a', 'm', 5), row('2026-09-01', 'C--a', 'm', 7), row('2026-01-01', 'C--a', 'm', 9, 100, 'Serveur'), row('2026-07-01', 'x', 'm', 2, 100, 'Mac')]
    const fresh = [row('2026-09-01', 'C--a', 'm', 7), row('2026-09-02', 'C--a', 'm', 1)]
    const kept = keepHistory(fresh, previous, 'Portable')
    expect(kept.kept).toBe(1)
    expect(kept.rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-09-01', '2026-09-02'])
    const day = (d: string) => Date.UTC(2026, 9, Number(d))
    const sessions = keepSessions([session('s3', 'C--a', day('3'))], [session('s1', 'C--a', day('1')), session('m1', 'x', day('1'), 'Mac')], 'Portable')
    expect(sessions.map((s) => s.id)).toEqual(['s1', 's3'])
    // Poste resté inactif plus longtemps que les journaux : rien de frais, tout l'historique reste.
    expect(keepHistory([], previous, 'Portable').rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-09-01'])
    expect(keepSessions([], [session('s1', 'C--a', day('1'))], 'Portable').map((s) => s.id)).toEqual(['s1'])
  })

  test("l'historique de ce poste : ancien format, « Ce poste », fichier déjà publié, sans doublon", async () => {
    // Relevé gardé d'avant la 0.3.0 (schéma 2) : ses lignes sauf l'ancien PC.
    const legacy = { schema: 2, rows: [{ ...row('2026-08-01', 'C--a', 'm', 5), machine: undefined }, { ...row('2026-01-01', 'C--p', 'm', 9), isPast: true }], sessions: [{ id: 's0', project: 'C--a', parent: null, first: 1, last: 2, cost: 1, tokens: 1, output: 1, models: [] }] }
    const published = parsePublished({ schema: 1, machine: 'Portable', updatedAt: 1, tzOffset: 0, rows: [row('2026-08-01', 'C--a', 'm', 5), row('2026-08-02', 'C--a', 'm', 3)], sessions: [], projects: {} })
    const previous = { rows: [row('2026-07-01', 'C--a', 'm', 1, 100, 'Ce poste'), row('2026-07-02', 'x', 'm', 1, 100, 'Mac')], sessions: [] }
    const h = ownHistory('Portable', { previous, legacy, published })
    expect(h.rows.map((r) => `${r.date}:${r.machine}`).sort()).toEqual(['2026-07-01:Portable', '2026-08-01:Portable', '2026-08-02:Portable'])
    expect(h.sessions.map((s) => `${s.id}:${s.machine}`)).toEqual(['s0:Portable'])
  })
})

describe('model : postes', () => {
  test('publication puis relecture : le même contenu, au nom du poste qui publie', async () => {
    const projects = { 'C--a': { name: 'a', path: 'C:\\a' }, 'C--b': { name: 'b', path: 'C:\\b' } }
    const body = publishedOf({ machine: 'Portable', tzOffset: -120, rows: [row('2026-10-01', 'C--a', 'm', 3)], sessions: [session('s1', 'C--a', 1)], projects })
    // Seuls les projets cités partent.
    expect(Object.keys(body.projects)).toEqual(['C--a'])
    const back = parsePublished(JSON.parse(JSON.stringify({ ...body, updatedAt: 5 })))
    expect(back).toMatchObject({ machine: 'Portable', updatedAt: 5, tzOffset: -120 })
    expect(back!.rows[0]).toEqual(row('2026-10-01', 'C--a', 'm', 3))
    expect(back!.sessions[0]).toEqual(session('s1', 'C--a', 1))
    // Un fichier d'un autre format est écarté ; le nom du fichier suit le poste.
    expect(parsePublished({ schema: 99, machine: 'x', rows: [] })).toBeNull()
    expect(parsePublished({ schema: 1, rows: [] })).toBeNull()
    expect(machineFile('Mac mini')).toBe('Mac_mini.json')
  })

  test('fusion : un projet du même nom de dossier se rejoint, les autres gardent leur clé', async () => {
    const local = {
      machine: 'Portable',
      rows: [row('2026-10-01', 'C--dev-PolePredict', 'm', 10), row('2026-10-01', 'C--x-demo', 'm', 1)],
      sessions: [session('s1', 'C--dev-PolePredict', 10)],
      projects: { 'C--dev-PolePredict': { name: 'PolePredict', path: 'C:\\dev\\PolePredict' }, 'C--x-demo': { name: 'demo', path: 'C:\\x\\demo' } },
    }
    const mac = parsePublished({
      schema: 1,
      machine: 'Mac',
      updatedAt: 1,
      tzOffset: -120,
      rows: [row('2026-10-02', '-Users-m-dev-PolePredict', 'm', 2), row('2026-10-02', '-Users-m-solo', 'm', 4), row('2026-10-02', '-Users-m-Library-Application-Support-Claude-scratch-workspaces-a-b', 'm', 0.5)],
      sessions: [session('m1', '-Users-m-dev-PolePredict', 20)],
      projects: {
        '-Users-m-dev-PolePredict': { name: 'polepredict', path: '/Users/m/dev/PolePredict' },
        '-Users-m-solo': { name: 'solo', path: '/Users/m/solo' },
        '-Users-m-Library-Application-Support-Claude-scratch-workspaces-a-b': { name: 'b', path: '/Users/m/Library/Application Support/Claude/scratch-workspaces/a/b' },
      },
    })!
    const serveur = parsePublished({ schema: 1, machine: 'Serveur', updatedAt: 1, tzOffset: -120, rows: [row('2026-06-01', 'C--dev-PolePredict', 'm', 40)], sessions: [], projects: { 'C--dev-PolePredict': { name: 'PolePredict', path: 'C:\\dev\\PolePredict' } } })!
    // Le fichier de ce poste lui-même, s'il traînait, n'est pas compté deux fois.
    const self = parsePublished({ schema: 1, machine: 'Portable', updatedAt: 1, tzOffset: 0, rows: [row('2026-10-01', 'C--dev-PolePredict', 'm', 10)], sessions: [], projects: {} })!
    const m = mergeMachines(local, [mac, serveur, self])
    expect(m.machines).toEqual(['Portable', 'Mac', 'Serveur'])
    expect(m.sessionless).toEqual(['Serveur'])
    expect(sum(m.rows).cost).toBe(57.5)
    // PolePredict des trois postes sous la clé de ce poste (nom comparé sans la casse).
    const [pole] = projectsOf(m.rows, m.sessions, m.projects, 'cost')
    expect(pole).toMatchObject({ key: 'C--dev-PolePredict', sessions: 2 })
    expect(pole!.total.cost).toBe(52)
    expect(Object.fromEntries(Object.entries(pole!.byMachine).map(([k, v]) => [k, v.cost]))).toEqual({ Portable: 10, Mac: 2, Serveur: 40 })
    // Un projet propre au Mac garde sa clé et son dossier ; ses brouillons rejoignent ceux du desktop.
    expect(m.projects['-Users-m-solo']).toEqual({ name: 'solo', path: '/Users/m/solo' })
    expect(groupOf('-Users-m-Library-Application-Support-Claude-scratch-workspaces-a-b', m.projects)).toBe(DRAFTS)
    // Le filtre de poste.
    expect(sum(selectRows(m.rows, filterOf({ ...UI, machine: 'Mac' }, '2026-10-07'), m.projects)).cost).toBe(6.5)
    expect(m.sessions.map((s) => s.id)).toEqual(['s1', 'm1'])
  })
})

describe('model : projets', () => {
  test('la clé ccusage, le dossier lu dans une transcription, les brouillons réunis', async () => {
    expect(projectKey('C:\\Users\\moi\\.claude\\mods-locaux')).toBe('C--Users-moi--claude-mods-locaux')
    expect(cwdOf('{"type":"user","cwd":"C:\\\\Users\\\\moi\\\\projets\\\\demo","x":1}')).toBe('C:\\Users\\moi\\projets\\demo')
    expect(cwdOf('{"type":"summary"}')).toBeNull()
    expect(nameOfPath('C:\\Users\\moi\\projets\\demo', 'C:\\Users\\moi')).toBe('demo')
    expect(nameOfPath('C:\\Users\\moi', 'C:\\Users\\moi')).toBe('~')
    const draft = 'C--Users-moi-AppData-Roaming-Claude-scratch-workspaces-a-b-scratch-2026-10-02-30c222'
    expect(groupOf(draft, {})).toBe(DRAFTS)
    const labels = projectLabels(
      ['C--x-Bureau-Boutique', 'C--x-Projects-Boutique', 'C--Users-moi--claude-mods'],
      { 'C--x-Bureau-Boutique': { name: 'Boutique', path: 'C:\\x\\Bureau\\Boutique' }, 'C--x-Projects-Boutique': { name: 'Boutique', path: 'C:\\x\\Projects\\Boutique' } },
      'C--Users-moi',
    )
    expect(labels.get('C--x-Bureau-Boutique')).toBe('Bureau/Boutique')
    expect(labels.get('C--x-Projects-Boutique')).toBe('Projects/Boutique')
    // Sans dossier connu : la clé sans le préfixe du dossier personnel ; un worktree par son nom.
    expect(labels.get('C--Users-moi--claude-mods')).toBe('.claude-mods')
    expect(projectLabels(['C--dev-Pole--claude-worktrees-promo-478bbe', 'C--dev-Pole'], {}, 'C--Users-moi').get('C--dev-Pole--claude-worktrees-promo-478bbe')).toBe('promo-478bbe')
    expect(projectLabels(['C--dev-Pole'], {}, 'C--Users-moi').get('C--dev-Pole')).toBe('dev-Pole')
    // Un sous-agent de workflow compte pour le projet de sa session et s'y rattache.
    expect(sessionsOf({ sessions: [{ sessionId: 'w', projectPath: 'C--a\\d24c\\subagents\\workflows', lastActivity: '2026-10-01T09:00:00.000Z' }] }, 'Portable')[0]).toMatchObject({ project: 'C--a', parent: 'd24c' })
    expect(sessionsOf({ sessions: [{ sessionId: 's', projectPath: 'C--a', lastActivity: '2026-10-01T09:00:00.000Z' }] }, 'Portable')[0]!.parent).toBeNull()
  })
})

describe('model : projets mal lus et worktrees', () => {
  test('le dossier qui donne la clé passe avant celui où la session a commencé', async () => {
    const moved = '{"cwd":"/Users/m/Library/Application Support/Claude/scratch-workspaces/a/scratch-1"}\n{"cwd":"/Users/m/qwen-image-local"}\n'
    expect(cwdOf(moved, '-Users-m-qwen-image-local')).toBe('/Users/m/qwen-image-local')
    expect(cwdOf(moved)).toBe('/Users/m/Library/Application Support/Claude/scratch-workspaces/a/scratch-1')
    // Aucun ne donne la clé (`ssh-…`, clé tronquée) : le premier.
    expect(cwdOf(moved, 'ssh-e87f')).toBe('/Users/m/Library/Application Support/Claude/scratch-workspaces/a/scratch-1')
  })

  test('un dossier gardé qui ne donne pas sa clé est à relire', async () => {
    const scratch = { name: 'scratch-1', path: '/Users/m/Library/Application Support/Claude/scratch-workspaces/a/scratch-1' }
    expect(isStale('-Users-m-qwen-image-local', scratch)).toBe(true)
    expect(isStale('-Users-m-qwen-image-local', { name: 'qwen-image-local', path: '/Users/m/qwen-image-local' })).toBe(false)
    // Un worktree lu à son dépôt, une clé qui n'est pas un chemin, un dossier inconnu : gardés.
    expect(isStale('-Users-m-qwen-image-local--claude-worktrees-securite', { name: 'qwen-image-local', path: '/Users/m/qwen-image-local' })).toBe(false)
    expect(isStale('ssh-e87f', { name: 'm', path: '/Users/m' })).toBe(false)
    expect(isStale('-Users-m-x', { name: '', path: null })).toBe(false)
  })

  test('un worktree compte pour son dépôt, sur ce poste comme sur les autres', async () => {
    expect(baseKey('-Users-m-qwen-image-local--claude-worktrees-groupe-A')).toBe('-Users-m-qwen-image-local')
    expect(baseKey('-Users-m-qwen-image-local')).toBe('-Users-m-qwen-image-local')
    expect(groupOf('-Users-m-qwen-image-local--claude-worktrees-groupe-A', {})).toBe('-Users-m-qwen-image-local')
    // Ce poste (le Mac) n'a travaillé que dans des worktrees de qwen ; le PC, que dans un worktree de PolePredict.
    const wt = '-Users-m-qwen-image-local--claude-worktrees-groupe-A'
    const local = {
      machine: 'Mac',
      rows: [row('2026-10-14', wt, 'm', 3, 100, 'Mac'), row('2026-10-14', '-Users-m-PolePredict', 'm', 1, 100, 'Mac')],
      sessions: [],
      projects: {
        [wt]: { name: 'groupe-A', path: '/Users/m/qwen-image-local/.claude/worktrees/groupe-A' },
        '-Users-m-PolePredict': { name: 'PolePredict', path: '/Users/m/PolePredict' },
      },
    }
    const pc = parsePublished({
      schema: 1,
      machine: 'Portable',
      updatedAt: 1,
      tzOffset: -120,
      rows: [row('2026-10-12', 'C--dev-PolePredict--claude-worktrees-video-promo-30s-478bbe', 'm', 5)],
      sessions: [],
      projects: { 'C--dev-PolePredict--claude-worktrees-video-promo-30s-478bbe': { name: 'video-promo-30s-478bbe', path: 'C:\\dev\\PolePredict\\.claude\\worktrees\\video-promo-30s-478bbe' } },
    })!
    const m = mergeMachines(local, [pc])
    expect(m.projects['-Users-m-qwen-image-local']).toEqual({ name: 'qwen-image-local', path: '/Users/m/qwen-image-local' })
    const stats = projectsOf(m.rows, m.sessions, m.projects, 'cost')
    expect(stats.map((p) => [p.key, p.total.cost])).toEqual([
      ['-Users-m-PolePredict', 6],
      ['-Users-m-qwen-image-local', 3],
    ])
    expect(projectLabels(stats.map((p) => p.key), m.projects, '-Users-m').get('-Users-m-qwen-image-local')).toBe('qwen-image-local')
  })
})

describe('model : sessions SSH du desktop', () => {
  test('une session lancée du PC sur le Mac ne compte qu’une fois, chez le Mac', async () => {
    const id = 'e87ffa9d-13fe-4a47-9a55-36a9540cbd08'
    const local = {
      machine: 'Portable',
      rows: [row('2026-10-14', `ssh-${id}`, 'm', 0.41), row('2026-10-14', `ssh-autre`, 'm', 2), row('2026-10-14', 'C--dev-Pole', 'm', 1)],
      sessions: [session(id, `ssh-${id}`, 20), session('autre', 'ssh-autre', 21)],
      projects: { [`ssh-${id}`]: { name: 'moi', path: '/Users/moi' } },
    }
    const mac = parsePublished({ schema: 1, machine: 'Mac', updatedAt: 1, tzOffset: -120, rows: [row('2026-10-14', '-Users-moi', 'm', 0.41)], sessions: [session(id, '-Users-moi', 22)], projects: {} })!
    const m = mergeMachines(local, [mac])
    expect(sum(m.rows).cost).toBe(3.41)
    expect(m.sessions.map((s) => `${s.machine}:${s.id}`).sort()).toEqual(['Mac:e87ffa9d-13fe-4a47-9a55-36a9540cbd08', 'Portable:autre'])
    // Vu du Mac, la copie publiée par le PC est écartée de même.
    const pc = parsePublished({ schema: 1, machine: 'Portable', updatedAt: 1, tzOffset: -120, rows: local.rows, sessions: local.sessions, projects: local.projects })!
    const fromMac = mergeMachines({ machine: 'Mac', rows: mac.rows, sessions: mac.sessions, projects: {} }, [pc])
    expect(sum(fromMac.rows).cost).toBe(3.41)
  })
})

describe('model : discussion et rythme', () => {
  test('le coût par appel : le total de ccusage réparti selon les tokens et le barème du modèle', async () => {
    const { cost, entries } = discussionOf({
      totalCost: 10,
      totalTokens: 0,
      entries: [
        { timestamp: '2026-10-07T12:10:00.000Z', model: 'claude-opus-5-5', inputTokens: 0, outputTokens: 1000, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: 0 },
        { timestamp: '2026-10-07T12:00:00.000Z', model: 'claude-opus-5-5', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1000, costUSD: 0 },
        { timestamp: '2026-10-07T12:20:00.000Z', model: '<synthetic>', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: 0 },
      ],
    })
    // Triés par heure, sans les messages fabriqués par Claude Code.
    expect(entries.map((e) => e[3])).toEqual([0, 1000])
    const costs = estimateCosts(entries, cost, unitPricesOf([row('2026-10-01', 'C--a', 'claude-opus-5-5', 5, 1000)]))
    expect(Math.abs(costs.reduce((n, v) => n + v, 0) - 10) < 1e-9).toBe(true)
    // 1 000 tokens de cache lu coûtent bien moins que 1 000 tokens de sortie (0,1 contre 5).
    expect(Math.abs(costs[0]! * 50 - costs[1]!) < 1e-9).toBe(true)
  })

  test('les niveaux du rythme horaire et la durée des tranches de la frise', async () => {
    expect(heatOf(3).label).toBe('calme')
    expect(heatOf(7).label).toBe('posé')
    expect(heatOf(20).label).toBe('soutenu')
    expect(heatOf(25).level).toBe(3)
    expect(heatOf(48).label).toBe('en feu')
    expect(bucketMinutes(0, 3 * 3_600_000)).toBe(5)
    expect(bucketMinutes(0, 24 * 3_600_000)).toBe(30)
    expect(bucketMinutes(0, 20 * 86_400_000)).toBe(720)
  })
})

describe('model : filtres et agrégats', () => {
  const rows = [
    row('2026-09-01', 'C--a', 'claude-opus-5-5', 10),
    row('2026-10-01', 'C--a', 'claude-opus-5-5', 4),
    row('2026-10-06', 'C--b', 'claude-fable-5-1', 2),
    row('2026-10-06', 'C--a', 'claude-opus-4-8', 1, 100, 'Serveur'),
    row('2026-10-07', 'C--a', 'claude-opus-5-5', 3),
  ]

  test('période, poste, projet et modèle', async () => {
    const all = filterOf(UI, '2026-10-07')
    expect(sum(selectRows(rows, all, {})).cost).toBe(20)
    expect(sum(selectRows(rows, filterOf({ ...UI, period: '7' }, '2026-10-07'), {})).cost).toBe(10)
    expect(sum(selectRows(rows, filterOf({ ...UI, machine: 'Serveur' }, '2026-10-07'), {})).cost).toBe(1)
    expect(sum(selectRows(rows, filterOf({ ...UI, machine: 'Portable' }, '2026-10-07'), {})).cost).toBe(19)
    // Le serveur compte dans son projet.
    expect(sum(selectRows(rows, filterOf({ ...UI, project: 'C--a' }, '2026-10-07'), {})).cost).toBe(18)
    const [a, b] = projectsOf(rows, [], {}, 'cost')
    expect(a).toMatchObject({ key: 'C--a', members: 1 })
    expect(a!.byMachine['Serveur']!.cost).toBe(1)
    expect(b!.byMachine['Serveur']).toBeUndefined()
    expect(sum(selectRows(rows, filterOf({ ...UI, model: 'claude-fable-5-1' }, '2026-10-07'), {})).cost).toBe(2)
  })

  test('seaux continus, grain qui tient dans la largeur, mois en cours', async () => {
    const days = seriesOf(rows, 'day', '2026-10-01', '2026-10-07')
    expect(days).toHaveLength(7)
    expect(days[5]!.total.cost).toBe(3)
    expect(days[5]!.byModel.size).toBe(2)
    const weeks = seriesOf(rows, 'week', '2026-09-01', '2026-10-07')
    expect(weeks[0]!.key).toBe('2026-08-31')
    expect(fitGrain('day', '2026-01-01', '2026-10-07', 60)).toBe('week')
    expect(fitGrain('day', '2026-01-01', '2026-10-07', 30)).toBe('month')
    const plan = monthPlan(rows, '2026-10-07', 'cost')
    expect(plan.spent).toBe(10)
    expect(plan.lastMonth).toBe(10)
    expect(plan.lastMonthToDate).toBe(10)
    expect(Math.round(plan.projected)).toBe(44)
  })

  test('séries de jours actifs : record et série en cours', async () => {
    expect(streaksOf(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06'], '2026-10-07')).toEqual({ longest: 3, longestEnd: '2026-10-03', current: 2 })
    expect(streaksOf(['2026-10-07'], '2026-10-07').current).toBe(1)
    expect(streaksOf([], '2026-10-07')).toEqual({ longest: 0, longestEnd: null, current: 0 })
  })
})

describe('model : journée', () => {
  /** Paris en été : UTC+2. */
  const TZ = -120
  const at = (day: string, hour: number) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`)
  const sess = (id: string, first: number, last: number, cost: number, parent: string | null = null): SessionRow => ({ id, machine: 'Portable', project: 'C--a', parent, first, last, cost, tokens: 10, output: 1, models: parent ? ['claude-haiku-4-5-20251001'] : ['claude-opus-5-5'] })

  test('discussions du jour : commencées ou finies ce jour-là, sous-agents réunis à leur discussion', async () => {
    const list = discussionsOfDay(
      [
        // Commencée la veille, finie le 7 : comptée avec ses deux sous-agents, dont un de la veille.
        sess('a', at('2026-10-06', 8), at('2026-10-07', 10), 5),
        sess('a1', at('2026-10-06', 9), at('2026-10-06', 9), 1, 'a'),
        sess('a2', at('2026-10-07', 9), at('2026-10-07', 9), 2, 'a'),
        // Commencée le 7, finie le 8.
        sess('b', at('2026-10-07', 20), at('2026-10-08', 1), 9),
        // Ouverte du 5 au 9 : sans activité connue le 7, elle n'y est pas.
        sess('c', at('2026-10-05', 8), at('2026-10-09', 8), 50),
        // 23 h 30 UTC le 6 : déjà le 7 à Paris.
        sess('d', at('2026-10-06', 23) + 1_800_000, at('2026-10-06', 23) + 1_800_000, 0.5),
      ],
      '2026-10-07',
      TZ,
    )
    expect(list.map((d) => d.id)).toEqual(['b', 'a', 'd'])
    expect(list[1]).toMatchObject({ cost: 8, agents: 2, first: at('2026-10-06', 8), last: at('2026-10-07', 10), models: ['claude-opus-5-5', 'claude-haiku-4-5-20251001'] })
  })

  test('un jour dans ses 30 derniers jours : veille, moyenne par jour actif, rang', async () => {
    const rows = [
      row('2026-09-07', 'C--a', 'm', 100), // hors de la fenêtre du 8 septembre au 7 octobre
      row('2026-09-08', 'C--a', 'm', 2),
      row('2026-10-01', 'C--a', 'm', 12),
      row('2026-10-06', 'C--a', 'm', 4),
      row('2026-10-07', 'C--a', 'm', 3),
      row('2026-10-07', 'C--b', 'n', 2),
    ]
    expect(compareDay(rows, '2026-10-07', 'cost')).toEqual({ value: 5, previous: 4, average: 6, rank: 2, activeDays: 4 })
    expect(compareDay(rows, '2026-10-07', 'tokens').value).toBe(200)
    // Un jour sans rien : pas de rang ; sa fenêtre (4 septembre au 3 octobre) prend le 7 septembre.
    expect(compareDay(rows, '2026-10-03', 'cost')).toEqual({ value: 0, previous: 0, average: 38, rank: null, activeDays: 3 })
  })

  test('blocs de 5 h du jour et leur rythme par heure active', async () => {
    const block = (start: number, lastAt: number, cost: number, costPerHour: number | null = null): BlockRow => ({ start, end: start + 5 * 3_600_000, lastAt, isActive: costPerHour !== null, cost, tokens: 1, models: [], costPerHour, projectedCost: null, remainingMinutes: null })
    const blocks = [block(at('2026-10-06', 8), at('2026-10-06', 12), 40), block(at('2026-10-06', 20), at('2026-10-06', 23), 9), block(at('2026-10-07', 9), at('2026-10-07', 9) + 60_000, 1, 4.2)]
    // Le bloc de 20 h UTC le 6 finit à 1 h le 7 à Paris.
    expect(blocksOfDay(blocks, '2026-10-07', TZ)).toEqual(blocks.slice(1))
    expect(blockRate(blocks[0]!)).toBe(10)
    expect(blockRate(blocks[2]!)).toBe(4.2)
    expect(blockRate({ ...blocks[0]!, lastAt: blocks[0]!.start + 60_000 })).toBeNull()
  })
})
