import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Relay } from '../types'

// Rétro « Coordinateur de parcours » : le compte rendu d'un worker, déjà écrit dans un fichier, était
// relu puis recollé en entier dans l'appel de l'outil (10 à 12 ko, trois passages). Le worker peut donner
// son chemin (`reportPath`) ; le mod ne lit ce fichier que sous le worktree du worker ou son dossier
// temporaire (choix déclaré : la recommandation la plus prudente), puis il suit le chemin de `report`.

const TOOL = 'mcp__flow-board__flow'
const T0 = 95_000_000
const WT = '/repo/.claude/worktrees/groupe-x-C'
const JOB = '/var/jobs/abc/tmp'

type Opts = { root?: string; job?: string | null; changing?: string; links?: Record<string, string> }

/** Le faux moteur : un disque (`files`), des dossiers, des liens (`links` : chemin → chemin résolu) et un store. */
const world = (on: any, opts: Opts = {}) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const dirs = new Set([WT, JOB, '/elsewhere', '/repo', ...(typeof opts.job === 'string' ? [opts.job] : [])])
  const links = opts.links ?? {}
  // Les lectures de chaque fichier : un autre fichier lu avant (le fichier des missions) ne compte pas.
  const reads: Record<string, number> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-fille' }))
  on('session.root', () => ({ value: opts.root ?? WT }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'CLAUDE_JOB_DIR' ? (opts.job === undefined ? JOB : (opts.job ?? undefined)) : undefined }) as any)
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  const resolved = (p: string): string => links[p] ?? p
  on('fs.stat', (_$: unknown, e: { path: string; resolve?: boolean; options?: { resolve?: boolean } }) => {
    const real = resolved(e.path)
    if (dirs.has(real)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: real !== e.path, realPath: real } } as any
    if (!(real in files)) throw new Error(`ENOENT ${e.path}`)
    // `changing` : le fichier change entre la première lecture de son état et la suivante.
    const mtimeMs = real === opts.changing && (reads[real] ?? 0) > 0 ? 2 : 1
    return { value: { kind: 'file', size: new TextEncoder().encode(files[real]!).length, mtimeMs, isLink: real !== e.path, realPath: real } } as any
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    reads[e.path] = (reads[e.path] ?? 0) + 1
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', (_$: unknown, e: { path: string }) => ({
    value: Object.keys(files)
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: files[p]!.length, mtimeMs: 0, isLink: false })),
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  return { mem, files }
}

/** L'entrée de relais de cette session, d'où qu'elle soit gardée (fichier du relais ou store). */
const entryOf = (mem: Record<string, unknown>, files: Record<string, string>, runId: string): Relay['sessions'][string] | undefined => {
  const sources: unknown[] = [
    ...Object.entries(files)
      .filter(([p]) => p.includes('/flow-board/relais/') && p.endsWith('.json'))
      .map(([, text]) => JSON.parse(text)),
    ...Object.entries(mem)
      .filter(([k]) => k.startsWith(`relay:${runId}`))
      .map(([, v]) => v),
  ]
  for (const s of sources) {
    const relay = s as { sessions?: Relay['sessions']; session?: string; entry?: Relay['sessions'][string] }
    if (relay.sessions?.['s-fille']) return relay.sessions['s-fille']
    if (relay.session === 's-fille' && relay.entry) return relay.entry
  }
  return undefined
}

/** La mission du groupe C, enregistrée par le manager, puis la déclaration de cette session. */
const declared = async ($: any, mem: Record<string, unknown>): Promise<string> => {
  const run = { ...newRun('implement', 1_000, 'Pistes'), owner: 's-main' }
  const board: Board = applyReport({ ...emptyBoard('', 'p'), session: 's-main', deleted: [], runs: [run], activeId: run.id }, { tickets: [{ id: '08', name: 'Neutraliser' }], groups: [{ id: 'C', name: 'Durcissement', tickets: ['08'] }] }, 2_000).board
  mem['board:'] = { ...board, activeId: null }
  const runId = activeRun(board)!.id
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  return runId
}

const REPORT = 'Compte rendu du groupe C\n\n- 08 : fait (abc1234)\n- revue : 0 constat'

test('un compte rendu donné par son chemin sous le worktree suit exactement le chemin de "report"', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on)
  const runId = await declared($, mem)
  files[`${WT}/notes/compte-rendu.md`] = REPORT
  const out = (await $.tool.call({ tool: TOOL, reportPath: `${WT}/notes/compte-rendu.md` } as any)) as { result: string }
  expect(out.result).toMatch(/^Relayed to the manager's dashboard: the final report\./)
  expect(out.result).not.toContain('refused')
  const entry = entryOf(mem, files, runId)
  expect(entry?.report?.text).toContain('Compte rendu du groupe C')
  expect(entry?.report?.text).toContain('08 : fait (abc1234)')
})

test('le même texte donné par "report" et par "reportPath" donne la même entrée de relais', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on)
  const runId = await declared($, mem)
  await $.tool.call({ tool: TOOL, report: REPORT } as any)
  const byText = entryOf(mem, files, runId)?.report?.text
  const reportFiles = (): [string, string][] => Object.entries(files).filter(([p]) => p.endsWith('.report.md'))
  const kept = reportFiles().map(([, text]) => text)
  // Un autre compte rendu entre les deux : l'égalité finale ne peut venir que de l'appel par le chemin.
  await $.tool.call({ tool: TOOL, report: 'Autre texte' } as any)
  expect(entryOf(mem, files, runId)?.report?.text).toBe('Autre texte')
  files[`${JOB}/compte-rendu.md`] = REPORT
  await $.tool.call({ tool: TOOL, reportPath: `${JOB}/compte-rendu.md` } as any)
  expect(entryOf(mem, files, runId)?.report?.text).toBe(byText!)
  // Le fichier `.report.md` du relais (écrit là où le mod trouve ~/.claude : la suite complète) : le même texte, sauts de ligne compris.
  expect(reportFiles().map(([, text]) => text)).toEqual(kept)
  for (const [, text] of reportFiles()) expect(text).toBe(REPORT.trim())
})

test('un chemin dans le dossier temporaire de la session (CLAUDE_JOB_DIR) se lit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, { root: '/repo' })
  const runId = await declared($, mem)
  files[`${JOB}/notes-compte-rendu.txt`] = REPORT
  const out = (await $.tool.call({ tool: TOOL, reportPath: `${JOB}/notes-compte-rendu.txt` } as any)) as { result: string }
  expect(out.result).toMatch(/^Relayed to the manager's dashboard: the final report\./)
  expect(entryOf(mem, files, runId)?.report?.text).toContain('Compte rendu du groupe C')
})

/** Un appel refusé : la réponse le dit, et rien du compte rendu ne part. */
const refused = async ($: any, on: any, setup: (files: Record<string, string>) => unknown, opts: Opts = {}, extra: Record<string, unknown> = {}): Promise<string> => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, opts)
  const runId = await declared($, mem)
  const reportPath = setup(files)
  const out = (await $.tool.call({ tool: TOOL, reportPath, ...extra } as any)) as { result: string }
  expect(out.result).toContain('"reportPath" refused:')
  expect(out.result).toContain('nothing of your report was relayed')
  expect(out.result).not.toContain('the final report')
  expect(entryOf(mem, files, runId)?.report).toBeUndefined()
  return out.result
}

test('un chemin hors du worktree et du dossier temporaire est refusé', async ($, on) => {
  const result = await refused($, on, f => {
    f['/elsewhere/compte-rendu.md'] = REPORT
    return '/elsewhere/compte-rendu.md'
  })
  expect(result).toContain('outside your worktree and your temporary folder')
})

test('un lien sous le worktree qui mène hors de lui est refusé (chemin résolu, puis vérifié)', async ($, on) => {
  const result = await refused(
    $,
    on,
    f => {
      f['/elsewhere/secret.md'] = 'secret'
      return `${WT}/lien.md`
    },
    { links: { [`${WT}/lien.md`]: '/elsewhere/secret.md' } },
  )
  expect(result).toContain('outside your worktree')
})

test('un chemin en .. qui sort du worktree est refusé', async ($, on) => {
  const result = await refused(
    $,
    on,
    f => {
      f['/repo/compte-rendu.md'] = REPORT
      return `${WT}/../../../compte-rendu.md`
    },
    { links: { [`${WT}/../../../compte-rendu.md`]: '/repo/compte-rendu.md' } },
  )
  expect(result).toContain('outside your worktree')
})

test('le dossier du projet, hors d’un worktree, n’ouvre rien', async ($, on) => {
  await refused($, on, f => {
    f['/repo/compte-rendu.md'] = REPORT
    return '/repo/compte-rendu.md'
  }, { root: '/repo', job: null })
})

test('un lien au nom en .md qui mène à un fichier d’un autre type, sous le worktree : refusé', async ($, on) => {
  const result = await refused(
    $,
    on,
    f => {
      f[`${WT}/config/credentials.yml`] = 'token: x'
      return `${WT}/cr.md`
    },
    { links: { [`${WT}/cr.md`]: `${WT}/config/credentials.yml` } },
  )
  expect(result).toContain('only a .md or .txt file')
})

test('un fichier absent : refusé', async ($, on) => {
  expect(await refused($, on, () => `${WT}/absent.md`)).toContain('no such file')
})

test('plus de 200 000 signes : refusé', async ($, on) => {
  const result = await refused($, on, f => {
    f[`${WT}/long.md`] = 'x'.repeat(200_001)
    return `${WT}/long.md`
  })
  expect(result).toContain('over 200000 characters')
})

test('un fichier vide : refusé', async ($, on) => {
  expect(await refused($, on, f => ((f[`${WT}/vide.md`] = '  \n'), `${WT}/vide.md`))).toContain('the file is empty')
})

test('un fichier sous un dossier caché : refusé', async ($, on) => {
  expect(await refused($, on, f => ((f[`${WT}/.claude/x.md`] = REPORT), `${WT}/.claude/x.md`))).toContain('hidden')
})

test('un fichier qui n’est ni .md ni .txt : refusé', async ($, on) => {
  expect(await refused($, on, f => ((f[`${WT}/.env`] = 'KEY=1'), `${WT}/.env`))).toContain('only a .md or .txt file')
})

test('un chemin relatif : refusé', async ($, on) => {
  expect(await refused($, on, f => ((f['notes.md'] = REPORT), 'notes.md'))).toContain('not an absolute path')
})

test('un fichier qui change pendant sa lecture : refusé', async ($, on) => {
  const result = await refused($, on, f => ((f[`${WT}/cr.md`] = REPORT), `${WT}/cr.md`), { changing: `${WT}/cr.md` })
  expect(result).toContain('changed while it was read')
})

/** "report" et "reportPath" dans le même appel, d'où qu'il vienne : aucun des deux n'est lu, rien ne part. */
const together = async ($: any, on: any, agentId?: string): Promise<void> => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on)
  const runId = await declared($, mem)
  files[`${WT}/cr.md`] = REPORT
  const out = (await $.tool.call({ tool: TOOL, report: 'autre texte', reportPath: `${WT}/cr.md`, ...(agentId ? { agentId } : {}) } as any)) as { result: string }
  expect(out.result).toContain('"report" and "reportPath" came together: neither was read, nothing of your report was relayed')
  expect(out.result).not.toContain('the final report')
  expect(entryOf(mem, files, runId)?.report).toBeUndefined()
}

test('"report" et "reportPath" ensemble : les deux refusés, rien ne part', async ($, on) => {
  await together($, on)
})

test('"report" et "reportPath" ensemble depuis un sous-agent du worker : rien ne part non plus', async ($, on) => {
  await together($, on, 'agent-1')
})

test('un lien sous le worktree vers un fichier d’un autre type hors des racines : refusé comme hors des racines, sans dire son type', async ($, on) => {
  const result = await refused(
    $,
    on,
    f => {
      f['/elsewhere/config.yml'] = 'token: x'
      return `${WT}/cr.md`
    },
    { links: { [`${WT}/cr.md`]: '/elsewhere/config.yml' } },
  )
  expect(result).toContain('outside your worktree')
  expect(result).not.toContain('only a .md or .txt file')
})

test('un dossier temporaire sous le worktree, dans un dossier caché de celui-ci : son fichier se lit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const job = `${WT}/.claude/jobs/x/tmp`
  const { mem, files } = world(on, { job })
  const runId = await declared($, mem)
  files[`${job}/cr.md`] = REPORT
  const out = (await $.tool.call({ tool: TOOL, reportPath: `${job}/cr.md` } as any)) as { result: string }
  expect(out.result).toMatch(/^Relayed to the manager's dashboard: the final report\./)
  expect(entryOf(mem, files, runId)?.report?.text).toContain('Compte rendu du groupe C')
})

test('un sous-agent du worker : le chemin n’est pas lu, rien ne part', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on)
  const runId = await declared($, mem)
  files[`${WT}/cr.md`] = REPORT
  const out = (await $.tool.call({ tool: TOOL, reportPath: `${WT}/cr.md`, agentId: 'agent-1' } as any)) as { result: string }
  expect(out.result).toContain('"reportPath" not read: a subagent does not send the final report')
  expect(entryOf(mem, files, runId)?.report).toBeUndefined()
})

test('hors d’un worker : le chemin n’est pas lu, et la réponse dit que le rapport va par "report"', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { files } = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  files[`${WT}/cr.md`] = REPORT
  const out = (await $.tool.call({ tool: TOOL, reportPath: `${WT}/cr.md` } as any)) as { result: string }
  expect(out.result).toContain('"reportPath" not read: only the worker of a group gives its final report by a path')
})
