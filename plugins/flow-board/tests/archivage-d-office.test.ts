import { expect, test } from 'claude-code/testing'

import { archiveConsent, closingProcedure, consentAt } from '../hooks/closing.ts'
import { newRun } from '../hooks/model.ts'
import { runArchiveConsent } from '../hooks/register.tsx'

// L'outil archive_session de l'app Desktop ne s'appelle qu'après un accord explicite de la personne pour
// une session précise. L'accord se donne d'avance, une fois, par `/flow archive on` (tapé, jamais par un
// plugin) : la fermeture d'une session de l'app le cite alors en nommant la session, et Claude l'archive
// sans redemander, comme `claude stop` dans le CLI. Décision de Mathis du 02/11/2026.

const T0 = Date.UTC(2026, 10, 2, 9, 0, 0)
const run = newRun('implement', T0, 'Boutique')
const target = { kind: 'group' as const, id: 'A', name: 'Script' }
const step7 = (text: string): string => text.slice(text.indexOf('7) seulement si tout tient'), text.indexOf('8) une fois la session arrêtée'))

test('sans accord donné d’avance, la fermeture d’une session de l’app fait demander l’accord et dit comment le donner une fois pour toutes', () => {
  archiveConsent.at = null
  const text = step7(closingProcedure({ hasReport: true, run, target, isRepo: true, session: 'local_ab12' }))
  expect(text).toContain('l’outil d’archivage de l’app demande mon accord pour cette session')
  expect(text).toContain('/flow archive on')
  expect(text).not.toContain('tu as mon accord')
})

test('l’accord donné d’avance est cité en nommant la session : Claude archive sans redemander', () => {
  archiveConsent.at = T0
  try {
    for (const isRepo of [true, false]) {
      const text = closingProcedure({ hasReport: true, run, target, isRepo, session: 'local_ab12' })
      expect(text).toContain('tu as mon accord pour l’archiver')
      expect(text).toContain('/flow archive on, le 2026-11-02')
      expect(text).toContain('il vaut pour la session dont le titre commence par « Boutique > Groupe A · »')
      expect(text).toContain('ne me le redemande pas')
    }
  } finally {
    archiveConsent.at = null
  }
})

test('la date relue d’un accord est bornée en un seul point : hors de l’époque à maintenant (une minute près), pas d’accord', () => {
  expect(consentAt({ at: T0 }, T0)).toBe(T0)
  expect(consentAt({ at: T0 + 30_000 }, T0)).toBe(T0 + 30_000)
  for (const value of [{ at: 1e300 }, { at: -5 }, { at: 0 }, { at: T0 + 120_000 }, { at: 1.5 }, { at: '2026' }, { at: Number.NaN }, null, 'x', 42])
    expect(consentAt(value, T0)).toBeNull()
})

test('une session du CLI ne change pas : claude stop, sans accord à citer', () => {
  archiveConsent.at = T0
  try {
    const text = step7(closingProcedure({ hasReport: true, run, target, isRepo: true, session: '178bd61c' }))
    expect(text).toContain("claude stop '178bd61c'")
  } finally {
    archiveConsent.at = null
  }
})

/** Le moteur réduit à ce que lit `/flow archive` : le stockage du mod. */
const storeWorld = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  return mem
}

test('/flow archive par le moteur : l’état sans argument ; on sans origine attestée refusé ; off accepté, efface l’accord', { timeoutMs: 20000 }, async ($, on) => {
  const mem = storeWorld(on)
  on('clock.now', () => ({ value: T0 }))
  on('command.run', { command: 'flow-board:flow' }, async (_$: unknown, e: any, next: any) => next(e))
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  // Le mod tourne dans sa propre copie : son accord en mémoire ne se lit pas d'ici, le stockage et la réponse si.
  // Le faux moteur ne pose pas d'origine sur la commande : un `on` sans origine attestée est refusé.
  const run = (args: string) => $.command.run({ command: 'flow-board:flow', args } as any)
  expect((await run('archive')).text).toContain('Archivage d’office éteint')
  expect((await run('archive on')).text).toContain('Refusé')
  expect(mem['archive-consent']).toBeUndefined()
  mem['archive-consent'] = { at: T0 }
  expect((await run('archive')).text).toContain('Archivage d’office allumé depuis le 2026-11-02')
  expect((await run('archive off')).text).toContain('Archivage d’office éteint')
  expect(mem['archive-consent']).toBeUndefined()
})

/** Un `$` réduit au stockage et à l'horloge, pour appeler `runArchiveConsent` directement avec une origine. */
const fakeStore = () => {
  const mem: Record<string, unknown> = {}
  const $ = {
    store: { get: async (k: string) => mem[k], set: async (k: string, v: unknown) => void (mem[k] = v), delete: async (k: string) => void delete mem[k] },
    clock: { now: async () => T0 },
  }
  return { mem, $ }
}

test('/flow archive on ne vient que d’un geste de la personne (Entrée, Remote Control, message de l’app) ; toute autre origine est refusée et ne garde rien', async () => {
  for (const origin of ['plugin', 'scheduled-trigger', 'peer', 'coordinator', 'unclassified', 'task-notification', undefined]) {
    const { mem, $ } = fakeStore()
    archiveConsent.at = null
    expect((await runArchiveConsent($, 'on', origin, T0)).text).toContain('Refusé')
    expect(mem['archive-consent']).toBeUndefined()
    expect(archiveConsent.at).toBeNull()
  }
  for (const origin of ['composer', 'bridge', 'sdk']) {
    const { mem, $ } = fakeStore()
    archiveConsent.at = null
    expect((await runArchiveConsent($, 'on', origin, T0)).text).toContain('allumé depuis le 2026-11-02')
    expect(mem['archive-consent']).toEqual({ at: T0 })
    expect(archiveConsent.at).toBe(T0)
  }
  archiveConsent.at = null
})

const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

test('l’onglet Commandes porte l’interrupteur de l’archivage d’office : il dit l’état et le bascule d’un clic, ton geste', { timeoutMs: 20000 }, async ($, on) => {
  const mem = storeWorld(on)
  on('clock.now', () => ({ value: T0 }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const toasts: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-commands' })
  const label = async () => String((await ui.find({ key: 'archive-toggle' }))?.props.label)
  expect(await label()).toContain('Archivage d’office : éteint')
  await ui.press({ key: 'archive-toggle' })
  expect(mem['archive-consent']).toEqual({ at: T0 })
  expect(toasts.at(-1)).toContain('Archivage d’office allumé depuis le 2026-11-02')
  expect(await label()).toContain('Archivage d’office : allumé depuis le 2026-11-02')
  await ui.press({ key: 'archive-toggle' })
  expect(mem['archive-consent']).toBeUndefined()
  expect(await label()).toContain('Archivage d’office : éteint')
  await ui.unmount()
})

test('/flow archive off, qui ne fait que retirer l’accord, est accepté d’où qu’il vienne', async () => {
  const { mem, $ } = fakeStore()
  mem['archive-consent'] = { at: T0 }
  expect((await runArchiveConsent($, 'off', 'plugin', T0)).text).toContain('Archivage d’office éteint')
  expect(mem['archive-consent']).toBeUndefined()
  expect(archiveConsent.at).toBeNull()
})
