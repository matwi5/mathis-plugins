// Le fichier des cases d'autonomie du mode auto : sa lecture pure, la lecture et la seule écriture par le mod.
// Invariant : « Une mission ne tranche jamais seule une sorte de question dont tu n'as pas coché la case par un clic ;
// une case absente, illisible ou mal lue vaut décochée, et la question t'est posée. » Tout doute rend les cinq cases
// décochées. Le disque et l'environnement sont un faux moteur en mémoire, passé tel quel aux fonctions du mod.

import { expect, test } from 'claude-code/testing'

import { AUTONOMY_CASES, parseAutonomySetting, type AutonomyRead } from '../hooks/autonomy-setting.ts'
import { autonomyCasesNow, autonomySettingPath, loadAutonomySetting, setAutonomyCase } from '../hooks/autonomy-store.ts'

const ROOT = '/w/proj'
const HOME = '/h'
const NOW = 1_763_700_000_000
const IDS = ['experience', 'invariant', 'contradiction', 'spend', 'reread']
const OFF = { experience: false, invariant: false, contradiction: false, spend: false, reread: false }

/** Un fichier tel que le code l'écrit : racine absolue, version 1, les cinq ids, date en millisecondes. */
const fileText = (cases: Partial<Record<string, unknown>> = {}, over: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, root: ROOT, cases: { ...OFF, ...cases }, at: NOW - 60_000, ...over })
const isOwn = (root: string) => root.toLowerCase() === ROOT.toLowerCase()
const parse = (text: string | undefined): AutonomyRead => parseAutonomySetting(text === undefined ? { kind: 'absent' } : { kind: 'text', text }, isOwn)

// La fonction pure, une ligne du tableau du ticket par test.

test('liste des cases : cinq ids stables, dans l’ordre de la page', () => {
  expect(AUTONOMY_CASES.map(c => c.id)).toEqual(IDS)
  expect(AUTONOMY_CASES.map(c => c.label)).toEqual(['Choix d\'expérience', 'Invariant d\'un ticket', 'Décision déjà prise contredite', 'Dépense ou action externe', 'Relecture après la fusion'])
})

test('jamais réglé : fichier absent, cinq cases décochées', () => {
  expect(parse(undefined)).toEqual({ state: 'never', cases: OFF, extra: {} })
})

test('texte abîmé : vide, JSON abîmé ou valeur qui n’est pas un objet, illisible', () => {
  for (const text of ['', '   ', '{"v":1,"root":"/w/proj","cases":{"experience":tr', 'null', '[]', '"x"', '12']) {
    const read = parse(text)
    expect([text, read.state, read.cases]).toEqual([text, 'unread', OFF])
  }
})

test('copie d\'un autre projet : racine absente ou d’un autre projet, illisible', () => {
  for (const text of [fileText({ experience: true }, { root: '/w/autre' }), fileText({ experience: true }, { root: undefined }), fileText({ experience: true }, { root: 12 })]) {
    expect(parse(text)).toMatchObject({ state: 'unread', why: 'form', cases: OFF })
  }
  // La même racine dans une autre casse est le même projet.
  expect(parse(fileText({ spend: true }, { root: '/W/Proj' })).cases.spend).toBe(true)
})

test('version inconnue : illisible', () => {
  for (const v of [2, 0, '1', undefined, null]) expect([v, parse(fileText({ experience: true }, { v })).state]).toEqual([v, 'unread'])
})

test('valeur hors forme : une case ni vraie ni fausse, ou des cases qui ne sont pas un objet, illisible', () => {
  for (const value of ['true', 1, null, {}, []]) expect(parse(fileText({ experience: true, spend: value }))).toMatchObject({ state: 'unread', why: 'form', cases: OFF })
  for (const cases of [null, [], 'tout', undefined]) expect(parse(fileText({}, { cases })).state).toBe('unread')
})

test('case inconnue : ignorée, les autres lues, gardée à part pour la réécriture', () => {
  const read = parse(fileText({ invariant: true, demain: true, autre: 'x' }))
  expect(read).toEqual({ state: 'read', cases: { ...OFF, invariant: true }, extra: { demain: true, autre: 'x' } })
})

test('case absente : une case connue absente du fichier est décochée', () => {
  const read = parse(JSON.stringify({ v: 1, root: ROOT, cases: { reread: true }, at: NOW }))
  expect(read).toEqual({ state: 'read', cases: { ...OFF, reread: true }, extra: {} })
})

test('date sans effet : absente, future ou passée, l’état est le même', () => {
  for (const at of [undefined, NOW + 9e12, 0, -5, 'hier']) expect(parse(fileText({ contradiction: true }, { at })).cases).toEqual({ ...OFF, contradiction: true })
})

// La lecture et l'écriture par le mod, sur un faux moteur.

type Disk = {
  files: Record<string, string>
  writes: string[]
  reads: string[]
  fault: { read: boolean; write: boolean; repo: false | 'throw' | 'null' }
  vars: Record<string, string>
  repoRoot: string
  /** Appelé juste après chaque écriture du fichier des cases (une autre discussion qui écrit entre-temps). */
  afterWrite?: (path: string) => void
}

const fakeEngine = (d: Disk) => ({
  env: { get: async (name: string) => d.vars[name] },
  session: {
    repo: async () => {
      if (d.fault.repo === 'throw') throw new Error('muet')
      return d.fault.repo === 'null' ? null : { root: d.repoRoot }
    },
  },
  clock: { now: async () => NOW },
  fs: {
    read: async (path: string) => {
      d.reads.push(path)
      if (d.fault.read) throw new Error(`EACCES ${path}`)
      if (!(path in d.files)) throw new Error(`ENOENT ${path}`)
      return d.files[path]
    },
    exists: async (path: string) => path in d.files,
    list: async (dir: string) => {
      const names = new Set([...Object.keys(d.files), ...(d.fault.read ? d.reads : [])].filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0]!))
      return [...names].map(name => ({ name, kind: 'file' }))
    },
    write: async (path: string, text: string) => {
      if (d.fault.write) throw new Error('EACCES')
      d.writes.push(path)
      d.files[path] = text
      d.afterWrite?.(path)
    },
  },
})

const disk = (): Disk => ({ files: {}, writes: [], reads: [], fault: { read: false, write: false, repo: false }, vars: { HOME }, repoRoot: ROOT })
const PATH = autonomySettingPath(`${HOME}/.claude`, ROOT)
/** La garde du siège : cette discussion le tient. */
const SEAT = async () => true
const saved = (d: Disk) => JSON.parse(d.files[PATH]!) as { v: number; root: string; cases: Record<string, unknown>; at: number }

test('le chemin : sous le dossier personnel, à côté du réglage de la revue, son propre suffixe ; jamais réglé, puis lu', async () => {
  const d = disk()
  const $ = fakeEngine(d)
  expect(PATH.startsWith(`${HOME}/.claude/flow-board/coordination/`)).toBe(true)
  expect(PATH.endsWith('.autonomie.json')).toBe(true)
  expect(await loadAutonomySetting($)).toMatchObject({ state: 'never', cases: OFF, path: PATH })
  d.files[PATH] = fileText({ experience: true })
  expect(await loadAutonomySetting($)).toMatchObject({ state: 'read', cases: { ...OFF, experience: true } })
  // USERPROFILE avant HOME, comme le réglage de la revue.
  d.vars = { USERPROFILE: '/up/x/', HOME }
  expect((await loadAutonomySetting($)).path).toBe(autonomySettingPath('/up/x/.claude', ROOT))
})

test('fichier absent : autonomyCasesNow rend les cinq cases décochées (jamais réglé), une lecture ratée rend null', async () => {
  const d = disk()
  expect(await autonomyCasesNow(fakeEngine(d))).toEqual(OFF)
  d.files[PATH] = '{abîmé'
  expect(await autonomyCasesNow(fakeEngine(d))).toBeNull()
})

test('worktree et casse de la racine : un worker lit le fichier de son manager', async () => {
  const d = disk()
  d.files[PATH] = fileText({ spend: true })
  // Le moteur d'un worktree dit la racine du dépôt principal, ici dans une autre casse.
  d.repoRoot = '/W/PROJ'
  const read = await loadAutonomySetting(fakeEngine(d))
  expect(read.path).toBe(PATH)
  expect(read.cases.spend).toBe(true)
})

test('lecture qui lève : fichier présent mais illisible, dossier personnel illisible, moteur muet, pas de dépôt ; cinq cases décochées', async () => {
  const d = disk()
  d.files[PATH] = fileText({ experience: true, spend: true })
  const $ = fakeEngine(d)
  d.fault.read = true
  expect(await loadAutonomySetting($)).toMatchObject({ state: 'unread', why: 'read', cases: OFF })
  d.fault.read = false
  d.vars = {}
  expect(await loadAutonomySetting($)).toMatchObject({ state: 'unread', why: 'read', cases: OFF })
  d.vars = { HOME }
  d.fault.repo = 'throw'
  expect(await loadAutonomySetting($)).toMatchObject({ state: 'unread', why: 'read', cases: OFF })
  d.fault.repo = 'null'
  expect(await loadAutonomySetting($)).toMatchObject({ state: 'unread', why: 'repo', cases: OFF })
  // Un moteur dont l'environnement lève tout entier : jamais d'exception, cinq cases décochées.
  const broken = { ...$, env: { get: () => { throw new Error('refusé') } }, session: { repo: () => { throw new Error('x') } } }
  expect((await loadAutonomySetting(broken)).cases).toEqual(OFF)
})

test('une case change seule : les quatre autres et les cases inconnues gardées, version, racine et date réécrites, état relu rendu', async () => {
  const d = disk()
  d.files[PATH] = fileText({ invariant: true, demain: true })
  const out = await setAutonomyCase(fakeEngine(d), 'experience', true, SEAT)
  expect(out.isWritten).toBe(true)
  expect(out.read.cases).toEqual({ ...OFF, experience: true, invariant: true })
  expect(saved(d)).toEqual({ v: 1, root: ROOT, cases: { demain: true, ...OFF, experience: true, invariant: true }, at: NOW })
  // Décocher : la seule case cliquée change.
  const off = await setAutonomyCase(fakeEngine(d), 'invariant', false, SEAT)
  expect(off.read.cases).toEqual({ ...OFF, experience: true })
  // Jamais réglé : le premier clic crée le fichier.
  const fresh = disk()
  expect((await setAutonomyCase(fakeEngine(fresh), 'reread', true, SEAT)).read.cases).toEqual({ ...OFF, reread: true })
  expect(fresh.writes).toEqual([PATH])
})

test('deux appels à la file dans le même processus gardent chacun la case de l’autre', async () => {
  const d = disk()
  const $ = fakeEngine(d)
  const [a, b] = await Promise.all([setAutonomyCase($, 'experience', true, SEAT), setAutonomyCase($, 'spend', true, SEAT)])
  expect(a.read.cases.experience).toBe(true)
  expect(b.read.cases).toEqual({ ...OFF, experience: true, spend: true })
  expect(saved(d).cases).toEqual({ ...OFF, experience: true, spend: true })
})

test('fichier hors forme au moment d’écrire : copié sous un nom « illisible » daté, jamais effacé, puis seule la case demandée', async () => {
  for (const to of [true, false]) {
    const d = disk()
    const broken = '{"v":1,"root":"/w/proj","cases":{"spend":tr'
    d.files[PATH] = broken
    const out = await setAutonomyCase(fakeEngine(d), 'contradiction', to, SEAT)
    expect(d.files[`${PATH}.illisible-${NOW}`]).toBe(broken)
    expect(saved(d).cases).toEqual({ ...OFF, contradiction: to })
    expect(out.read.cases).toEqual({ ...OFF, contradiction: to })
    // Une copie déjà là sous ce nom n'est jamais écrasée.
    d.files[PATH] = broken
    await setAutonomyCase(fakeEngine(d), 'contradiction', to, SEAT)
    expect(d.files[`${PATH}.illisible-${NOW}`]).toBe(broken)
    expect(d.files[`${PATH}.illisible-${NOW}-2`]).toBe(broken)
  }
})

test('écriture qui échoue à la coche : un seul essai, rien d’autre n’est écrit, la case reste décochée', async () => {
  const d = disk()
  d.files[PATH] = fileText({ spend: true })
  d.fault.write = true
  let tries = 0
  const $ = fakeEngine(d)
  const write = $.fs.write
  $.fs.write = async (path: string, text: string) => {
    tries++
    return write(path, text)
  }
  const out = await setAutonomyCase($, 'experience', true, SEAT)
  expect([out.isWritten, out.read.cases.experience, out.read.cases.spend, tries]).toEqual([false, false, true, 1])
  expect(d.writes).toEqual([])
})

test('écriture qui échoue à la décoche : la case reste cochée', async () => {
  const d = disk()
  d.files[PATH] = fileText({ spend: true })
  d.fault.write = true
  const out = await setAutonomyCase(fakeEngine(d), 'spend', false, SEAT)
  expect([out.isWritten, out.read.cases.spend]).toEqual([false, true])
  expect(saved(d).cases.spend).toBe(true)
})

test('relecture : une écriture d’une autre discussion entre l’écriture et la relecture est rendue à l’appelant', async () => {
  const d = disk()
  d.afterWrite = path => {
    if (path === PATH) d.files[PATH] = fileText({ reread: true })
  }
  const out = await setAutonomyCase(fakeEngine(d), 'experience', true, SEAT)
  expect(out.isWritten).toBe(true)
  expect(out.read.cases).toEqual({ ...OFF, reread: true })
})

test('siège perdu entre la lecture et l’écriture : rien n’est écrit, ni la copie ni le fichier, et l’appelant le sait', async () => {
  for (const text of [fileText({ spend: true }), '{abîmé']) {
    const d = disk()
    d.files[PATH] = text
    let asks = 0
    // La garde se relit juste avant chaque écriture : la première fois tenu, puis perdu (une autre discussion l'a repris).
    const out = await setAutonomyCase(fakeEngine(d), 'spend', false, async () => ++asks === 1 && text === '{abîmé' ? true : false)
    expect([out.isWritten, out.isSeatLost]).toEqual([false, true])
    expect(d.files[PATH]).toBe(text)
    expect(d.writes).toEqual(text === '{abîmé' ? [`${PATH}.illisible-${NOW}`] : [])
  }
})

test('écriture qui lève après avoir pu écrire sa tête : l’état rendu est relu, pas celui d’avant', async () => {
  const d = disk()
  d.files[PATH] = fileText({ spend: true })
  const $ = fakeEngine(d)
  $.fs.write = async (path: string) => {
    d.files[path] = '{"v":1,"root":"/w/pr'
    throw new Error('coupée')
  }
  const out = await setAutonomyCase($, 'experience', true, SEAT)
  expect(out.isWritten).toBe(false)
  expect(out.read.state).toBe('unread')
  expect(out.read.cases).toEqual(OFF)
})

test('une autre écriture entre la lecture et l’écriture : rien n’est écrit, la case décochée ailleurs n’est pas recochée, l’état relu rendu', async () => {
  const d = disk()
  d.files[PATH] = fileText({ experience: true })
  const $ = fakeEngine(d)
  const read = $.fs.read
  let reads = 0
  $.fs.read = async (path: string) => {
    const text = await read(path)
    // Juste après la première lecture, l'ancien titulaire du siège décoche « Choix d'expérience ».
    if (path === PATH && ++reads === 1) d.files[PATH] = fileText({ experience: false })
    return text
  }
  const out = await setAutonomyCase($, 'spend', true, SEAT)
  expect(out.isWritten).toBe(false)
  expect(saved(d).cases).toEqual(OFF)
  expect(out.read.cases).toEqual(OFF)
  expect(d.writes).toEqual([])
})

test('relecture qui lève juste avant l’écriture, à la décoche : rien n’est écrit, la case rendue cochée (le message le dira)', async () => {
  const d = disk()
  d.files[PATH] = fileText({ spend: true })
  const $ = fakeEngine(d)
  const read = $.fs.read
  let reads = 0
  $.fs.read = async (path: string) => {
    if (path === PATH && ++reads === 2) throw new Error('EIO')
    return read(path)
  }
  const out = await setAutonomyCase($, 'spend', false, SEAT)
  expect([out.isWritten, out.read.cases.spend]).toEqual([false, true])
  expect(d.writes).toEqual([])
  // Une écriture qui lève sans rien écrire, puis une relecture qui lève : l'état d'avant, jamais cinq cases décochées.
  const e = disk()
  e.files[PATH] = fileText({ spend: true })
  const $e = fakeEngine(e)
  const readE = $e.fs.read
  let readsE = 0
  $e.fs.read = async (path: string) => {
    if (path === PATH && ++readsE === 3) throw new Error('EIO')
    return readE(path)
  }
  $e.fs.write = async () => {
    throw new Error('EACCES')
  }
  const failed = await setAutonomyCase($e, 'spend', false, SEAT)
  expect([failed.isWritten, failed.read.cases.spend]).toEqual([false, true])
})

test('écriture réussie puis relecture qui lève : l’état rendu est celui écrit, jamais cinq cases décochées', async () => {
  const d = disk()
  d.files[PATH] = fileText({ spend: true })
  const $ = fakeEngine(d)
  const read = $.fs.read
  let reads = 0
  $.fs.read = async (path: string) => {
    if (path === PATH && ++reads === 3) throw new Error('EIO')
    return read(path)
  }
  const out = await setAutonomyCase($, 'experience', true, SEAT)
  expect(out.isWritten).toBe(true)
  expect(out.read.cases).toEqual({ ...OFF, experience: true, spend: true })
})

test('la garde du siège est le dernier geste avant l’écriture : relue après la relecture du fichier', async () => {
  const d = disk()
  d.files[PATH] = fileText({})
  const $ = fakeEngine(d)
  const order: string[] = []
  const read = $.fs.read
  $.fs.read = async (path: string) => {
    order.push('read')
    return read(path)
  }
  const write = $.fs.write
  $.fs.write = async (path: string, text: string) => {
    order.push('write')
    return write(path, text)
  }
  await setAutonomyCase($, 'reread', true, async () => {
    order.push('seat')
    return true
  })
  expect(order.slice(0, order.indexOf('write') + 1)).toEqual(['read', 'read', 'seat', 'write'])
})

test('lecture qui lève au clic : rien n’est écrit ; un projet hors git non plus', async () => {
  const d = disk()
  d.files[PATH] = fileText({ spend: true })
  d.fault.read = true
  expect((await setAutonomyCase(fakeEngine(d), 'experience', true, SEAT)).isWritten).toBe(false)
  d.fault.read = false
  d.fault.repo = 'null'
  expect((await setAutonomyCase(fakeEngine(d), 'experience', true, SEAT)).isWritten).toBe(false)
  expect(d.writes).toEqual([])
})

test('le faux disque ne voit que les écritures de la fonction, jamais `$.store` ; une lecture n’écrit rien', async () => {
  const d = disk()
  const touched: string[] = []
  const store = new Proxy({}, {
    get: (_t, name) => {
      touched.push(String(name))
      return () => {
        throw new Error('$.store touché')
      }
    },
  })
  const $ = { ...fakeEngine(d), store }
  await loadAutonomySetting($)
  d.files[PATH] = '{abîmé'
  await loadAutonomySetting($)
  expect(d.writes).toEqual([])
  await setAutonomyCase($, 'invariant', true, SEAT)
  expect(d.writes).toEqual([`${PATH}.illisible-${NOW}`, PATH])
  // Déjà dans l'état visé : rien ne s'écrit.
  await setAutonomyCase($, 'invariant', true, SEAT)
  expect(d.writes).toEqual([`${PATH}.illisible-${NOW}`, PATH])
  expect(touched).toEqual([])
})
