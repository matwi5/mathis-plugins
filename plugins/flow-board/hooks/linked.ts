// Sessions liées de l'onglet Agents : qui l'orchestrateur a lancé, et où sont leurs registres.
// Fonctions pures ; la lecture des fichiers vit dans register.tsx.
//
// - Avec un parcours, une session liée se reconnaît sûrement : son fichier déclare le parcours
//   (appel `delegate`), et le relais la connaît par son id.
// - Sans parcours, par son lancement : l'id court de `claude --bg` est le début de son id de
//   session, que `~/.claude/jobs/<id court>/state.json` donne aussi en entier (essai 01, point 12) ;
//   pour `start_session` (`local_…`), l'id d'abord, sinon le titre en repli, encore à confirmer.
// - Reconnue par son titre seul, une session est montrée mais jamais effacée avec l'orchestrateur (S15).

import type { LinkedLaunch, Relay, SessionRegistry } from '../types'

/** Ce qu'on sait d'une session liée par son lancement dans `claude --bg` (`state.json` de son job). */
export type JobInfo = { sessionId?: string; name?: string; state?: string; updatedAt?: number }

/** Comment une session liée a été reconnue ; `title` seul n'est pas sûr (S15). */
export type LinkHow = 'run' | 'relay' | 'id' | 'job' | 'title' | 'none'

export type LinkedState = 'working' | 'returned' | 'failed' | 'closed'

export type LinkedSession = {
  /**
   * Sa clé, stable d'une relecture à l'autre (la sélection de sa pastille y tient) : l'id de son
   * lancement quand cette discussion l'a lancée, sinon son id de session.
   */
  key: string
  /** Id de session de son registre, quand il est trouvé. */
  session?: string
  title: string
  how: LinkHow
  state: LinkedState
  launchedAt?: number
  /** Quand elle a rendu son compte rendu (relais) ou fini (job). */
  returnedAt?: number
}

/** Une reconnaissance sûre : celle qui permet d'effacer une session liée avec son orchestrateur (S15). */
export const isSureLink = (how: LinkHow): boolean => how === 'run' || how === 'relay' || how === 'id' || how === 'job'

/** Sans signe de vie depuis plus longtemps, une session liée sans fin connue est tenue pour fermée. */
export const LINKED_STALE_MS = 30 * 60_000

const norm = (title: string): string => title.toLowerCase().replace(/\s+/g, ' ').replace(/[·›»>"']/g, '').trim()

/**
 * Le séparateur entre le titre du parcours et celui de la session liée : « > », en ASCII, depuis
 * que l'app affiche « ' » à la place de « › » (décision de la rétro du parcours « Frise, groupes et
 * titres »). Les anciens titres se lisent encore : « › », sa forme déformée par une page de code
 * (« â€º »), et « ' » entre deux espaces (une apostrophe n'en a pas).
 */
export const TITLE_SEPARATOR = '>'
const SEPARATORS = /›|â€º| > | ' /g

/** Vrai si le titre porte un séparateur de session liée, nouveau ou ancien. */
export const hasSeparator = (title: string): boolean => new RegExp(SEPARATORS.source).test(title)

/** La partie d'un titre de session liée après son dernier séparateur ; le titre entier sans séparateur. */
export const ownPart = (title: string): string => {
  let end = -1
  for (const m of title.matchAll(SEPARATORS)) end = m.index! + m[0].length
  return end >= 0 ? title.slice(end) : title
}

/** Le titre court d'une session : « Groupe A · … » plutôt que le nom du parcours qui le précède. */
const shortTitle = (title: string): string => ownPart(title).trim() || title.trim()

export type LinkInput = {
  /** Le registre de cette session (l'orchestrateur) : ses lancements dans `linked`. */
  self: SessionRegistry
  /** Le parcours actif ici, s'il y en a un. */
  run?: string
  /** Le relais de ce parcours : une entrée par session liée, par son id. */
  relay?: Relay | null
  /** Les registres des autres sessions du dossier (en-têtes au moins). */
  others: readonly SessionRegistry[]
  /** Les jobs de `claude --bg`, par id court. */
  jobs?: Readonly<Record<string, JobInfo>>
  now: number
}

/** Un id de lancement assez long pour reconnaître une session par le début de son id : pas moins de 8 caractères. */
const ID_MIN = 8

/** La lettre du groupe qu'un titre de lancement nomme (« … > Groupe B · … »). */
const groupOf = (title: string | undefined): string | undefined => /\bgroupe\s+([a-z0-9]+)\b/i.exec(title ?? '')?.[1]?.toUpperCase()

/**
 * La racine du projet, ou un de ses worktrees (`<racine>/.claude/worktrees/<nom>`, un nom de
 * worktree pouvant avoir des « / »), et rien d'autre sous elle (F6) : le repli par titre (S17) et
 * l'historique s'y tiennent.
 */
export const isSameProject = (root: string, other: string): boolean => {
  const norm = (r: string) => r.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (root === '') return false
  const mine = norm(root)
  const theirs = norm(other)
  return theirs === mine || /^\.claude\/worktrees\/[^/]/.test(theirs.startsWith(`${mine}/`) ? theirs.slice(mine.length + 1) : '')
}

/**
 * Le titre d'une session reconnue par son parcours : la fin de son titre de discussion
 * (« … > Groupe A · Synchro ») ; sans elle, son groupe, car son titre de repli est celui du parcours.
 */
const runTitle = (o: SessionRegistry): string =>
  o.title !== undefined && hasSeparator(o.title) ? shortTitle(o.title) : o.group ? `Groupe ${o.group}` : shortTitle(o.title ?? o.session.slice(0, 8))

/**
 * Les sessions liées de l'orchestrateur, dans l'ordre de lancement : celles que son parcours
 * déclare (fichier, relais), puis celles qu'il a lancées, reconnues par id, job, groupe ou titre.
 */
export const linkedSessions = (input: LinkInput): LinkedSession[] => {
  const { self, run, relay, others, jobs = {}, now } = input
  const bySession = new Map(others.filter(o => o.session !== self.session).map(o => [o.session, o]))
  const sessions = relay && relay.run === run && relay.sessions !== null && typeof relay.sessions === 'object' ? relay.sessions : {}
  // Par id de session quand il est connu, sinon par id de lancement.
  const found = new Map<string, Omit<LinkedSession, 'state'>>()
  const add = (id: string, s: Omit<LinkedSession, 'key' | 'state'>, launch?: string) => {
    const was = found.get(id)
    // Une reconnaissance sûre l'emporte sur le titre ; le lancement donne la clé, le titre et l'heure.
    const how = was && (isSureLink(was.how) || s.how === 'none') ? was.how : s.how
    const key = launch ?? was?.key ?? id
    const launchedAt = launch !== undefined ? s.launchedAt : (was?.launchedAt ?? s.launchedAt)
    const title = launch !== undefined && s.title !== '' ? s.title : (was?.title ?? s.title)
    found.set(id, { ...was, ...s, how, key, title, ...(launchedAt !== undefined ? { launchedAt } : {}) })
  }
  if (run !== undefined) {
    for (const o of bySession.values()) if (o.run === run) add(o.session, { session: o.session, title: runTitle(o), how: 'run' })
    for (const id of Object.keys(sessions)) {
      if (id === self.session) continue
      const o = bySession.get(id)
      const entry = sessions[id]!
      // Sans lancement relevé ici, son départ est le premier signal du relais.
      add(id, { ...(o ? { session: id } : {}), title: o ? runTitle(o) : entry.group ? `Groupe ${entry.group}` : id.slice(0, 8), how: 'relay', launchedAt: entry.startedAt })
    }
  }
  for (const l of self.linked ?? []) {
    const short = l.id.replace(/^local_/, '')
    const job = jobs[l.id]
    const byId = short.length >= ID_MIN ? [...bySession.values()].find(o => o.session === short || o.session.startsWith(short)) : undefined
    const byJob = job?.sessionId !== undefined ? bySession.get(job.sessionId) : undefined
    // Le groupe que nomme son titre, parmi les sessions que le parcours déclare déjà : la même session.
    const group = run !== undefined ? groupOf(l.title) : undefined
    const byGroup = group !== undefined ? [...found.entries()].find(([id]) => bySession.get(id)?.group === group || sessions[id]?.group === group)?.[0] : undefined
    const byTitle =
      l.title !== undefined && l.title !== ''
        ? [...bySession.values()].filter(o => o.title !== undefined && norm(o.title) === norm(l.title!) && isSameProject(self.root, o.root))
        : []
    const match = byId ?? byJob ?? (byGroup === undefined && byTitle.length === 1 ? byTitle[0] : undefined)
    const how: LinkHow = byId ? 'id' : byJob ? 'job' : match || byGroup !== undefined ? 'title' : 'none'
    const id = match?.session ?? byGroup ?? job?.sessionId ?? l.id
    const session = match?.session ?? (byGroup !== undefined && bySession.has(byGroup) ? byGroup : undefined)
    add(id, { ...(session !== undefined ? { session } : {}), title: shortTitle(l.title || job?.name || match?.title || l.id), how, launchedAt: l.at }, l.id)
  }
  return [...found.entries()]
    .map(([id, s]) => ({ ...s, ...stateOf(id, s, bySession.get(s.session ?? id), sessions, jobs, self.linked ?? [], now) }))
    .sort((a, b) => (a.launchedAt ?? Infinity) - (b.launchedAt ?? Infinity))
}

/** Un job encore vivant : au travail, ou bloqué sur une autorisation. */
const LIVE_JOB = /working|running|blocked|waiting|idle/i

/**
 * L'état d'une session liée : rendue (compte rendu), échouée, fermée, sinon au travail. `id` :
 * son id de session quand il est connu (relais, job), sinon celui de son lancement.
 */
const stateOf = (
  id: string,
  s: Omit<LinkedSession, 'state'>,
  reg: SessionRegistry | undefined,
  sessions: Relay['sessions'],
  jobs: Readonly<Record<string, JobInfo>>,
  launches: readonly LinkedLaunch[],
  now: number,
): Pick<LinkedSession, 'state' | 'returnedAt'> => {
  const entry = sessions[s.session ?? id]
  const launch = launches.find(l => l.id === s.key)
  const job = launch ? jobs[launch.id] : Object.values(jobs).find(j => j.sessionId !== undefined && j.sessionId === (s.session ?? id))
  if (entry?.report) return { state: 'returned', returnedAt: entry.report.at }
  if (job?.state !== undefined && /fail|error|crash/i.test(job.state)) return { state: 'failed', ...(job.updatedAt !== undefined ? { returnedAt: job.updatedAt } : {}) }
  if (entry?.endedAt !== undefined) {
    const isOpen = Object.values(entry.tickets ?? {}).some(t => t.status !== 'done')
    return { state: isOpen ? 'failed' : 'closed', returnedAt: entry.endedAt }
  }
  if (job?.state !== undefined && /done|finished|exited|stopped/i.test(job.state)) return { state: 'closed', ...(job.updatedAt !== undefined ? { returnedAt: job.updatedAt } : {}) }
  if (job?.state !== undefined && LIVE_JOB.test(job.state)) return { state: 'working' }
  const lastSign = Math.max(reg?.updatedAt ?? 0, entry?.at ?? 0, job?.updatedAt ?? 0, s.launchedAt ?? 0)
  const isBusy = (reg?.agents ?? []).some(a => a.status === 'running')
  return { state: !isBusy && now - lastSign > LINKED_STALE_MS ? 'closed' : 'working' }
}
