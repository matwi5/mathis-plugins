// flow-board : l'effacement d'un parcours ou d'une discussion (fichiers, clés, traces).
//
// Supprimer un parcours efface ses agents, ceux de ses sessions liées, son relais et ses choix ;
// « ✗ Oublier » efface une discussion et ses sessions liées sûres (S15). Une trace par id effacé
// (session, parcours, sous-agent : S5, S22), dans le dossier du registre. Le fichier d'une session
// fermée s'efface tout de suite (réécrit vide, puis supprimé : S4) ; celui d'une session ouverte
// n'est jamais touché, elle se compacte elle-même d'après les traces (S6, S19). Les transcripts
// de Claude Code ne sont jamais touchés.

import { atom, read, update } from 'claude-code'
import type { Board, Relay, Run, SessionRegistry } from '../types'
import { readRebuiltState, rebuiltKey, rebuiltPath, scanTranscriptAgents, updateRebuilt } from './catch-up.ts'
import { type Trace, agentTraces, applyTraces, cleanTrace, eraseWith, isClosedSession, removeArgv } from './erase.ts'
import { carriedRunAt, runFileId, runWindow, runsCarriedBy } from './history.ts'
import { isSameProject, isSureLink, linkedSessions } from './linked.ts'
import { EMPTY_UI, dropRun, relayFileSlug } from './model.ts'
import { type HistoryShown, buildShown, commit, decidedPath, delegateKey, historyHeads, historyShown, clearHistoryShown, mainRefKey, mainRefPath, otherHeads, otherRegistries, quietly, readAllHeads, readRelay, rebuiltIds, refreshHistory, registryFiles, relayKey, relayPath, reportPath } from './register.tsx'
import { commitRegistry, readRegistry, registryDir, registryKey, registryPath, writeRegistry } from './registry-file.ts'

/** Les atomes lus ou mis à jour ici : le moteur veut leur déclaration dans le fichier qui les lit. */
const boardAtom = atom({ plugin: 'flow-board', key: 'board' } as const, null)
const registryAtom = atom({ plugin: 'flow-board', key: 'agents' } as const, null)
const uiAtom = atom({ plugin: 'flow-board', key: 'ui' } as const, EMPTY_UI)

/**
 * Le nom de fichier d'une trace (D2 b) : son id, chaque signe hors `[a-z0-9_-]` en tiret, puis sa
 * date ; un fichier par couple (id, date), jamais réécrit. Les traces d'avant, `<id>.erased.json`
 * (une par id, réécrite), se lisent toujours.
 */
const traceSlug = (id: string): string => id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
function tracePath($: any, t: Trace): string | null {
  const dir = registryDir($)
  return dir ? `${dir}/${traceSlug(t.id)}.${t.at}.erased.json` : null
}
const traceKey = (t: Trace): string => `${registryKey(traceSlug(t.id))}:${t.at}:erased`

/** Les traces déjà lues, par nom de fichier, avec sa date : relues seulement quand elle change. */
const traceCache = new Map<string, { mtime: number; trace: Trace }>()

/** Toutes les traces : les fichiers `*.erased.json` du dossier du registre, et les clés de `$.store`. */
export async function readTraces($: any): Promise<Trace[]> {
  const out: Trace[] = []
  const dir = registryDir($)
  if (dir) {
    try {
      const entries = (await $.fs.list(dir)) as { name: string; kind: string; mtimeMs: number }[]
      for (const x of entries) {
        if (x.kind !== 'file' || !x.name.endsWith('.erased.json')) continue
        const kept = traceCache.get(x.name)
        if (kept && kept.mtime === x.mtimeMs) {
          out.push(kept.trace)
          continue
        }
        let trace: Trace | null = null
        try {
          trace = cleanTrace(JSON.parse(String(await $.fs.read(`${dir}/${x.name}`))))
        } catch {
          // Illisible (en pleine écriture) : relue au prochain tour.
        }
        // Seule une trace bien lue se garde : une lecture ratée se refait.
        if (trace) {
          traceCache.set(x.name, { mtime: x.mtimeMs, trace })
          out.push(trace)
        }
      }
    } catch {
      // Dossier absent : seulement `$.store`.
    }
  }
  try {
    for (const key of (await $.store.keys()) as string[]) {
      if (!key.endsWith(':erased')) continue
      const trace = cleanTrace(await $.store.get(key))
      if (trace) out.push(trace)
    }
  } catch {
    // Stockage indisponible : les traces du dossier seulement.
  }
  for (const t of out) if (t.id.startsWith('run:')) erasedRuns.add(t.id.slice(4))
  return out
}

/** Les parcours effacés (leur trace), vus par les dernières lectures : une session liée les lâche (S23). */
export const erasedRuns = new Set<string>()

/** Une trace posée par un appel de writeTraces : son fichier, ou sa clé de `$.store`. */
type PosedTrace = { path: string } | { key: string }

/** Une trace de sous-agent ou de lancement (S22, S25) couvre quelle que soit sa date. */
const isUndatedTrace = (id: string): boolean => id.startsWith('agent:') || id.startsWith('call:') || id.startsWith('launch:')

/**
 * Pose les traces (S5) : l'id et la date, rien d'autre, chacune dans un fichier à elle (D2 b) : une
 * trace existante n'est jamais réécrite, une plus récente s'ajoute à côté (la lecture prend la plus
 * récente). Une trace déjà là aussi récente, ou de sous-agent ou de lancement, ne se repose pas.
 * Toutes ou aucune (S29) : si l'une échoue, celles que cet appel vient de poser sont retirées.
 * `ok` : toutes posées ; `none` : aucune posée ; `retracted` : posées puis toutes retirées ;
 * `partial` : le retrait a échoué aussi.
 */
async function writeTraces($: any, traces: readonly Trace[]): Promise<'ok' | 'none' | 'retracted' | 'partial'> {
  const known = await readTraces($)
  const posed: PosedTrace[] = []
  for (const t of traces) {
    const before = known.filter(k => k.id === t.id)
    if (before.length > 0 && (isUndatedTrace(t.id) || before.some(k => k.at >= t.at))) continue
    const value: Trace = { id: t.id, at: t.at }
    const path = tracePath($, value)
    let isWritten = false
    if (path) {
      try {
        // Le même fichier déjà là (même id, même date, en pleine écriture ailleurs) : pas touché.
        if (!(await $.fs.exists(path))) {
          await $.fs.write(path, JSON.stringify(value))
          posed.push({ path })
        }
        isWritten = true
      } catch {
        // Repli sur `$.store`.
      }
    }
    if (!isWritten) {
      try {
        if ((await $.store.get(traceKey(value))) === undefined) {
          await $.store.set(traceKey(value), value)
          posed.push({ key: traceKey(value) })
        }
      } catch {
        // S38 : rien de posé, rien à retirer ; posées puis retirées, une session ouverte a pu s'en servir (S33).
        if (posed.length === 0) return 'none'
        return (await removeTraces($, posed)) ? 'retracted' : 'partial'
      }
    }
    // Le même id plus loin dans la liste (un sous-agent vu dans deux fichiers) ne se repose pas.
    known.push(value)
  }
  return 'ok'
}

/**
 * Retire les traces qu'un effacement vient de poser (S29), et elles seules : un fichier se vide
 * (une trace vide ne se lit plus) puis se supprime, une clé s'efface. Une trace d'avant n'est
 * jamais touchée. Faux quand l'une reste lisible.
 */
async function removeTraces($: any, posed: readonly PosedTrace[]): Promise<boolean> {
  let isOk = true
  for (const p of posed) {
    if ('path' in p) {
      traceCache.delete(p.path.split('/').pop() ?? p.path)
      const done = await eraseWith(
        {
          write: (path, text) => $.fs.write(path, text),
          remove: async (path: string) => {
            const argv = removeArgv(path)
            return argv !== null && (await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0
          },
        },
        p.path,
      )
      if (!done.isEmptied) isOk = false
    } else {
      try {
        await $.store.delete(p.key)
      } catch {
        isOk = false
      }
    }
  }
  return isOk
}

/**
 * Ce que dit un effacement dont les traces n'ont pas toutes pu s'écrire (S24, S29). Retirées, elles
 * ont pu servir entre-temps à une session ouverte qui s'est compactée d'après elles (S33) ; aucune
 * posée, rien n'a été effacé (S38).
 */
const tracesRefusedText = (result: 'none' | 'retracted' | 'partial'): string =>
  result === 'none'
    ? 'Effacement impossible : les traces n’ont pas pu s’écrire, rien n’a été effacé.'
    : result === 'retracted'
      ? 'Effacement annulé : les traces n’ont pas pu s’écrire ; une session ouverte a pu en effacer une partie entre-temps.'
      : 'Effacement partiel : les traces n’ont pas toutes pu s’écrire ni se retirer ; une partie de l’historique est masquée, rien d’autre n’a été effacé.'

/**
 * Efface un fichier (S4) : réécrit vide, puis supprimé par `rm` (`del` sous Windows) ; sans
 * commande, le fichier vide reste. Faux quand il n'a pas pu être vidé.
 */
/** Les comptes rendus entiers d'un parcours dans le dossier du relais : `<parcours>.<session>.report.md`. */
async function reportFilesOf($: any, runId: string): Promise<string[]> {
  const sample = reportPath($, runId, 'x')
  if (!sample) return []
  const dir = sample.slice(0, sample.lastIndexOf('/'))
  const prefix = `${relayFileSlug(runId)}.`
  try {
    const names = ((await $.fs.list(dir)) as { name: string }[]).map(x => x.name)
    return names.filter(n => n.startsWith(prefix) && n.endsWith('.report.md')).map(n => `${dir}/${n}`)
  } catch {
    return []
  }
}

async function eraseFile($: any, path: string | null): Promise<boolean> {
  if (!path) return true
  let isThere = false
  try {
    isThere = await $.fs.exists(path)
  } catch {
    // Hors d'atteinte : rien à effacer là.
  }
  if (!isThere) return true
  const done = await eraseWith(
    {
      write: (p, text) => $.fs.write(p, text),
      // Sans `$.process.run` (surface sans commandes) ou sans commande sûre, le fichier vide reste (S4).
      remove: async (p: string) => {
        const argv = removeArgv(p)
        return argv !== null && (await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0
      },
    },
    path,
  )
  if (!done.isEmptied || !done.isRemoved) eraseFailures.push(path.split(/[\\/]/).pop() ?? path)
  return done.isEmptied
}

/** Les fichiers qu'un effacement n'a pas pu vider ou supprimer, dits à la fin (S24). */
let eraseFailures: string[] = []

/** Dit ce qu'un effacement n'a pas pu faire (S24). */
async function reportEraseFailures($: any) {
  if (eraseFailures.length === 0) return
  const names = eraseFailures.slice(0, 3).join(', ') + (eraseFailures.length > 3 ? '…' : '')
  eraseFailures = []
  await quietly(() => $.ui.toast(`Effacement incomplet : ${names} n’a pas pu être supprimé (vidé s’il a pu l’être).`))
}

/** Efface une clé de `$.store` (le repli des fichiers). */
async function eraseKey($: any, key: string) {
  await quietly(async () => {
    if ((await $.store.get(key)) !== undefined) await $.store.delete(key)
  })
}

/** Un texte pris tel quel dans une expression régulière. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Efface tout ce qu'une session a dans le registre : tous ses morceaux et son fichier à part, fichiers et clés. */
async function eraseSession($: any, id: string) {
  const dir = registryDir($)
  const slug = registryPath($, id)?.split('/').pop()?.replace(/\.json$/, '')
  if (dir && slug) {
    let names: string[] = []
    try {
      names = ((await $.fs.list(dir)) as { name: string }[]).map(x => x.name)
    } catch {
      // Dossier absent.
    }
    // Tous ses morceaux, même après un trou (ils s'écrivent du dernier au premier).
    // Les ids sont échappés (F6) : un signe d'expression régulière n'y vise pas d'autres fichiers.
    for (const name of names) if (name === `${slug}.json` || new RegExp(`^${escapeRegExp(slug)}\\.\\d+\\.json$`).test(name)) await eraseFile($, `${dir}/${name}`)
  }
  await quietly(async () => {
    for (const key of (await $.store.keys()) as string[]) if (key === registryKey(id) || new RegExp(`^${escapeRegExp(registryKey(id))}:\\d+$`).test(key)) await eraseKey($, key)
  })
  await eraseFile($, rebuiltPath($, id))
  await eraseKey($, rebuiltKey(id))
  // Sa délégation gardée ne lui fait plus reprendre un parcours effacé (S23).
  await eraseKey($, delegateKey(id))
  otherRegistries.delete(id)
  otherHeads.delete(id)
  historyHeads.delete(id)
}

/** La dernière écriture du fichier d'une session (sa date, sinon celle de son en-tête), pour savoir si elle est fermée (S19). */
async function lastWriteOf($: any, head: SessionRegistry): Promise<number> {
  const file = (await registryFiles($)).find(f => f.session === head.session)
  return file && file.mtime >= 0 ? file.mtime : head.updatedAt
}

/**
 * Le registre entier d'une session dont l'en-tête annonce des morceaux (R1) : ses sous-agents au
 * travail et ce que les traces couvrent peuvent être dans un morceau suivant (les nouveaux vont au
 * dernier). L'en-tête seul quand il n'y a qu'un morceau, ou quand la relecture échoue.
 */
async function wholeOf($: any, head: SessionRegistry): Promise<SessionRegistry> {
  if ((head.parts ?? 1) <= 1) return head
  const got = await readRegistry($, head.session)
  return got.ok && got.value ? got.value : head
}

/**
 * Supprimer un parcours (Q6 a1, S3, S14) : les traces d'abord (le parcours, ses sessions liées,
 * chacun de ses sous-agents), puis cette discussion se compacte, les orchestrateurs fermés sont
 * réécrits sans lui, ses sessions liées fermées s'effacent, et son relais, ses choix et son
 * fichier à part s'effacent. Les sessions ouvertes se compactent elles-mêmes.
 */
export async function eraseRun($: any, run: Run): Promise<boolean> {
  return (await whileErasing($, `run:${run.id}`, run.title, () => eraseRunNow($, run))) === true
}

/**
 * R1, S36 : les effacements en cours dans ce processus, par clé (`run:<id>`, `session:<id>`), avec
 * leur titre. En mémoire seulement : un rechargement du mod repart d'une liste vide, et la ligne
 * « effacement en cours » ne peut pas rester bloquée.
 */
export const erasingNow = new Map<string, string>()

/**
 * Fait un effacement en le disant dans l'onglet du début à la fin (R1) ; chacun ne retire que le
 * sien (S36). Un second effacement de la même clé déjà en cours ne fait rien (rend null).
 */
async function whileErasing<T>($: any, key: string, title: string, work: () => Promise<T>): Promise<T | null> {
  if (erasingNow.has(key)) return null
  // Un redessin refusé n'arrête rien : la clé part toujours, la ligne ne reste jamais bloquée (S36).
  const redraw = () => {
    try {
      $.ui.invalidate('ui.render')
    } catch {
      // L'onglet se redessinera au prochain changement.
    }
  }
  erasingNow.set(key, title)
  try {
    redraw()
    return await work()
  } finally {
    erasingNow.delete(key)
    redraw()
  }
}

/**
 * D4 (S34) : les sous-agents manqués d'un parcours qu'on supprime, relus dans les transcripts des
 * discussions qui l'ont porté (les sessions liées sont couvertes en entier par leur trace) : ceux
 * dont le départ tombe dans la période où elles le portaient (R3), sauf ceux qu'un registre ou un
 * fichier à part range ailleurs, dans un autre parcours ou suivis en direct sans parcours (S32).
 * `failed` : les transcripts qui n'ont pas pu se relire (S39).
 */
async function missedAgentsOf($: any, run: Run, runs: readonly Run[], carriers: readonly SessionRegistry[]): Promise<{ agents: { key: string; agentId?: string }[]; failed: number }> {
  const agents: { key: string; agentId?: string }[] = []
  let failed = 0
  for (const reg of carriers) {
    // S39 (a) : sans transcript connu, rien ne se relit : non relu.
    if (!reg.transcript) {
      failed += 1
      continue
    }
    const scanned = await scanTranscriptAgents($, reg.transcript, runWindow(run).s)
    failed += scanned.failed
    const carried = runsCarriedBy(runs, reg)
    // Son fichier à part (Q14) range aussi des sous-agents, chacun avec son parcours.
    const side = (await readRebuiltState($, reg.session)).value?.agents ?? []
    for (const a of scanned.agents) {
      if (a.lane.startedAt === undefined || carriedRunAt(carried, reg, a.lane.startedAt) !== run.id) continue
      const known = reg.agents.find(x => x.agentId === a.agentId || (a.meta.toolUseId !== undefined && x.key === a.meta.toolUseId))
      if (known && (known.run !== undefined ? known.run !== run.id : known.source === 'live')) continue
      const ranged = side.find(x => x.agentId === a.agentId)
      if (ranged?.run !== undefined && ranged.run !== run.id) continue
      agents.push({ key: a.meta.toolUseId ?? `agent:${a.agentId}`, agentId: a.agentId })
    }
  }
  return { agents, failed }
}

async function eraseRunNow($: any, run: Run): Promise<boolean> {
  const now = await $.clock.now()
  const self: SessionRegistry | null = await read($, registryAtom)
  const board: Board | null = await read($, boardAtom)
  const heads = await readAllHeads($, self?.session ?? '')
  const stored = await readRelay($, run.id)
  const relay = stored !== null && typeof stored === 'object' && typeof (stored as Relay).sessions === 'object' ? (stored as Relay) : null
  const linkedIds = new Set([...heads.filter(h => h.run === run.id).map(h => h.session), ...Object.keys(relay?.sessions ?? {})])
  if (self) linkedIds.delete(self.session)
  const orchestrators: SessionRegistry[] = []
  // Les discussions qui l'ont porté (S27, S28), à relire pour D4.
  const carriers: SessionRegistry[] = []
  // S39 : une discussion qui l'a porté dont le registre ne se relit pas en entier n'est pas relue : elle compte.
  let unreadCarriers = 0
  const runs = board?.runs.some(r => r.id === run.id) ? board.runs : [...(board?.runs ?? []), run]
  for (const h of heads) {
    if (linkedIds.has(h.session)) continue
    const isMaybe = self !== null && (h.parts ?? 1) > 1 && h.updatedAt >= run.startedAt && isSameProject(self.root, h.root)
    // R5 : une discussion qui l'a porté, même sans sous-agent de lui, perd aussi son id tout de suite.
    const isCarrier = runsCarriedBy([run], h).length > 0
    if (!h.agents.some(a => a.run === run.id) && !isMaybe && !isCarrier) continue
    const full = (await readRegistry($, h.session)).value
    if (!full) {
      if (isCarrier) unreadCarriers += 1
      continue
    }
    const isFullCarrier = runsCarriedBy([run], full).length > 0
    if (isFullCarrier) carriers.push(full)
    if (full.agents.some(a => a.run === run.id) || isFullCarrier) orchestrators.push(full)
  }
  if (self && runsCarriedBy([run], self).length > 0) carriers.unshift(self)
  // S22 : une trace par sous-agent effacé, qu'il vive dans un registre, un fichier à part repris
  // (Q14) ou le fichier du parcours (anciennes lignes).
  const erased: { key: string; agentId?: string }[] = [...(self?.agents ?? []), ...orchestrators.flatMap(o => o.agents)].filter(a => a.run === run.id)
  const sideIds = (await rebuiltIds($)).filter(id => !id.startsWith('run-'))
  for (const id of sideIds) {
    for (const a of (await readRebuiltState($, id)).value?.agents ?? []) if (a.run === run.id) erased.push({ key: a.meta.toolUseId ?? `agent:${a.agentId}`, agentId: a.agentId })
  }
  for (const r of (await readRebuiltState($, runFileId(run.id), `run:${run.id}`)).value?.rows ?? []) erased.push(r)
  // D4 (S34) : relus avant d'effacer, les sous-agents manqués partent aussi ; un transcript qui ne se relit pas n'arrête rien.
  const missed = await missedAgentsOf($, run, runs, carriers)
  missed.failed += unreadCarriers
  erased.push(...missed.agents)
  // Les traces datent de leur pose : ce qui part pendant la relecture dans une session ouverte est couvert aussi.
  const at = await $.clock.now()
  // S25 : les lancements de ses sessions liées, chez les orchestrateurs.
  const launches: string[] = []
  for (const o of [...(self ? [self] : []), ...orchestrators]) {
    for (const ls of linkedSessions({ self: o, run: run.id, relay, others: heads, now })) {
      if ((ls.session !== undefined && linkedIds.has(ls.session)) || ls.how === 'run' || ls.how === 'relay') if (o.linked?.some(l => l.id === ls.key)) launches.push(ls.key)
    }
  }
  const traces: Trace[] = [
    { id: `run:${run.id}`, at },
    ...[...linkedIds].map(id => ({ id, at })),
    ...erased.flatMap(a => agentTraces(a, at)),
    ...launches.map(id => ({ id: `launch:${id}`, at })),
  ]
  // S24, S29 : sans toutes les traces posées, rien n'est effacé, et le parcours reste.
  const posed = await writeTraces($, traces)
  if (posed !== 'ok') {
    await quietly(() => $.ui.toast(tracesRefusedText(posed)))
    return false
  }
  // La pierre tombale prend la date des traces : un parcours mis à jour ailleurs pendant la relecture D4 ne revient pas par la fusion du board.
  await commit($, board => dropRun(board, run.id, at))
  const all = await readTraces($)
  // Cette discussion : tout de suite, dans son état ; son fichier suit à la prochaine écriture.
  if (self) await quietly(() => commitRegistry($, r => applyTraces(r, all)))
  // Un orchestrateur fermé (jugé sans ce que les traces retirent) est réécrit sans le parcours
  // (S14), s'il se relit en entier ; ouvert, il se compacte lui-même.
  for (const o of orchestrators) {
    const head = heads.find(h => h.session === o.session)!
    if (!isClosedSession(applyTraces(o, all) ?? o, await lastWriteOf($, head), now)) continue
    await rewriteCovered($, o.session, all)
  }
  // Ses sessions liées fermées s'effacent ; les ouvertes, ou celles dont l'en-tête ne se lit pas
  // (peut-être en pleine écriture), se compactent d'après la trace (S6).
  for (const id of linkedIds) {
    const head = heads.find(h => h.session === id)
    const isEnded = relay?.sessions[id]?.endedAt !== undefined
    if (head && isClosedSession(await wholeOf($, head), await lastWriteOf($, head), now, isEnded)) await eraseSession($, id)
    // Ouverte aussi, sa délégation gardée part (S23) : rechargée, elle ne reprend pas le parcours effacé.
    else await eraseKey($, delegateKey(id))
  }
  // Les fichiers à part se compactent (seul le rattrapage les écrit : leur session ne le fera pas) ;
  // le sien, son relais et ses choix s'effacent.
  for (const id of sideIds) await updateRebuilt($, id, id, before => before)
  await eraseFile($, rebuiltPath($, runFileId(run.id)))
  await eraseKey($, rebuiltKey(runFileId(run.id)))
  // Les comptes rendus entiers des sessions liées et la référence de la discussion principale :
  // leurs chemins se calculent d'après les ids, jamais lus dans le relais (un fichier d'une autre session).
  for (const id of Object.keys(relay?.sessions ?? {})) await eraseFile($, reportPath($, run.id, id))
  // Ceux que le relais ne nomme plus (relais illisible, entrée sortie du plafond, écrit après) : par le dossier.
  for (const path of await reportFilesOf($, run.id)) await eraseFile($, path)
  await eraseFile($, mainRefPath($, run.id))
  await eraseKey($, mainRefKey(run.id))
  await eraseFile($, relayPath($, run.id))
  await eraseKey($, relayKey(run.id))
  await eraseFile($, decidedPath($, run.id))
  await reportEraseFailures($)
  if (missed.failed > 0) await quietly(() => $.ui.toast(`${missed.failed} ${missed.failed > 1 ? 'transcripts non relus' : 'transcript non relu'} : un sous-agent manqué pourrait revenir sans parcours.`))
  await refreshHistory($)
  return true
}

/** Réécrit le registre d'une session fermée sans ce que les traces couvrent (S14), s'il se relit en entier. */
async function rewriteCovered($: any, id: string, traces: readonly Trace[]) {
  const got = await readRegistry($, id)
  const next = got.ok && got.value && got.isWhole ? applyTraces(got.value, traces) : null
  if (next && !(await writeRegistry($, next, got.placed, got.count))) eraseFailures.push(`${id}.json`)
}

/**
 * « ✗ Oublier » une discussion (S2) : sa trace et celles de ses sessions liées sûres (S15), puis
 * l'effacement de leurs fichiers, tout de suite pour une session fermée ; une session ouverte se
 * compacte elle-même.
 */
export async function forgetSession($: any, id: string) {
  const heads = await readAllHeads($, ((await read($, registryAtom)) as SessionRegistry | null)?.session ?? '')
  const shown = historyShown?.key === `session:${id}` ? historyShown : await buildShown($, `session:${id}`, await read($, boardAtom), heads)
  await whileErasing($, `session:${id}`, shown?.title ?? id, () => forgetSessionNow($, id, heads, shown))
}

async function forgetSessionNow($: any, id: string, heads: SessionRegistry[], shown: HistoryShown | null) {
  const now = await $.clock.now()
  const self: SessionRegistry | null = await read($, registryAtom)
  const sure = (shown?.linked ?? []).filter(l => isSureLink(l.session.how) && l.session.session !== undefined).map(l => l.session.session!)
  const ids = [id, ...sure]
  // Q-b (comme S22) : une trace par sous-agent oublié, de son registre ou de son fichier à part ;
  // un sous-agent de fond qui se réveille ensuite ne revient pas dans l'historique.
  const erased: { key: string; agentId?: string }[] = []
  for (const x of ids) {
    const reg = self && x === self.session ? self : (await readRegistry($, x)).value
    erased.push(...(reg?.agents ?? []))
    for (const a of (await readRebuiltState($, x)).value?.agents ?? []) erased.push({ key: a.meta.toolUseId ?? `agent:${a.agentId}`, agentId: a.agentId })
  }
  const posed = await writeTraces($, [...ids.map(x => ({ id: x, at: now })), ...erased.flatMap(a => agentTraces(a, now))])
  if (posed !== 'ok') {
    await quietly(() => $.ui.toast(tracesRefusedText(posed)))
    return
  }
  const all = await readTraces($)
  for (const x of ids) {
    if (self && x === self.session) {
      await quietly(() => commitRegistry($, r => applyTraces(r, all)))
      await updateRebuilt($, x, x, before => before)
      continue
    }
    // Fermée, elle s'efface ; ouverte, ou d'en-tête illisible (peut-être en pleine écriture), elle se compacte elle-même (S6).
    const head = heads.find(h => h.session === x)
    if (head && isClosedSession(await wholeOf($, head), await lastWriteOf($, head), now)) await eraseSession($, x)
    else await updateRebuilt($, x, x, before => before)
  }
  await reportEraseFailures($)
  await update($, uiAtom, ui => ({ ...ui, agentsHistory: undefined, confirmForget: undefined, agentsSession: undefined }))
  clearHistoryShown()
  await refreshHistory($)
}

/**
 * S26 : à chaque relecture, une session fermée qu'une trace couvre et qui ne l'a pas encore
 * appliquée (trace plus récente que sa dernière écriture) est traitée comme à l'effacement :
 * effacée si une trace la couvre toute (la sienne, ou celle du parcours qu'elle servait),
 * réécrite sans ce qu'elles couvrent sinon. Les fichiers à part se compactent quand les traces changent.
 */
let reconciledTraces = ''
/** Les registres en morceaux que les traces ne couvrent pas, par session (date du fichier et traces) : pas relus en entier pour rien. */
const uncoveredParts = new Map<string, string>()
export async function reconcileErased($: any) {
  const self: SessionRegistry | null = await read($, registryAtom)
  const traces = await readTraces($)
  if (traces.length === 0) return
  const now = await $.clock.now()
  await readAllHeads($, self?.session ?? '')
  const key = traces.map(t => `${t.id}@${t.at}`).sort().join(',')
  for (const { mtime, head } of [...historyHeads.values()]) {
    // Ce que les traces couvrent encore dans son fichier (tel qu'écrit, tous ses morceaux) ; rien : rien à faire.
    const seen = `${mtime}|${key}`
    if (mtime >= 0 && uncoveredParts.get(head.session) === seen) continue
    const raw = await wholeOf($, head)
    const covered = applyTraces(raw, traces)
    if (!covered) {
      if (raw !== head) uncoveredParts.set(head.session, seen)
      continue
    }
    const last = await lastWriteOf($, raw)
    // Fermée d'après ce qui reste une fois les traces appliquées (S19).
    if (!isClosedSession(covered, last, now)) continue
    const isWhole = traces.some(t => (t.id === raw.session || (raw.run !== undefined && t.id === `run:${raw.run}`)) && t.at > last)
    if (isWhole) await eraseSession($, raw.session)
    else await rewriteCovered($, raw.session, traces)
  }
  if (key !== reconciledTraces) {
    reconciledTraces = key
    for (const id of await rebuiltIds($)) await updateRebuilt($, id, id.startsWith('run-') ? `run:${id.slice(4)}` : id, before => before)
  }
  await reportEraseFailures($)
}
