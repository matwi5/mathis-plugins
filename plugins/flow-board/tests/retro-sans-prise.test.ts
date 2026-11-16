// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import type { CoordRetro } from '../hooks/coordination.ts'
import { LAUNCH_TTL_MS, launchKey, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { RETRO_RESUME_PROMPT, retroResumeCommand } from '../hooks/night.ts'
import { RETRO_CLAIM_WAIT_MS, retroFallbackText } from '../hooks/register.tsx'
import { RETRO_RESUME_LEAD_MS, RETRO_TAKE_MARGIN_MS, isRetroResumeUseful, retroCardId, retroResumeUntil } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { pressAny } from './page-coo.ts'

// La demande de rétro que personne ne prend : au terminal, la reprise de la discussion du manager, sinon
// une nouvelle discussion. Invariant : « Une demande de rétro n'est jamais appliquée deux fois, ni dans une discussion
// qui tient une mission en cours ou qui n'est pas celle de la mission étudiée. »

const T0 = 820_000_000
const MANAGER = 'aaaa1111-2222-3333-4444-555566667777'
const RUN = 'r1abc'
const PLAIN = '◆ COO : lance maintenant la mission « Rétrospective · X » dans une nouvelle discussion … {"launch": "labcdefgh12"}'
const UNTIL = 1_234_567

/** La mission étudiée : close, née dans la discussion du manager. */
const studiedRun = (now: number): Run => ({ ...newRun('implement', now - 900_000, 'Mission de B'), status: 'done', bornIn: MANAGER, updatedAt: now - 60_000 }) as Run

const retroRequests = (w: World) => entries(w).filter(e => e.kind === 'retro')

/** Le COO clique « Lancer en auto » sur la carte de rétro de la mission étudiée, la vue dessinée sur `surface`. */
const clickRetro = async ($: any, on: any, surface: 'desktop' | 'terminal') => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-COO'
  const s = studiedRun(T0)
  writeBoard(w, b => ({ ...b, runs: [s] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
  await pressAny(pane, { key: `coo-card-auto-${retroCardId(s.id)}` })
  await pane.unmount()
  const asked = retroRequests(w)
  expect(asked).toHaveLength(1)
  return { clock, w, s, launch: asked[0].launch as string }
}

const fallbacks = (w: World, launch: string) => w.fills.filter(f => f.includes(`{"launch": "${launch}"}`))

// ─── Fonctions pures ───────────────────────────────────────────────────────

test('terminal, ids sûrs : heure limite, entrée de claude agents sans pid, reprise telle quelle, arrêt sur « backgrounded » pour cette rétro, puis la demande d’aujourd’hui, dans cet ordre', () => {
  const command = retroResumeCommand(RUN, MANAGER)!
  expect(command).toBe(`claude --bg --resume '${MANAGER}' '${RETRO_RESUME_PROMPT}'`)
  const text = retroFallbackText({ plain: PLAIN, command, session: MANAGER, until: UNTIL })
  const at = (s: string) => text.indexOf(s)
  expect(text).toContain(`date +%s : si le nombre affiché dépasse ${UNTIL}`)
  expect(text).toContain(`sessionId est exactement ${MANAGER}`)
  expect(text).toContain('Si aucune entrée n’a ce sessionId, ou si elle a un pid')
  expect(text).toContain('au moment où tu le lis')
  expect(at('date +%s')).toBeLessThan(at('claude agents --json --all'))
  expect(at('claude agents --json --all')).toBeLessThan(at(command))
  expect(at(command)).toBeLessThan(at('« backgrounded », arrête-toi là pour cette rétro'))
  expect(at('« backgrounded », arrête-toi là pour cette rétro')).toBeLessThan(at('Seulement si la reprise n’a pas eu lieu'))
  expect(at('Seulement si la reprise n’a pas eu lieu')).toBeLessThan(at(PLAIN))
  expect(text).toContain('« Workspace not trusted »')
  expect(text).toContain('--permission-mode')
  // Une demande d'une autre carte ajoutée après le repli reste à lancer : la fin du texte le dit.
  expect(at(PLAIN)).toBeLessThan(at('une autre demande de lancement qui la suit dans ce message en est indépendante, lance-la quand même'))
  expect(text).not.toMatch(/ne lance rien d’autre/)
})

test('le message de la reprise est fixe : aucune valeur relue, aucune apostrophe (ASCII ni typographique), aucune reprise de mission', () => {
  expect(RETRO_RESUME_PROMPT).not.toMatch(/['‘’‚‛]/)
  expect(RETRO_RESUME_PROMPT).not.toContain(RUN)
  expect(RETRO_RESUME_PROMPT).not.toContain('resume')
  expect(RETRO_RESUME_PROMPT).toMatch(/termine ce tour tout de suite/)
  expect(retroResumeCommand('autre', MANAGER)).toBe(retroResumeCommand(RUN, MANAGER))
})

test('pas de commande sans id sûr : mission ou discussion hors forme, id court, discussion de l’app', () => {
  for (const [run, session] of [['../x', MANAGER], [RUN, "a'b"], [RUN, 'x y'], [RUN, 'local_abc123'], [RUN, 'local-abc123'], [RUN, 'abc12345'], [RUN, `${MANAGER}x`], [undefined, MANAGER], [RUN, '']] as const) expect(retroResumeCommand(run, session)).toBeNull()
  expect(retroResumeCommand(RUN, MANAGER)).not.toBeNull()
})

test('la reprise ne se propose que si la discussion rouverte la prendrait', () => {
  const s = studiedRun(T0)
  const ask: CoordRetro = { id: 'cabcdef01', kind: 'retro', run: s.id, at: T0, launch: 'labcdefgh12', session: MANAGER }
  const base = { ask, runs: [s], here: 'session-COO', applied: new Set<string>(), record: { at: T0 }, now: T0 + 30_000 }
  expect(isRetroResumeUseful(base)).toBe(true)
  // Le siège ici, la demande déjà notée appliquée chez elle, trop près de la péremption.
  expect(isRetroResumeUseful({ ...base, here: MANAGER })).toBe(false)
  expect(isRetroResumeUseful({ ...base, applied: new Set([ask.id]) })).toBe(false)
  expect(isRetroResumeUseful({ ...base, now: retroResumeUntil({ at: T0 }) })).toBe(false)
  expect(retroResumeUntil({ at: T0 })).toBe(T0 + LAUNCH_TTL_MS - RETRO_TAKE_MARGIN_MS - RETRO_RESUME_LEAD_MS)
  // La mission étudiée absente, d'une autre discussion, archivée, plus close, avec sa rétro ; une mission en cours là-bas.
  expect(isRetroResumeUseful({ ...base, runs: [] })).toBe(false)
  expect(isRetroResumeUseful({ ...base, runs: [{ ...s, bornIn: 'bbbb1111-2222-3333-4444-555566667777' } as Run] })).toBe(false)
  expect(isRetroResumeUseful({ ...base, runs: [{ ...s, archivedAt: T0 } as Run] })).toBe(false)
  expect(isRetroResumeUseful({ ...base, runs: [{ ...s, status: 'active' } as Run] })).toBe(false)
  const retro = { ...newRun('retro', T0, 'Rétro'), status: 'active', owner: 'x', launch: { id: 'lother00001', card: retroCardId(s.id), at: T0, folder: 'f', start: 'retro', of: s.id, mode: 'auto' } } as unknown as Run
  expect(isRetroResumeUseful({ ...base, runs: [s, retro] })).toBe(false)
  const busy = { ...newRun('implement', T0, 'Autre'), status: 'active', owner: MANAGER } as Run
  expect(isRetroResumeUseful({ ...base, runs: [s, busy] })).toBe(false)
})

test('le délai d’attente de la prise couvre quelques relectures de 5 s', () => {
  expect(RETRO_CLAIM_WAIT_MS).toBeGreaterThanOrEqual(15_000)
  expect(RETRO_CLAIM_WAIT_MS).toBeLessThan(60_000)
})

// ─── Monde du COO ──────────────────────────────────────────────────────────

test('dans l’app, sans prise au bout du délai : la demande d’aujourd’hui dans la saisie, sans reprise, une seule fois', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, launch } = await clickRetro($, on, 'desktop')
  expect(w.fills).toEqual([])
  await settle(clock, 10)
  // Pas encore : le délai n'est pas passé.
  expect(fallbacks(w, launch)).toHaveLength(0)
  await settle(clock, 20)
  const got = fallbacks(w, launch)
  expect(got).toHaveLength(1)
  expect(got[0]!.startsWith('◆ COO : lance maintenant la mission')).toBe(true)
  expect(got[0]).not.toContain('--resume')
  expect(w.toasts.some(t => t.includes('n’a pas pris la rétro'))).toBe(true)
  // Les relectures suivantes : ni doublé, ni redit.
  await settle(clock, 20)
  expect(fallbacks(w, launch)).toHaveLength(1)
  expect(w.toasts.filter(t => t.includes('n’a pas pris la rétro'))).toHaveLength(1)
})

test('au terminal, sans prise au bout du délai : la reprise de la discussion du manager, puis le repli', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, launch } = await clickRetro($, on, 'terminal')
  await settle(clock, 30)
  const got = fallbacks(w, launch)
  expect(got).toHaveLength(1)
  expect(got[0]).toContain(`claude --bg --resume '${MANAGER}'`)
  expect(got[0]).toContain(`dépasse ${Math.floor(retroResumeUntil(w.mem[launchKey(launch)] as LaunchRecord) / 1000)}`)
  expect(got[0]).toContain('Seulement si la reprise n’a pas eu lieu')
  expect(got[0]).toContain('dans une nouvelle discussion')
})

test('au terminal, une demande déjà notée appliquée chez le manager puis sa prise rendue : pas de reprise (rouverte, elle ne la reprendrait pas), la demande d’aujourd’hui seule', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, s, launch } = await clickRetro($, on, 'terminal')
  w.mem['coo-applied:' + s.id] = [retroRequests(w)[0].id]
  await settle(clock, 30)
  const got = fallbacks(w, launch)
  expect(got).toHaveLength(1)
  expect(got[0]).not.toContain('--resume')
  expect(got[0]).toContain('dans une nouvelle discussion')
})

test('un brouillon dans la saisie du COO n’est jamais remplacé : le repli attend qu’elle se vide, le toast le dit une fois', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, launch } = await clickRetro($, on, 'desktop')
  w.box.text = 'mon message au COO, pas fini'
  await settle(clock, 40)
  expect(fallbacks(w, launch)).toHaveLength(0)
  expect(w.box.text).toBe('mon message au COO, pas fini')
  expect(w.toasts.filter(t => t.includes('ton brouillon est gardé'))).toHaveLength(1)
  // La saisie vidée (le message envoyé) : le repli part.
  w.box.text = ''
  await settle(clock, 10)
  expect(fallbacks(w, launch)).toHaveLength(1)
})

test('une demande périmée dans la saisie, à côté d’un texte tapé : le repli ne la remplace pas, le toast le dit', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, launch } = await clickRetro($, on, 'desktop')
  const typed = `${PLAIN.replace('labcdefgh12', 'lperime0001')}\n\net ma remarque à moi`
  w.box.text = typed
  await settle(clock, 40)
  expect(fallbacks(w, launch)).toHaveLength(0)
  expect(w.box.text).toBe(typed)
  expect(w.toasts.filter(t => t.includes('ton brouillon est gardé'))).toHaveLength(1)
  // La saisie vidée : le repli part.
  w.box.text = ''
  await settle(clock, 10)
  expect(fallbacks(w, launch)).toHaveLength(1)
})

test('la saisie du COO illisible au moment du repli : rien n’est dit, la relecture suivante le fait', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, launch } = await clickRetro($, on, 'desktop')
  let isBroken = true
  // Lisible pour la vérification du repli déjà dans la saisie, illisible ensuite, dans la file des clics.
  let reads = 0
  w.probe.refusePrompt = () => isBroken && ++reads % 2 === 0
  await settle(clock, 40)
  expect(fallbacks(w, launch)).toHaveLength(0)
  expect(w.toasts.filter(t => t.includes('ton brouillon est gardé'))).toHaveLength(0)
  isBroken = false
  await settle(clock, 10)
  expect(fallbacks(w, launch)).toHaveLength(1)
})

test('la prise lue pendant le délai : rien de plus ; rendue avant la péremption : le repli', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, launch } = await clickRetro($, on, 'desktop')
  const rec = w.mem[launchKey(launch)] as LaunchRecord
  w.mem[launchKey(launch)] = { ...rec, claim: { by: MANAGER, at: T0 + 5_000 } }
  await settle(clock, 40)
  expect(fallbacks(w, launch)).toHaveLength(0)
  // La prise rendue (refus du moteur, mission ouverte entre-temps chez le manager) : le repli part.
  w.mem[launchKey(launch)] = rec
  await settle(clock, 10)
  expect(fallbacks(w, launch)).toHaveLength(1)
})

test('lancement consommé ou périmé : aucun repli ; le même monde, lancement valable : le repli', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, launch } = await clickRetro($, on, 'desktop')
  const rec = w.mem[launchKey(launch)] as LaunchRecord
  // Consommé (l'enregistrement s'efface à la consommation).
  delete w.mem[launchKey(launch)]
  await settle(clock, 30)
  expect(fallbacks(w, launch)).toHaveLength(0)
  // Périmé : daté de plus de dix minutes.
  w.mem[launchKey(launch)] = { ...rec, at: T0 - LAUNCH_TTL_MS }
  await settle(clock, 10)
  expect(fallbacks(w, launch)).toHaveLength(0)
  // Témoin : le même lancement, valable, fait partir le repli.
  w.mem[launchKey(launch)] = rec
  await settle(clock, 10)
  expect(fallbacks(w, launch)).toHaveLength(1)
})

test('jamais deux rétros : le manager prend la demande pendant que le repli attend dans la saisie ; la nouvelle discussion est refusée', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, w, s, launch } = await clickRetro($, on, 'desktop')
  await settle(clock, 30)
  expect(fallbacks(w, launch)).toHaveLength(1)
  const rec = w.mem[launchKey(launch)] as LaunchRecord
  // Première fenêtre : la prise seule du manager, pendant que le repli attend dans la saisie.
  w.mem[launchKey(launch)] = { ...rec, claim: { by: MANAGER, at: T0 + 35_000 } }
  // Mathis envoie le repli : la nouvelle discussion (une autre, jouée après celle du COO) ouvre sa rétro et veut
  // consommer le lancement.
  await $.session.end({ reason: 'clear' } as any)
  w.ids.now = 'session-N'
  await ($ as any).classic.SessionStart({ session_id: 'session-N', transcript_path: '/t', cwd: '', hook_event_name: 'SessionStart', source: 'clear' })
  await settle(clock, 6)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  const call = $.tool.call({ tool: TOOL, launch } as any)
  await settle(clock, 3)
  expect(String(((await call) as any).result)).toMatch(/another mission already took it/)
  // Seconde fenêtre : la rétro du manager porte le lancement (l'enregistrement encore là, sans prise) ; le refus
  // vient de la mission qui le porte.
  const retro = { ...newRun('retro', T0 + 40_000, 'Rétrospective · Mission de B'), status: 'active', owner: MANAGER, bornIn: MANAGER, launch: { id: launch, card: retroCardId(s.id), at: rec.at, folder: rec.folder, start: 'retro', of: s.id, mode: 'auto' } } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [...b.runs, retro] }))
  w.mem[launchKey(launch)] = rec
  const again = $.tool.call({ tool: TOOL, launch } as any)
  await settle(clock, 3)
  expect(String(((await again) as any).result)).toMatch(/another mission already took it/)
  // Aucune seconde rétro ne porte la mission étudiée.
  expect(stored(w).runs.filter(r => r.launch?.of === s.id)).toHaveLength(1)
})
