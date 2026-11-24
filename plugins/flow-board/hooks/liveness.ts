// Le signal de vie d'une discussion : « vivante », « arrêtée » ou
// « inconnu », lu dans les fichiers que Claude Code tient lui-même sous son dossier (`sessions/<pid>.json`,
// `jobs/<id court>/state.json`), sans rien écrire, sans rien garder, sans lancer aucune commande. Le verdict
// est une fonction pure (`livenessVerdict`) ; les lecteurs (`readSessions`, `readJobOf`, `readVerdicts`) ne font que lire.
// Format interne à Claude Code, non documenté : tout doute rend « inconnu », qui garde le comportement d'avant.

import { isSafeId } from './closing.ts'
import { soundClaim } from './model.ts'
import type { Liveness } from '../types'

/** Le verdict : le processus de la discussion tourne, s'est arrêté (session d'arrière-plan seulement), ou on ne sait pas. */
export type { Liveness } from '../types'

/** Ce que la lecture du dossier `sessions` a trouvé : les ids des discussions qui ont un processus, et si elle est complète. */
export type SessionsRead = { ids: ReadonlySet<string>; isComplete: boolean }

/** Le job d'arrière-plan d'une discussion (son `state.json`), réduit à ce que le verdict lit. */
export type JobRead = { sessionId?: string; resumeSessionId?: string; updatedAt: number }

/** Au-delà, la lecture des fichiers de session est incomplète (P4). */
export const SESSIONS_MAX = 256
/** Au-delà, un fichier de session ou un `state.json` n'est pas lu (P4, P3). */
const LIVENESS_FILE_MAX = 65_536
/** Au-delà, la recherche du job d'une discussion par `resumeSessionId` s'arrête : pas de job (P3). */
export const JOBS_MAX = 128

/** Le nom d'un fichier de session : le pid du processus, 1 à 10 chiffres, puis `.json` (jamais un `.key` voisin). */
const SESSION_FILE = /^[0-9]{1,10}\.json$/
/** Un id au format d'un UUID, le seul qui peut avoir un job. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Le nom d'un dossier de job : 8 signes hexadécimaux. */
const JOB_DIR = /^[0-9a-f]{8}$/

/**
 * Le verdict de la discussion `id`, pour une mission dont la prise est `claim`, à l'heure `now`, d'après ce qui a été
 * lu (spec § 1, dans l'ordre) : vivante quand un fichier de session porte son id, ou l'un des deux ids de son job ;
 * inconnu sur une lecture incomplète ou sans job ; arrêtée quand la prise est en forme, que sa date ne dépasse pas
 * `updatedAt` du job et que celle-ci ne dépasse pas `now` ; inconnu sinon. Pure : elle ne lit rien.
 */
export const livenessVerdict = (id: string, sessions: SessionsRead, job: JobRead | null, claim: unknown, now: number): Liveness => {
  if (sessions.ids.has(id)) return 'alive'
  if (job && ((job.sessionId !== undefined && sessions.ids.has(job.sessionId)) || (job.resumeSessionId !== undefined && sessions.ids.has(job.resumeSessionId)))) return 'alive'
  if (!sessions.isComplete || !job) return 'unknown'
  const c = soundClaim(claim)
  return c !== undefined && c.at <= job.updatedAt && job.updatedAt <= now ? 'stopped' : 'unknown'
}

/** Le job est-il celui de la discussion `id` : son `sessionId` ou son `resumeSessionId` vaut cet id (P3). */
const isJobOf = (job: JobRead, id: string): boolean => job.sessionId === id || job.resumeSessionId === id

/** Un fichier (pas un lien) de `LIVENESS_FILE_MAX` octets au plus, lu et parsé ; sinon `undefined`. */
async function readSmallJson($: any, path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const st = (await $.fs.stat(path)) as { kind?: string; size?: number; isLink?: boolean }
    if (st.isLink || st.kind !== 'file' || typeof st.size !== 'number' || st.size > LIVENESS_FILE_MAX) return undefined
    const raw = JSON.parse(String(await $.fs.read(path))) as unknown
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * Les ids des discussions dont un processus tourne, lus dans `<home>/sessions/<pid>.json` (le dossier de Claude Code
 * `home`, celui que rend `claudeHome`). N'ouvre que les fichiers ordinaires, pas un lien, nommés `<chiffres>.json`, et
 * n'en garde que `sessionId` quand c'est un id sûr. Incomplète (P4) : `home` absent, dossier qui ne se liste pas, plus
 * de `SESSIONS_MAX` fichiers retenus (les `SESSIONS_MAX` premiers seuls lus, leurs discussions restant vivantes), une entrée `<chiffres>.json` qui est un lien ou pas un fichier ordinaire (jamais
 * ouverte), ou un fichier retenu trop gros, illisible, pas du JSON ou sans `sessionId` sûr.
 */
export async function readSessions($: any, home: string | null): Promise<SessionsRead> {
  const ids = new Set<string>()
  if (!home) return { ids, isComplete: false }
  const dir = `${home}/sessions`
  let entries: { name: string; kind: string; size: number; isLink?: boolean }[]
  try {
    entries = (await $.fs.list(dir)) as typeof entries
  } catch {
    return { ids, isComplete: false }
  }
  const named = entries.filter(e => SESSION_FILE.test(e.name))
  const files = named.filter(e => e.kind === 'file' && e.isLink !== true)
  // Un `<chiffres>.json` qui est un lien ou pas un fichier ordinaire ne s'ouvre pas, et rend la lecture incomplète (P4) ;
  // au-delà de `SESSIONS_MAX` fichiers retenus aussi, les premiers dans l'ordre des noms lus seuls : les discussions
  // trouvées restent vivantes.
  let isComplete = files.length === named.length && files.length <= SESSIONS_MAX
  const kept = [...files].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)).slice(0, SESSIONS_MAX)
  for (const f of kept) {
    if (f.size > LIVENESS_FILE_MAX) {
      isComplete = false
      continue
    }
    const raw = await readSmallJson($, `${dir}/${f.name}`)
    if (raw && isSafeId(raw.sessionId)) ids.add(raw.sessionId)
    else isComplete = false
  }
  return { ids, isComplete }
}

/** Le `state.json` du dossier de job `name` (contrôlé dans sa forme), réduit à ce que lit le verdict ; sinon `null`. */
async function readJobDir($: any, home: string, name: string): Promise<JobRead | null> {
  if (!JOB_DIR.test(name)) return null
  // Le dossier lui-même, pas un lien vers un dossier ailleurs (comme dans la recherche de `readJobOf`).
  try {
    const st = (await $.fs.stat(`${home}/jobs/${name}`)) as { kind?: string; isLink?: boolean }
    if (st.isLink || st.kind !== 'dir') return null
  } catch {
    return null
  }
  const raw = await readSmallJson($, `${home}/jobs/${name}/state.json`)
  if (!raw) return null
  const updatedAt = typeof raw.updatedAt === 'string' ? Date.parse(raw.updatedAt) : NaN
  if (!Number.isFinite(updatedAt)) return null
  const id = (k: string): string | undefined => (isSafeId(raw[k]) ? (raw[k] as string) : undefined)
  const sessionId = id('sessionId')
  const resumeSessionId = id('resumeSessionId')
  return { ...(sessionId !== undefined ? { sessionId } : {}), ...(resumeSessionId !== undefined ? { resumeSessionId } : {}), updatedAt }
}

/**
 * Le job d'arrière-plan de la discussion `id` (P3) : seul un id au format d'un UUID en a un. D'abord le dossier nommé
 * par ses 8 premiers signes, quand son `sessionId` ou son `resumeSessionId` vaut l'id ; sinon, parmi les dossiers de
 * `jobs/` nommés de 8 signes hexadécimaux, `JOBS_MAX` au plus, le premier (dans l'ordre des noms) dont le
 * `resumeSessionId` vaut l'id (une mission reprise après un `/clear`). Aucun, ou trop de dossiers : `null`. Ne passe pas
 * par le cache de `readJob` (`register.tsx`), qui garde un job fini.
 */
export async function readJobOf($: any, home: string | null, id: string): Promise<JobRead | null> {
  if (!home || !UUID.test(id)) return null
  const prefix = id.slice(0, 8)
  const own = await readJobDir($, home, prefix)
  if (own && isJobOf(own, id)) return own
  let entries: { name: string; kind: string; isLink?: boolean }[]
  try {
    entries = (await $.fs.list(`${home}/jobs`)) as typeof entries
  } catch {
    return null
  }
  const dirs = entries.filter(e => e.kind === 'dir' && e.isLink !== true && JOB_DIR.test(e.name)).map(e => e.name)
  if (dirs.length > JOBS_MAX) return null
  for (const name of dirs.sort()) {
    if (name === prefix) continue
    const job = await readJobDir($, home, name)
    if (job && job.resumeSessionId === id) return job
  }
  return null
}

/**
 * Les verdicts de plusieurs discussions lus à l'instant, dans l'ordre de `asked` (le titulaire d'une mission et sa
 * prise) : le dossier des sessions une seule fois pour toutes, puis le job de chaque discussion qui n'y est pas.
 * Ne lève jamais : une lecture ratée rend la lecture des sessions incomplète (`readSessions`) ou laisse une discussion
 * sans job (`readJobOf`), et une erreur imprévue rend « inconnu » pour toutes.
 */
export async function readVerdicts($: any, home: string | null, asked: readonly { owner: string; claim: unknown }[], now: number): Promise<Liveness[]> {
  try {
    const sessions = await readSessions($, home)
    const out: Liveness[] = []
    for (const a of asked) out.push(sessions.ids.has(a.owner) ? 'alive' : livenessVerdict(a.owner, sessions, await readJobOf($, home, a.owner), a.claim, now))
    return out
  } catch {
    return asked.map(() => 'unknown')
  }
}

/**
 * Le verdict du titulaire de la mission `run` (`Run.owner`, avec sa prise `Run.claim`), lu à l'instant pour la réponse
 * faite à un worker (`managerReachOf`) : « inconnu » sans mission ou sans titulaire, et alors rien n'est lu. Ne lève
 * jamais, n'écrit rien.
 */
export async function ownerVerdictOf($: any, home: string | null, run: { owner?: unknown; claim?: unknown } | undefined, now: number): Promise<Liveness> {
  if (!run || typeof run.owner !== 'string' || run.owner === '') return 'unknown'
  return (await readVerdicts($, home, [{ owner: run.owner, claim: run.claim }], now))[0] ?? 'unknown'
}

/** La prise qui tient lieu de celle d'une mission pour la référence gardée d'un worker (`workerRefVerdicts`). */
const REF_CLAIM_BOOT = 'worker-ref'

/**
 * Les verdicts des sessions de workers dont le manager donne la référence gardée (`workerRefSessions` de relay.ts), par
 * id de session : la date où la référence a été notée tient lieu de prise, si bien que « arrêtée » dit qu'aucun processus
 * ne porte cet id et que son job a été mis à jour depuis ; vivante ou inconnu sinon (une session de l'app n'a pas de job).
 * Ne lève jamais, n'écrit rien.
 */
export async function workerRefVerdicts($: any, home: string | null, asked: readonly { session: string; at: number }[], now: number): Promise<Map<string, Liveness>> {
  // Aucune référence gardée : rien à lire (pas de liste du dossier des sessions à chaque appel du manager).
  if (asked.length === 0) return new Map()
  const verdicts = await readVerdicts($, home, asked.map(a => ({ owner: a.session, claim: { boot: REF_CLAIM_BOOT, at: a.at } })), now)
  return new Map(asked.map((a, i) => [a.session, verdicts[i] ?? 'unknown']))
}
