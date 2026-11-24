import { expect, mock, test } from 'claude-code/testing'

import { settle } from './horloge.ts'

// Les cinq cases d'autonomie du mode auto, sur la page « Réglages » de la vue Coordination. Invariant : « Une mission ne
// tranche jamais seule une sorte de question dont tu n'as pas coché la case par un clic ; une case absente, illisible ou
// mal lue vaut décochée, et la question t'est posée. » Cocher : tour fermé, siège, puis « Confirmer » ; décocher : le
// siège seul, pendant un tour comme tour fermé. Le disque est en mémoire, sous le dossier personnel `/h`.

const PLUGIN = 'flow-board'
const COO = 'flow-board:coo'
const ROOT = '/proj'
const NOW = 150_000_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const OFF = { experience: false, invariant: false, contradiction: false, spend: false, reread: false }
const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')
const isCasesFile = (path: string): boolean => /\/flow-board\/coordination\/[^/]+\.autonomie\.json$/.test(path)
const SEAT_LOST = '◆ Cette discussion ne tient plus le siège du COO : rien n’est fait.'
const TURN_OPEN = '◆ Claude travaille : reclique quand il a fini son tour.'

/** Le moteur sous le plugin, dans le projet /proj : disque en mémoire (`files`), toasts, pannes d'écriture à la demande. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const toasts: string[] = []
  /** `readCases` : le nombre de lectures suivantes du fichier des cases qui lèvent. */
  const fault = { write: false, readCases: 0 }
  /** Les écritures du fichier des cases (chemins), dans l'ordre. */
  const caseWrites: string[] = []
  /** Appelé juste après chaque écriture du fichier des cases (une autre discussion qui écrit entre-temps). */
  const hooks: { afterCaseWrite?: (path: string) => void } = {}
  on('session.end', () => ({ sessionId: 'session-A' }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'session-A' }))
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  const fileOf = (path: string): string | undefined =>
    path in files ? files[path] : isBoardFile(path) && mem[`board:${ROOT}`] !== undefined ? JSON.stringify(mem[`board:${ROOT}`]) : undefined
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: fileOf(e.path) !== undefined }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isCasesFile(e.path) && fault.readCases > 0) {
      fault.readCases -= 1
      throw new Error(`EIO ${e.path}`)
    }
    const text = fileOf(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = (e.path ?? '').replace(/\/+$/, '')
    const names = new Set(Object.keys(files).filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0]!))
    return { value: [...names].map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })) } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isCasesFile(e.path) || e.path.includes('.autonomie.json.illisible-')) {
      if (fault.write) throw new Error('EACCES')
      caseWrites.push(e.path)
    }
    files[e.path] = e.text
    if (isCasesFile(e.path)) hooks.afterCaseWrite?.(e.path)
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  return { mem, files, toasts, fault, caseWrites, hooks }
}
type World = ReturnType<typeof world>

const start = ($: any) => $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
const openCoo = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 4)
  await loading
  await settle(clock, 6)
}
const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
/** La page « Réglages » montée. */
const settings = async ($: any) => {
  const ui = await pane($)
  await ui.press({ key: 'coo-page-settings' })
  return ui
}
const texts = async (ui: any): Promise<string[]> => ((await ui.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? ''))
/** Un clic sur la page « Réglages », puis la page démontée. */
const press = async ($: any, key: string) => {
  const ui = await settings($)
  await ui.press({ key })
  await ui.unmount()
}
/** Les libellés des cinq cases, dans l'ordre de la page. */
const ticks = async ($: any): Promise<string[]> => {
  const ui = await settings($)
  const out: string[] = []
  for (const id of Object.keys(OFF)) out.push(String((await ui.find({ key: `coo-autonomy-tick-${id}` }))?.props?.label ?? '?'))
  await ui.unmount()
  return out
}
const casesPath = (w: World): string | undefined => Object.keys(w.files).find(isCasesFile)
const saved = (w: World): Record<string, unknown> | undefined => {
  const path = casesPath(w)
  return path ? (JSON.parse(w.files[path]!) as { cases: Record<string, unknown> }).cases : undefined
}
/** Le fichier des cases posé tel que le code l'écrit, avant le clic. */
const seed = async ($: any, w: World, cases: Partial<typeof OFF>) => {
  // Le chemin se découvre par une première écriture du mod (le nom du projet est une empreinte) : on coche puis on réécrit.
  await press($, 'coo-autonomy-tick-reread')
  await press($, 'coo-autonomy-confirm-reread')
  const path = casesPath(w)!
  w.files[path] = JSON.stringify({ v: 1, root: ROOT, cases: { ...OFF, ...cases }, at: NOW - 60_000 })
  w.caseWrites.length = 0
  w.toasts.length = 0
}
/** Une autre discussion prend le siège du COO. */
const loseSeat = (w: World) => {
  const other = { by: 'session-B', at: NOW + 20_000, seenAt: NOW + 20_000 }
  const at = Object.keys(w.files).find(isBoardFile)
  if (at) w.files[at] = JSON.stringify({ ...JSON.parse(w.files[at]!), coo: other })
  else w.mem[`board:${ROOT}`] = { ...(w.mem[`board:${ROOT}`] as object), coo: other }
}

test('la section « Autonomie du mode auto » : sa phrase, les cinq cases dans l’ordre, décochées au départ, puis « Toujours posées »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($)
  await openCoo($, clock)
  const ui = await settings($)
  const all = await texts(ui)
  await ui.unmount()
  const at = (t: string) => all.indexOf(t)
  const order = [
    'Autonomie du mode auto',
    'Case cochée : une mission en auto tranche seule, avec sa recommandation. Décochée : elle te pose la question.',
    'Choix d\'expérience',
    'Invariant d\'un ticket',
    'Décision déjà prise contredite',
    'Dépense ou action externe',
    'Relecture après la fusion',
    'Toujours posées : suppression sans retour ou exposition, faille laissée sans correctif, chemin Fable, invariant affaibli.',
  ]
  expect(order.map(at).every(i => i >= 0)).toBe(true)
  expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b))
  // Après les réglages existants.
  expect(at('Revue de sécurité de ce projet')).toBeLessThan(at('Autonomie du mode auto'))
  expect(await ticks($)).toEqual(['☐', '☐', '☐', '☐', '☐'])
  expect(all).not.toContain('Cases illisibles : toutes décochées.')
})

test('demande ouverte : un clic sur une case vide, tour fermé et siège tenu, montre la confirmation qui nomme la case ; rien n’est écrit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await press($, 'coo-autonomy-tick-experience')
  expect(w.caseWrites).toEqual([])
  const asking = await settings($)
  expect(await texts(asking)).toContain('Cocher « Choix d\'expérience » ? Les missions en auto de ce projet trancheront seules.')
  expect((await asking.find({ key: 'coo-autonomy-confirm-experience' }))?.props.variant).toBe('primary')
  expect(await asking.find({ key: 'coo-autonomy-cancel' })).toBeDefined()
  await asking.unmount()
  expect(await ticks($)).toEqual(['☐', '☐', '☐', '☐', '☐'])
})

test('confirmer coche : la case est écrite cochée et la demande tombe', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await press($, 'coo-autonomy-tick-experience')
  const asking = await settings($)
  await asking.press({ key: 'coo-autonomy-confirm-experience' })
  await asking.unmount()
  expect(saved(w)).toEqual({ ...OFF, experience: true })
  expect(await ticks($)).toEqual(['☑', '☐', '☐', '☐', '☐'])
  const after = await settings($)
  expect(await after.find({ key: 'coo-autonomy-confirm-experience' })).toBeUndefined()
  await after.unmount()
  expect(w.toasts.filter(t => t.startsWith('Réglage non enregistré'))).toEqual([])
})

test('annuler : rien n’est écrit, la demande tombe', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await press($, 'coo-autonomy-tick-spend')
  await press($, 'coo-autonomy-cancel')
  const ui = await settings($)
  expect(await ui.find({ key: 'coo-autonomy-confirm-spend' })).toBeUndefined()
  await ui.unmount()
  expect(w.caseWrites).toEqual([])
  expect(await ticks($)).toEqual(['☐', '☐', '☐', '☐', '☐'])
})

test('autre case : la demande passe à cette case, et un « Confirmer » périmé de la première n’écrit rien', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  const stale = await settings($)
  await stale.press({ key: 'coo-autonomy-tick-spend' })
  await stale.unmount()
  const asking = await settings($)
  await asking.press({ key: 'coo-autonomy-tick-invariant' })
  await asking.unmount()
  const now = await settings($)
  expect(await now.find({ key: 'coo-autonomy-confirm-spend' })).toBeUndefined()
  expect(await now.find({ key: 'coo-autonomy-confirm-invariant' })).toBeDefined()
  await now.unmount()
  expect(w.caseWrites).toEqual([])
  // « Confirmer » de la case demandée écrit celle-ci seule.
  await press($, 'coo-autonomy-confirm-invariant')
  expect(saved(w)).toEqual({ ...OFF, invariant: true })
})

test('siège perdu : la demande tombe, rien n’est écrit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await press($, 'coo-autonomy-tick-contradiction')
  // La demande est bien ouverte avant la perte du siège.
  const before = await settings($)
  expect(await before.find({ key: 'coo-autonomy-confirm-contradiction' })).toBeDefined()
  await before.unmount()
  loseSeat(w)
  await settle(clock, 7)
  // La vue Coordination ne se montre plus sans le siège ; reprendre le siège ne rouvre pas la demande.
  const seat = { by: 'session-A', at: NOW + 30_000, seenAt: NOW + 30_000 }
  const at = Object.keys(w.files).find(isBoardFile)
  if (at) w.files[at] = JSON.stringify({ ...JSON.parse(w.files[at]!), coo: seat })
  else w.mem[`board:${ROOT}`] = { ...(w.mem[`board:${ROOT}`] as object), coo: seat }
  await settle(clock, 7)
  const ui = await settings($)
  // La section est revenue avec le siège, sans la demande.
  expect(await ui.find({ key: 'coo-autonomy-tick-contradiction' })).toBeDefined()
  expect(await ui.find({ key: 'coo-autonomy-confirm-contradiction' })).toBeUndefined()
  await ui.unmount()
  expect(w.caseWrites).toEqual([])
})

test('rechargement : la demande tombe (mémoire du module), rien n’est écrit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  const memBefore = JSON.stringify(w.mem)
  const filesBefore = Object.keys(w.files).sort()
  await press($, 'coo-autonomy-tick-reread')
  // La demande ouverte ne laisse rien dans le stockage ni sur le disque : elle ne vit que dans le module, qu'un
  // rechargement des plugins remet à zéro (un test ne peut pas recharger le module que charge le moteur).
  const ui = await settings($)
  expect(await ui.find({ key: 'coo-autonomy-confirm-reread' })).toBeDefined()
  await ui.unmount()
  expect(JSON.stringify(w.mem)).toBe(memBefore)
  expect(Object.keys(w.files).sort()).toEqual(filesBefore)
  expect(w.caseWrites).toEqual([])
})

test('coche refusée : pendant un tour ou sans le siège, le message habituel, aucune demande', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await $.turn.start({ turnId: 't1', text: 'un tour' } as any)
  await press($, 'coo-autonomy-tick-experience')
  expect(w.toasts.at(-1)).toBe(TURN_OPEN)
  let ui = await settings($)
  expect(await ui.find({ key: 'coo-autonomy-confirm-experience' })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  // Une demande ouverte, puis « Confirmer » pendant un tour : refusé, rien d'écrit, la demande reste pour le reclic.
  await press($, 'coo-autonomy-tick-experience')
  await $.turn.start({ turnId: 't2', text: 'un tour' } as any)
  await press($, 'coo-autonomy-confirm-experience')
  expect(w.toasts.at(-1)).toBe(TURN_OPEN)
  expect(w.caseWrites).toEqual([])
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  ui = await settings($)
  expect(await ui.find({ key: 'coo-autonomy-confirm-experience' })).toBeDefined()
  // Sans le siège : le bouton est dessiné, la garde refuse.
  loseSeat(w)
  await ui.press({ key: 'coo-autonomy-tick-experience' })
  await ui.unmount()
  expect(w.toasts.at(-1)).toBe(SEAT_LOST)
  expect(w.caseWrites).toEqual([])
})

test('autre case pendant un tour : le clic est refusé, et la demande de la première case tombe quand même', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await press($, 'coo-autonomy-tick-experience')
  await $.turn.start({ turnId: 't1', text: 'un tour' } as any)
  await press($, 'coo-autonomy-tick-spend')
  expect(w.toasts.at(-1)).toBe(TURN_OPEN)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  const ui = await settings($)
  expect(await ui.find({ key: 'coo-autonomy-confirm-experience' })).toBeUndefined()
  expect(await ui.find({ key: 'coo-autonomy-confirm-spend' })).toBeUndefined()
  await ui.unmount()
  expect(w.caseWrites).toEqual([])
})

test('décocher tour fermé : un seul clic écrit la case décochée, sans demande', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await seed($, w, { experience: true, spend: true })
  expect(await ticks($)).toEqual(['☑', '☐', '☐', '☑', '☐'])
  await press($, 'coo-autonomy-tick-experience')
  expect(saved(w)).toEqual({ ...OFF, spend: true })
  expect(w.toasts).toEqual([])
})

test('décocher pendant un tour de Claude : un seul clic écrit la case décochée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await seed($, w, { spend: true })
  await $.turn.start({ turnId: 't1', text: 'un tour' } as any)
  await press($, 'coo-autonomy-tick-spend')
  expect(saved(w)).toEqual(OFF)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  expect(w.toasts).toEqual([])
})

test('décoche dont la lecture rate : rien n’est écrit, et le message dit « reste cochée » (jamais un silence)', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await seed($, w, { spend: true })
  const ui = await settings($)
  w.fault.readCases = 1
  await ui.press({ key: 'coo-autonomy-tick-spend' })
  await ui.unmount()
  expect(w.caseWrites).toEqual([])
  expect(w.toasts.at(-1)).toBe('Réglage non enregistré : la case « Dépense ou action externe » reste cochée.')
  expect(saved(w)).toEqual({ ...OFF, spend: true })
})

test('décocher sans le siège : refusé par le message habituel, rien n’est écrit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await seed($, w, { invariant: true })
  const ui = await settings($)
  loseSeat(w)
  await ui.press({ key: 'coo-autonomy-tick-invariant' })
  await ui.unmount()
  expect(w.toasts.at(-1)).toBe(SEAT_LOST)
  expect(w.caseWrites).toEqual([])
  expect(saved(w)).toEqual({ ...OFF, invariant: true })
})

test('fichier illisible : la ligne ambre, cinq cases décochées ; « Confirmer » repart d’un fichier neuf, la copie gardée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await seed($, w, { experience: true })
  const path = casesPath(w)!
  w.files[path] = '{"v":1,"root":"/proj","cases":{"experience":tr'
  const ui = await settings($)
  expect(await texts(ui)).toContain('Cases illisibles : toutes décochées.')
  await ui.unmount()
  expect(await ticks($)).toEqual(['☐', '☐', '☐', '☐', '☐'])
  await press($, 'coo-autonomy-tick-spend')
  await press($, 'coo-autonomy-confirm-spend')
  expect(saved(w)).toEqual({ ...OFF, spend: true })
  expect(Object.entries(w.files).filter(([p]) => p.includes('.autonomie.json.illisible-')).map(([, t]) => t)).toEqual(['{"v":1,"root":"/proj","cases":{"experience":tr'])
  const after = await settings($)
  expect(await texts(after)).not.toContain('Cases illisibles : toutes décochées.')
  await after.unmount()
})

test('écriture ratée à la coche : le message dit « reste décochée »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  w.fault.write = true
  await press($, 'coo-autonomy-tick-invariant')
  await press($, 'coo-autonomy-confirm-invariant')
  expect(w.toasts.at(-1)).toBe('Réglage non enregistré : la case « Invariant d\'un ticket » reste décochée.')
  expect(await ticks($)).toEqual(['☐', '☐', '☐', '☐', '☐'])
})

test('écriture ratée à la décoche : le message dit « reste cochée »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await seed($, w, { reread: true })
  w.fault.write = true
  await press($, 'coo-autonomy-tick-reread')
  expect(w.toasts.at(-1)).toBe('Réglage non enregistré : la case « Relecture après la fusion » reste cochée.')
  expect(await ticks($)).toEqual(['☐', '☐', '☐', '☐', '☑'])
})

test('relecture : une autre écriture entre l’écriture et la relecture, le message dit l’état relu et la page le montre', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await seed($, w, { experience: true })
  const path = casesPath(w)!
  // Juste après l'écriture de la décoche, une autre écriture recoche la case.
  w.hooks.afterCaseWrite = p => {
    if (p === path) w.files[path] = JSON.stringify({ v: 1, root: ROOT, cases: { ...OFF, experience: true }, at: NOW })
  }
  await press($, 'coo-autonomy-tick-experience')
  expect(w.toasts.at(-1)).toBe('Réglage non enregistré : la case « Choix d\'expérience » reste cochée.')
  expect((await ticks($))[0]).toBe('☑')
})
