// flow-board : le rattrapage du registre par les transcripts de Claude Code.
//
// Les transcripts de Claude Code font foi pour les chiffres. Le rattrapage tourne à l'ouverture de
// l'onglet sur la session affichée, et à la fin d'un sous-agent dont les chiffres manquent. Pour
// cette session, il complète son propre registre ; pour une session liée affichée, il écrit son
// fichier à part, `<session>.rebuilt.json`, que seule le rattrapage écrit (S13).

import { atom, read } from 'claude-code'
import type { Board, SessionRegistry } from '../types'
import { readTraces } from './erase-run.ts'
import { applyTraces, applyTracesToRebuilt } from './erase.ts'
import { type Rebuilt, attachCarried, cleanRebuilt, runsCarriedBy, unionRebuilt, withCarriedRuns } from './history.ts'
import type { LinkedSession } from './linked.ts'
import { EMPTY_UI } from './model.ts'
import { agentCalls, claudeHome, otherRegistries, refreshLinked } from './register.tsx'
import { commitRegistry, lockRegistryDir, registryKey, registryPath } from './registry-file.ts'
import { MAIN, catchUpAdvisor } from './registry.ts'
import { SUBAGENT_FILE, type TranscriptAgent, catchUp, drainWithin, isTranscriptPath, laneFromTranscript, metaFromText, readArgv, subagentsDirOf } from './transcript.ts'

/** Les atomes lus ou mis à jour ici : le moteur veut leur déclaration dans le fichier qui les lit. */
const boardAtom = atom({ plugin: 'flow-board', key: 'board' } as const, null)
const linkedAtom = atom({ plugin: 'flow-board', key: 'agentsLinked' } as const, [] as LinkedSession[])
const registryAtom = atom({ plugin: 'flow-board', key: 'agents' } as const, null)
const uiAtom = atom({ plugin: 'flow-board', key: 'ui' } as const, EMPTY_UI)

/** Le fichier de registre de cette session était illisible au chargement : il se reconstruit dès que son transcript est connu. */
export let needsRebuild = false
/** Le registre de cette session s'est lu illisible : `needsRebuild` ne s'écrit que d'ici. */
export const markRebuildNeeded = () => {
  needsRebuild = true
}
/** Les transcripts de sous-agents déjà lus, par chemin, avec leur date : relus seulement quand elle change. */
const transcriptCache = new Map<string, { mtime: number; agent: TranscriptAgent }>()
/** Au-delà, un transcript ne se relit pas en entier (la piste de la session seulement : ses sous-agents ont chacun le leur). */
const TRANSCRIPT_MAX_BYTES = 64 * 1024 * 1024

/** Au-delà, la lecture en flux d'un transcript est abandonnée (F6 : un délai sur chaque commande). */
const TRANSCRIPT_READ_MS = 60_000

/**
 * Le dossier de Claude Code où vivent les transcripts : `CLAUDE_CONFIG_DIR` (le premier s'il y en a
 * plusieurs), sinon celui d'où le mod est installé, sinon `~/.claude` ; null quand rien ne le dit.
 */
export async function claudeDir($: any): Promise<string | null> {
  // `$.env.get` veut un nom littéral : chaque variable a son appel.
  const env = async (read: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      const value = await read()
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    } catch {
      return undefined
    }
  }
  const custom = await env(() => $.env.get('CLAUDE_CONFIG_DIR'))
  // Sans barre finale : les chemins listés sous lui et la garde de lecture se comparent pareil.
  const first = custom?.split(',')[0]!.trim().replace(/[\\/]+$/, '')
  if (first) return first
  const home = claudeHome($)
  if (home) return home
  const user = (await env(() => $.env.get('USERPROFILE'))) ?? (await env(() => $.env.get('HOME')))
  return user ? `${user.replace(/[\\/]+$/, '')}/.claude` : null
}

/**
 * Le texte d'un transcript : `$.fs.read` jusqu'à 4 Mio, sinon lu en flux par une commande
 * système (`cat --`, `type` sous Windows), dans un délai ; null quand il ne se lit pas. Seul un
 * transcript sous `<dossier Claude>/projects/` se lit (F4).
 */
export async function readTranscript($: any, path: string): Promise<string | null> {
  if (!isTranscriptPath(path, await claudeDir($))) return null
  try {
    return String(await $.fs.read(path))
  } catch {
    // Trop gros pour une lecture, ou absent.
  }
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file' || stat.size > TRANSCRIPT_MAX_BYTES) return null
    const argv = readArgv(path)
    if (!argv) return null
    // Le délai ne s'annule pas : arrivé après la fin, il ne fait rien.
    const deadline = new Promise<void>(resolve => $.clock.after(TRANSCRIPT_READ_MS, () => resolve()))
    return await drainWithin($.process.spawn({ argv }), deadline)
  } catch {
    return null
  }
}

/** Un sous-agent d'après son transcript et son `.meta.json` (à côté) ; relu seulement quand le fichier change. */
async function transcriptAgent($: any, path: string, mtime: number): Promise<TranscriptAgent | null> {
  const agentId = SUBAGENT_FILE.exec(path.split(/[\\/]/).pop() ?? '')?.[1]
  if (!agentId) return null
  const kept = transcriptCache.get(path)
  if (kept && mtime >= 0 && kept.mtime === mtime) return kept.agent
  const text = await readTranscript($, path)
  if (text === null) return kept?.agent ?? null
  let meta = {}
  try {
    meta = metaFromText(String(await $.fs.read(path.replace(/\.jsonl$/, '.meta.json'))))
  } catch {
    // Sans `.meta.json` : le transcript seul.
  }
  const agent: TranscriptAgent = { agentId, lane: laneFromTranscript(text), meta }
  transcriptCache.set(path, { mtime, agent })
  return agent
}

/** Un fichier présent ; faux quand il manque ou ne se voit pas. */
async function isPresent($: any, path: string): Promise<boolean> {
  try {
    return Boolean(await $.fs.exists(path))
  } catch {
    return false
  }
}

/**
 * Les sous-agents d'une session d'après leurs transcripts (`<session>/subagents/agent-<id>.jsonl`),
 * et le nombre de transcripts qui n'ont pas pu se relire (S34, S39) : refusé par la garde, dossier
 * illisible, trop gros, délai dépassé. Un dossier ou un fichier absent (pas de sous-agent, nettoyé
 * par Claude Code) n'est pas un échec. `since` : les fichiers modifiés pour la dernière fois avant
 * ne sont pas relus (ils ne peuvent pas tenir un sous-agent parti après).
 */
export async function scanTranscriptAgents($: any, transcript: string, since = -Infinity): Promise<{ agents: TranscriptAgent[]; failed: number }> {
  const dir = subagentsDirOf(transcript)
  // Le dossier d'un transcript que la garde refuse ne se liste pas non plus (F4).
  if (!isTranscriptPath(transcript, await claudeDir($))) return { agents: [], failed: 1 }
  if (!dir) return { agents: [], failed: 0 }
  let entries: { name: string; kind: string; mtimeMs: number }[] = []
  try {
    entries = (await $.fs.list(dir)) as typeof entries
  } catch {
    return { agents: [], failed: (await isPresent($, dir)) ? 1 : 0 }
  }
  const agents: TranscriptAgent[] = []
  let failed = 0
  for (const x of entries) {
    if (x.kind !== 'file' || !SUBAGENT_FILE.test(x.name) || x.mtimeMs < since) continue
    const path = `${dir}/${x.name}`
    const agent = await transcriptAgent($, path, x.mtimeMs)
    if (agent) agents.push(agent)
    else if (await isPresent($, path)) failed += 1
  }
  return { agents, failed }
}

/** Les sous-agents d'une session d'après leurs transcripts. */
export async function transcriptAgents($: any, transcript: string): Promise<TranscriptAgent[]> {
  return (await scanTranscriptAgents($, transcript)).agents
}

/** Les appels à l'advisor de l'orchestrateur déjà cherchés dans le transcript de la session, par ce processus. */
const advisorSought = new Set<string>()

/**
 * Le rattrapage de cette session : ses sous-agents d'après leurs transcripts ; reconstruit
 * (`isRebuild`, fichier illisible), aussi la piste de la session d'après son propre transcript.
 */
export async function catchUpOwn($: any, isRebuild = false) {
  const reg: SessionRegistry | null = await read($, registryAtom)
  const transcript = reg?.transcript
  if (!transcript) return
  const found = await transcriptAgents($, transcript)
  // Le transcript de la session se relit pour une reconstruction, ou quand un appel à l'advisor de
  // l'orchestrateur n'y a pas encore été relu (le direct ne donne ni modèle ni tokens) ; un appel
  // que le transcript ne donne pas (étape coupée) n'en relance pas la lecture à chaque passage.
  const unread = (reg?.advisor?.calls ?? []).filter(c => c.by === MAIN && c.isRead !== true && !advisorSought.has(c.id)).map(c => c.id)
  const mainText = isRebuild || unread.length > 0 ? await readTranscript($, transcript) : null
  for (const id of unread) advisorSought.add(id)
  const main = mainText !== null ? laneFromTranscript(mainText, true) : null
  const now = await $.clock.now()
  // Les appels encore en vol ici ne se closent pas d'après leur transcript.
  const inFlight = new Set(agentCalls)
  const traces = await readTraces($)
  const board: Board | null = await read($, boardAtom)
  // Une session liée n'est pas concernée (S27) : sa suppression l'efface déjà en entier.
  const runs = board && !board.delegate ? board.runs : []
  await commitRegistry($, r => {
    // Q-a (S27) : un sous-agent qui manquait au registre rejoint le parcours que la discussion portait à son départ ;
    // R2 (S32) : une entrée rattrapée plus tôt sans parcours aussi, à chaque rattrapage.
    let next = catchUp(r, withCarriedRuns(found, r, runsCarriedBy(runs, r)), now, inFlight) ?? r
    next = attachCarried(next, runsCarriedBy(runs, next)) ?? next
    // Une session effacée en partie ne reprend pas les totaux de tout son transcript.
    const isCovered = traces.some(t => t.id === r.session)
    if (main) next = catchUpAdvisor(next, MAIN, main.advisor, now) ?? next
    if (isRebuild && main && (main.segments ?? []).length > 0) {
      // La piste vécue ici depuis le démarrage reste ; le transcript rend ce qui la précède, et ses
      // chiffres font foi.
      const live = next.main?.segments ?? []
      const since = live.length > 0 ? Math.min(...live.map(x => x.s)) : Infinity
      const before = (main.segments ?? []).filter(x => (x.e ?? x.s) <= since)
      next = {
        ...next,
        main: { ...next.main, segments: [...before, ...live].sort((a, b) => a.s - b.s), ...(main.tokens && !isCovered ? { tokens: main.tokens } : {}), ...(main.models ? { models: main.models } : {}) },
      }
    }
    // Les traces après la fusion : rien de ce qu'elles couvrent ne revient (S5).
    next = applyTraces(next, traces) ?? next
    return next === r ? null : next
  })
  if (isRebuild) needsRebuild = false
}

/**
 * Le fichier à part d'une session reconstruite (S13), `<session>.rebuilt.json`, ou d'un parcours
 * (S18), `run-<parcours>.rebuilt.json` ; sa clé de `$.store` en repli.
 */
export function rebuiltPath($: any, id: string): string | null {
  return registryPath($, id)?.replace(/\.json$/, '.rebuilt.json') ?? null
}
export const rebuiltKey = (id: string): string => `${registryKey(id)}:rebuilt`

/**
 * Le fichier à part `id`, entrée par entrée (F3) ; `session` : ce qu'il doit déclarer. `ok` faux :
 * la relecture a échoué (fichier occupé, droits, écriture coupée), à ne pas confondre avec un
 * fichier absent (`value: null`) ; un écrivain ne réécrit jamais un fichier qu'il n'a pas pu relire.
 */
export async function readRebuiltState($: any, id: string, session: string = id): Promise<{ ok: boolean; value: Rebuilt | null }> {
  const path = rebuiltPath($, id)
  let isThere = false
  try {
    isThere = path !== null && (await $.fs.exists(path))
  } catch {
    // Dossier hors d'atteinte : l'ancien stockage.
  }
  try {
    const raw = isThere ? JSON.parse(String(await $.fs.read(path!))) : await $.store.get(rebuiltKey(id))
    if (raw === undefined || raw === null) return { ok: true, value: null }
    const value = cleanRebuilt(raw, session)
    return value ? { ok: true, value } : { ok: false, value: null }
  } catch {
    return { ok: false, value: null }
  }
}

/** Le fichier à part `id` pour l'affichage, sans ce que les traces couvrent (S5) ; null quand il manque ou ne se lit pas. */
export async function readRebuilt($: any, id: string, session: string = id): Promise<Rebuilt | null> {
  const value = (await readRebuiltState($, id, session)).value
  return value ? (applyTracesToRebuilt(value, await readTraces($)) ?? value) : null
}

/** Écrit le fichier à part `id` : le fichier, sinon `$.store` quand il n'existe pas déjà ; faux quand rien ne l'accepte. */
async function writeRebuilt($: any, id: string, rebuilt: Rebuilt): Promise<boolean> {
  const path = rebuiltPath($, id)
  let isThere = false
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(rebuilt))
      await lockRegistryDir($)
      return true
    } catch {
      try {
        isThere = await $.fs.exists(path)
      } catch {
        // Inconnu : le repli reste permis.
      }
    }
  }
  // Un fichier là mais refusé : un repli dans `$.store` serait caché par lui à la lecture.
  if (isThere) return false
  try {
    await $.store.set(rebuiltKey(id), rebuilt)
    return true
  } catch {
    return false
  }
}

/** Un fichier à part qui ne tient rien : ni sous-agent, ni ligne recopiée, ni parcours repris, ni piste, ni appel à l'advisor. */
const isEmptyRebuilt = (r: Rebuilt): boolean =>
  r.agents.length === 0 &&
  (r.rows ?? []).length === 0 &&
  (r.runs ?? []).length === 0 &&
  (r.main?.segments ?? []).length === 0 &&
  (r.main?.marks ?? []).length === 0 &&
  (r.main?.advisor ?? []).length === 0

/** Une écriture des fichiers à part à la fois dans ce processus (S20). */
let rebuiltQueue: Promise<unknown> = Promise.resolve()
const inRebuiltQueue = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = rebuiltQueue.then(job, job)
  rebuiltQueue = run.catch(() => undefined)
  return run
}

/**
 * Change le fichier à part `id` (S20) : relu juste avant, `change` rend sa nouvelle version (une
 * fusion, sauf la sortie d'une ligne retrouvée, S18), écrite si elle diffère. Faux quand il ne se
 * relit pas, ou que l'écriture est refusée.
 */
export function updateRebuilt(
  $: any,
  id: string,
  session: string,
  change: (before: Rebuilt | null) => Rebuilt | null,
): Promise<boolean> {
  return inRebuiltQueue(async () => {
    const before = await readRebuiltState($, id, session)
    if (!before.ok) return false
    // Ce que les traces couvrent ne s'y réécrit pas (S5) : une écriture compacte aussi.
    const traces = await readTraces($)
    const changed = change(before.value)
    const next = changed ? (applyTracesToRebuilt(changed, traces) ?? changed) : null
    if (!next || JSON.stringify(next) === JSON.stringify(before.value)) return true
    // Un fichier absent ne se crée pas vide (tout couvert par les traces) : un effacement passé entre-temps ne revient pas.
    if (before.value === null && isEmptyRebuilt(next)) return true
    return writeRebuilt($, id, next)
    })
}

/**
 * Le rattrapage d'une session liée affichée : d'après le transcript que son en-tête relève, son
 * fichier à part se fusionne (S13, S20) ; son propre fichier n'est jamais touché (Q7).
 */
async function catchUpLinked($: any, session: string) {
  const reg = otherRegistries.get(session)?.reg
  if (!reg?.transcript) return
  const agents = await transcriptAgents($, reg.transcript)
  if (agents.length === 0) return
  const before = JSON.stringify(await readRebuilt($, session))
  await updateRebuilt($, session, session, was => unionRebuilt(was, { v: 1, session, agents }))
  if (JSON.stringify(await readRebuilt($, session)) === before) return
  // La prochaine relecture applique le fichier à part.
  otherRegistries.delete(session)
  await refreshLinked($)
}

/** Le rattrapage de ce que l'onglet montre : cette session, ou la session liée choisie. */
export async function catchUpShown($: any) {
  const ui = await read($, uiAtom)
  if (ui.tab !== 'agents') return
  const chosen = ui.agentsSession !== undefined ? (await read($, linkedAtom)).find(l => l.key === ui.agentsSession) : undefined
  if (chosen?.session !== undefined) await catchUpLinked($, chosen.session)
  else await catchUpOwn($, needsRebuild)
}

/**
 * La fin d'un sous-agent dont les chiffres manquent (aucun token relevé) : son transcript, donné
 * par la fin elle-même (`agent_transcript_path`), les apporte.
 */
export async function catchUpAgent($: any, agentId: string, path: unknown) {
  if (typeof path !== 'string' || !/\.jsonl$/.test(path)) return
  const known = ((await read($, registryAtom)) as SessionRegistry | null)?.agents.find(a => a.agentId === agentId)
  if (!known || known.tokens !== undefined) return
  const agent = await transcriptAgent($, path, -1)
  if (!agent) return
  const now = await $.clock.now()
  const inFlight = new Set(agentCalls)
  const traces = await readTraces($)
  await commitRegistry($, r => {
    const next = catchUp(r, [agent], now, inFlight)
    return next ? (applyTraces(next, traces) ?? next) : null
  })
}
