// Données pures du panneau Git : palette, analyse des sorties git et gh, étape suggérée,
// libellés. Aucun appel au moteur ici : tout ce qui touche `$` vit dans register.tsx.

import type { Action, CiWatch, FlowBoardSeen, Form, GitBranch, GitCommit, GitFile, GitRemoteBranch, GitRepo, Meta, PrChecks, PrState, PullRequest, Running } from '../types'

// Couleurs brutes (hex) mi-tons, copiées de flow-board (hooks/catalog.ts) : lisibles en thème
// clair comme sombre, sur le terminal comme sur le desktop.
export const C = {
  violet: '#9B7BEA',
  lilac: '#B79BF5',
  blue: '#4A9EE8',
  cyan: '#2EB8C9',
  teal: '#3FB68B',
  tangerine: '#E8913A',
  coral: '#EF7D57',
  amber: '#D9A520',
  green: '#4CB782',
  red: '#E5534B',
  pink: '#E06C9F',
  magenta: '#C36BD9',
  indigo: '#7C83F2',
  sky: '#56B4E9',
  sand: '#C9A66B',
  slate: '#7F8EA3',
  gray: '#8B8B93',
  /** Texte foncé posé sur un aplat de couleur. */
  ink: '#17171C',
} as const

// L'app desktop fond les espaces ordinaires : les écarts dans un texte sont insécables.
// NB contient une espace insécable U+00A0 littérale (invisible) : ne pas la remplacer.
export const NB = ' '
export const SEP = `${NB}${NB}·${NB}${NB}`

// Rôles figés de la palette : cyan pour la sync et le distant (pull, push).
export const ACTION_COLOR: Record<Action, string> = { commit: C.green, pull: C.cyan, push: C.cyan, pr: C.violet }
export const OPERATION: Record<string, string> = { rebase: 'Rebase', merge: 'Merge', 'cherry-pick': 'Cherry-pick', revert: 'Revert' }
export const MAX_FILES = 80
export const MAX_COMMITS = 25

export const REF_FORMAT = '%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(subject)%00%(worktreepath)'
export const LOG_FORMAT = '%H%x00%h%x00%an%x00%ct%x00%D%x00%s'
export const PR_FIELDS = 'number,title,url,state,isDraft,baseRefName,headRefOid,reviewDecision,statusCheckRollup'

export type Run = { exitCode: number; stdout: string; stderr: string }
export type LoadOptions = { fetch?: boolean; pr?: boolean; say?: boolean }

type StatusFile = Omit<GitFile, 'added' | 'removed'>

// `git status --porcelain=v2 --branch --show-stash -z` : en-têtes `# …`, puis une entrée
// par fichier (1 ordinaire, 2 renommé suivi de l'ancien chemin, u conflit, ? non suivi).
export function parseStatus(out: string) {
  const s = { oid: null as string | null, branch: null as string | null, upstream: null as string | null, ahead: 0, behind: 0, stash: 0, files: [] as StatusFile[] }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i] ?? ''
    if (!rec) continue
    if (rec.startsWith('# ')) {
      const [key, ...rest] = rec.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') s.oid = value === '(initial)' ? null : value
      else if (key === 'branch.head') s.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') s.upstream = value
      else if (key === 'branch.ab') {
        const ab = value.match(/\+(\d+) -(\d+)/)
        if (ab) {
          s.ahead = Number(ab[1])
          s.behind = Number(ab[2])
        }
      } else if (key === 'stash') s.stash = Number(value) || 0
      continue
    }
    const f = rec.split(' ')
    const xy = f[1] ?? '..'
    const index = xy[0] ?? '.'
    const work = xy[1] ?? '.'
    if (rec[0] === '1') s.files.push({ path: f.slice(8).join(' '), from: null, index, work, kind: 'changed' })
    else if (rec[0] === '2') s.files.push({ path: f.slice(9).join(' '), from: parts[++i] ?? null, index, work, kind: 'changed' })
    else if (rec[0] === 'u') s.files.push({ path: f.slice(10).join(' '), from: null, index, work, kind: 'conflict' })
    else if (rec[0] === '?') s.files.push({ path: rec.slice(2), from: null, index: '?', work: '?', kind: 'untracked' })
  }
  return s
}

// `git diff HEAD --numstat -z` : « ajouts\tretraits\tchemin », ou pour un renommage
// « ajouts\tretraits\t » suivi de l'ancien puis du nouveau chemin ; `-` pour un binaire.
export function parseNumstat(out: string) {
  const map = new Map<string, [number | null, number | null]>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec) continue
    const [a, d, p] = rec.split('\t')
    let path = p
    if (p === '') {
      i += 2
      path = parts[i]
    }
    if (!path) continue
    map.set(path, [a === '-' || a === undefined ? null : Number(a), d === '-' || d === undefined ? null : Number(d)])
  }
  return map
}

export function parseRefs(out: string) {
  const locals: GitBranch[] = []
  const all: GitRemoteBranch[] = []
  for (const row of out.split('\n')) {
    if (!row) continue
    const [ref = '', head = '', upstream = '', track = '', date = '0', subject = '', worktree = ''] = row.split('\0')
    if (ref.startsWith('refs/heads/')) {
      locals.push({
        name: ref.slice('refs/heads/'.length),
        isCurrent: head === '*',
        upstream: upstream || null,
        ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
        behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
        isGone: track === 'gone',
        worktree: head !== '*' && worktree ? worktree : null,
        date: Number(date) * 1000,
        subject,
      })
    } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      const name = ref.slice('refs/remotes/'.length)
      all.push({ name, local: localOf(name), date: Number(date) * 1000, subject })
    }
  }
  // La branche courante d'abord, puis les plus récentes.
  locals.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
  const names = new Set(locals.map((b) => b.name))
  const followed = new Set(locals.map((b) => b.upstream))
  return {
    locals,
    remotes: all.filter((b) => !names.has(b.local) && !followed.has(b.name)),
    remoteNames: new Set(all.map((b) => b.name)),
  }
}

export function parseLog(out: string, notPushed: Set<string>, hasRemote: boolean): GitCommit[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [hash = '', short = '', author = '', date = '0', refs = '', subject = ''] = row.split('\0')
      return { hash, short, author, date: Number(date) * 1000, refs, subject, isPushed: hasRemote && !notPushed.has(hash) }
    })
}

// « remote.origin.url https://… » → origin ↦ https://…
export function parseRemoteUrls(out: string) {
  const map = new Map<string, string>()
  for (const row of out.split('\n')) {
    const hit = row.trim().match(/^remote\.(.+)\.url\s+(.+)$/)
    if (hit && hit[1] && hit[2]) map.set(hit[1], hit[2])
  }
  return map
}

// Branche par défaut, dans l'ordre de reference/git.md du plugin project : origin/HEAD,
// sinon origin/main ou origin/master, sinon main ou master en local.
export function defaultOf(originHead: Run, locals: GitBranch[], remoteNames: Set<string>) {
  if (originHead.exitCode === 0 && originHead.stdout.trim()) return originHead.stdout.trim().replace(/^origin\//, '')
  for (const name of ['main', 'master']) if (remoteNames.has(`origin/${name}`)) return name
  for (const name of ['main', 'master']) if (locals.some((b) => b.name === name)) return name
  return null
}

// Adresse web d'un distant GitHub (https, ssh ou scp), sans identifiants.
export function githubUrl(url: string) {
  const hit = url.trim().match(/^(?:(?:https?|ssh):\/\/)?(?:[^@/]+@)?github\.com[:/](.+?)(?:\.git)?\/?$/i)
  return hit && hit[1] && /^[\w.-]+\/[\w.-]+$/.test(hit[1]) ? `https://github.com/${hit[1]}` : null
}

// Les vérifications GitHub : CheckRun (status, conclusion) et StatusContext (state).
// Le nom du premier check en échec est gardé pour le suivi de la CI. Un check annulé dont un
// homonyme (même workflow, même nom) n'est pas annulé a été remplacé, par exemple par
// `concurrency: cancel-in-progress` : il ne compte pas.
export function checksOf(list: any[]): PrChecks {
  const out: PrChecks = { passed: 0, failed: 0, pending: 0, firstFailed: null }
  const keyOf = (c: any) => `${c.workflowName ?? ''}\u0000${c.name || c.context || ''}`
  const isCancelled = (c: any) => String(c.conclusion || c.state || '').toUpperCase() === 'CANCELLED'
  const live = new Set(list.filter((c) => !isCancelled(c)).map(keyOf))
  for (const c of list) {
    if (isCancelled(c) && live.has(keyOf(c))) continue
    const verdict = String(c.conclusion || c.state || '').toUpperCase()
    if (c.status && String(c.status).toUpperCase() !== 'COMPLETED') out.pending += 1
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(verdict)) out.passed += 1
    else if (['', 'PENDING', 'EXPECTED'].includes(verdict)) out.pending += 1
    else {
      out.failed += 1
      if (!out.firstFailed) out.firstFailed = String(c.name || c.context || c.workflowName || '') || null
    }
  }
  return out
}

// ─── Suivi de la CI après un push ───────────────────────────────────────────

/** Relecture des checks pendant le suivi. */
export const CI_EVERY_MS = 25_000
/** Plafond du suivi : au-delà, il s'arrête sur « CI encore en cours ». */
export const CI_CAP_MS = 20 * 60_000
/** Toujours aucun check au bout de ce délai : le dépôt n'a pas de CI pour ce commit. */
export const CI_WAIT_MS = 3 * 60_000
export const RUN_FIELDS = 'status,conclusion,name,url'

/**
 * `gh run list --commit <sha> --json status,conclusion,name,url` : les exécutions GitHub
 * Actions du commit, au même format de comptes que les checks d'une PR (minuscules ici).
 * Lève une erreur sur un JSON illisible.
 */
export function runsOf(stdout: string): PrChecks {
  const list = JSON.parse(stdout)
  return checksOf(Array.isArray(list) ? list : [])
}

/** Où en est la CI, d'après les checks lus et le temps écoulé depuis le push. */
export function ciPhaseOf(c: PrChecks, elapsedMs: number): NonNullable<CiWatch>['phase'] {
  const total = c.passed + c.failed + c.pending
  if (total === 0) return elapsedMs >= CI_WAIT_MS ? 'none' : 'waiting'
  if (c.pending > 0) return elapsedMs >= CI_CAP_MS ? 'timeout' : 'running'
  return c.failed > 0 ? 'failed' : 'passed'
}

export function isCiActive(w: CiWatch) {
  return w !== null && (w.phase === 'waiting' || w.phase === 'running')
}

/** Le suivi de la CI à afficher : seulement celui de la branche et du commit en tête. */
export function ciOf(r: GitRepo, w: CiWatch): NonNullable<CiWatch> | null {
  if (!w || w.root !== r.root || w.branch !== r.branch || (r.oid !== null && r.oid !== w.sha)) return null
  return w
}

/**
 * L'état de la CI en un mot : en attente (rien encore lancé), en cours (finis/total),
 * réussie, échouée (premier check en échec), ou aucun check. `isShort` pour le bandeau.
 */
export function ciText(w: NonNullable<CiWatch>, isShort = false): [string, string] {
  const c = w.checks
  const total = c.passed + c.failed + c.pending
  if (w.phase === 'waiting') return [isShort ? `◌${NB}CI` : `◌${NB}CI${NB}en${NB}attente`, C.amber]
  if (w.phase === 'running') return [`◌${NB}CI${NB}${total - c.pending}/${total}`, C.amber]
  if (w.phase === 'timeout') return [isShort ? `◌${NB}CI${NB}?` : `◌${NB}CI${NB}encore${NB}en${NB}cours${NB}(suivi${NB}arrêté)`, C.amber]
  if (w.phase === 'none') return [`aucun${NB}check`, C.gray]
  if (w.phase === 'failed') {
    const name = c.firstFailed ? `${isShort ? NB : `${NB}:${NB}`}${c.firstFailed}` : ''
    return [`✗${NB}CI${isShort ? '' : `${NB}échouée`}${name}`, C.red]
  }
  return [isShort ? `✓${NB}CI` : `✓${NB}CI${NB}réussie`, C.green]
}

/**
 * La réponse JSON de `gh pr view` ; lève une erreur sur un JSON illisible ou incomplet
 * (relevée par `refresh`, après l'écriture du dépôt). Sans numéro ni adresse, la PR ne
 * peut pas se dessiner : un lien sans `href` ferait refuser tout le panneau.
 */
export function prOf(branch: string, stdout: string): PrState {
  const d = JSON.parse(stdout)
  if (typeof d?.number !== 'number' || typeof d?.url !== 'string' || !/^https:\/\//.test(d.url)) {
    throw new Error('gh : réponse incomplète (numéro ou adresse de la PR absents).')
  }
  return {
    branch,
    pr: {
      number: d.number,
      title: d.title ?? '',
      url: d.url,
      state: d.state,
      isDraft: Boolean(d.isDraft),
      base: d.baseRefName ?? '',
      head: typeof d.headRefOid === 'string' && d.headRefOid ? d.headRefOid : null,
      review: d.reviewDecision || null,
      checks: checksOf(d.statusCheckRollup ?? []),
    },
    error: null,
  }
}

export function commandFor(a: Action, r: GitRepo, f: Form) {
  if (a === 'commit') return { name: 'commit', args: f.hint.trim() }
  // Le pull suit la branche distante ; l'intégration de la base a son propre bouton (SYNC_BASE).
  if (a === 'pull') return { name: 'sync', args: '' }
  if (a === 'push') return { name: 'push', args: '' }
  // La base choisie, si elle existe encore ; la branche par défaut se passe d'argument.
  const base = f.prBase && f.prBase !== r.defaultBranch && f.prBase !== r.branch && r.branches.some((b) => b.name === f.prBase) ? f.prBase : ''
  return { name: 'pr', args: [base, f.prDraft ? '--draft' : '', f.prAuto ? '--auto' : ''].filter(Boolean).join(' ') }
}

/** « ▶ Intégrer <branche par défaut> » du tiroir Pull : intègre origin/<défaut> dans la branche. */
export const SYNC_BASE = { name: 'sync', args: 'base' }

/** Une base à intégrer : sur une branche autre que la branche par défaut. */
export function canSyncBase(r: GitRepo) {
  return Boolean(r.defaultBranch && r.branch && r.branch !== r.defaultBranch)
}

/** Suggérée avant le push : le numéro de version et le CHANGELOG partent avec les commits. */
export const VERSION_COMMAND = '/project:version'

export function slash(c: { name: string; args: string }) {
  return `/project:${c.name}${c.args ? ` ${c.args}` : ''}`
}

/**
 * Une branche sans distante (hors branche par défaut) : vide (aucun commit depuis sa
 * création), déjà fusionnée dans la branche par défaut locale, à y fusionner depuis un
 * worktree lié (elle ne s'y pousse jamais), ou non publiée. null pour la branche par
 * défaut, une branche suivie ou une HEAD détachée.
 */
export function localState(r: GitRepo): 'empty' | 'merged' | 'toMerge' | 'unpublished' | null {
  if (r.upstream || !r.branch || r.branch === r.defaultBranch) return null
  if (r.toMerge === 0) return r.isFresh ? 'empty' : 'merged'
  return r.isLinkedWorktree && r.toMerge !== null ? 'toMerge' : 'unpublished'
}

/**
 * `git reflog show --format=%H%x00%gs refs/heads/<branche>` (du plus récent au plus ancien) :
 * la branche n'a encore aucun commit à elle. Son entrée la plus ancienne est sa création, et
 * elle n'a bougé depuis que par des mouvements qui ne créent pas de commit (fast-forward,
 * reset). Toute autre entrée, ou un reflog illisible, laisse « fusionnée ».
 */
export function isFreshReflog(out: string) {
  const subjects = out.split('\n').filter(Boolean).map((row) => row.split('\0')[1] ?? '')
  const created = subjects.pop()
  if (!created?.startsWith('branch: Created from ')) return false
  return subjects.every((x) => /^(merge|pull)\b[^:]*: Fast-forward$/.test(x) || x.startsWith('reset: moving to '))
}

/** L'étape logique suivante ; rien pendant une opération ou un conflit. */
export function suggest(r: GitRepo, p: PrState): Action | null {
  if (r.operation || r.files.some((x) => x.kind === 'conflict')) return null
  if (r.files.length) return 'commit'
  if (r.behind) return 'pull'
  if (r.hasRemote && (r.ahead || localState(r) === 'unpublished')) return 'push'
  if (r.webUrl && r.branch && r.branch !== r.defaultBranch && r.upstream && p && p.branch === r.branch && !p.error && !prOfBranch(r, p)) return 'pr'
  return null
}

/**
 * Le bouton de l'étape suivante du bandeau : l'étape suggérée, que le bandeau lance comme
 * « ▶ Lancer » du tiroir. Rien quand une commande /project est en file ou en cours (pas de
 * double lancement), ni hors du dossier de la session, où les commandes /project n'agissent pas.
 * Pendant un parcours flow-board, ni Push ni PR : un seul envoi, en fin de parcours.
 */
export function bandNext(r: GitRepo, p: PrState, m: Meta, run: Running, isFlowActive: boolean): Action | null {
  if (run || m.sessionRoot === null || !sameDir(m.sessionRoot, r.root)) return null
  const lead = suggest(r, p)
  return isFlowActive && (lead === 'push' || lead === 'pr') ? null : lead
}

/**
 * Un parcours flow-board est actif dans la discussion : même règle que flow-board (un parcours
 * de ce board, désigné actif, au statut actif). La valeur appartient à un autre plugin : sa
 * forme est vérifiée avant usage.
 */
export function isFlowActive(board: FlowBoardSeen | undefined): boolean {
  if (!board || typeof board.activeId !== 'string' || !Array.isArray(board.runs)) return false
  return board.runs.some((run) => run?.id === board.activeId && run?.status === 'active')
}

/** Libellé du bouton de l'étape suivante du bandeau, sans la commande. */
export const NEXT_LABEL: Record<Action, string> = { commit: 'Commit', pull: 'Pull', push: 'Push', pr: 'PR' }

/** La ligne d'état (relais du bandeau masqué). */
export function statusText(r: GitRepo) {
  const parts = [`⎇ ${branchLabel(r)}`]
  if (r.ahead) parts.push(`↑${r.ahead}`)
  if (r.behind) parts.push(`↓${r.behind}`)
  const text = parts.join(' ')
  return r.files.length ? `${text} · ${r.files.length} modif.` : text
}

export function branchLabel(r: GitRepo) {
  return r.branch ?? `HEAD détachée (${r.head ?? '?'})`
}

/** Comptes des fichiers : conflits, suivis modifiés, non suivis, et le total des lignes. */
export function countsOf(r: GitRepo) {
  const conflicts = r.files.filter((x) => x.kind === 'conflict').length
  const fresh = r.files.filter((x) => x.kind === 'untracked').length
  const added = r.files.reduce((n, x) => n + (x.added ?? 0), 0)
  const removed = r.files.reduce((n, x) => n + (x.removed ?? 0), 0)
  return { conflicts, fresh, changed: r.files.length - conflicts - fresh, added, removed }
}

/**
 * La PR de la branche courante seulement. `gh pr view <branche>` rend la dernière PR de la
 * branche, même fusionnée ou fermée : une branche réutilisée après une fusion (dev, par
 * exemple) garderait l'ancienne PR et sa route toute faite. Une PR fusionnée ou fermée ne
 * compte que tant que HEAD est encore sa tête ; au-delà, les nouveaux commits n'en ont pas.
 */
export function prOfBranch(r: GitRepo, p: PrState): PullRequest | null {
  if (!p || p.branch !== (r.branch ?? '') || !p.pr) return null
  const pr = p.pr
  if (pr.state !== 'OPEN' && pr.head && r.head && pr.head.slice(0, r.head.length) !== r.head) return null
  return pr
}

export function glyphOf(f: GitFile) {
  // Mêmes glyphes et couleurs que les groupes, les pastilles et le bandeau.
  if (f.kind === 'conflict') return { letter: '✖', color: C.red }
  if (f.kind === 'untracked') return { letter: '+', color: C.teal }
  const x = f.work !== '.' ? f.work : f.index
  return { letter: x, color: x === 'A' ? C.green : x === 'D' ? C.red : x === 'R' || x === 'C' ? C.blue : C.amber }
}

export function prLabel(p: PullRequest) {
  if (p.state === 'MERGED') return 'Fusionnée'
  if (p.state === 'CLOSED') return 'Fermée'
  return p.isDraft ? 'Brouillon' : 'Ouverte'
}

export function prColor(p: PullRequest) {
  if (p.state === 'MERGED') return C.violet
  if (p.state === 'CLOSED') return C.red
  return p.isDraft ? C.gray : C.green
}

export function reviewOf(review: string | null): [string, string] | null {
  if (review === 'APPROVED') return ['approuvée', C.green]
  if (review === 'CHANGES_REQUESTED') return ['modifications demandées', C.red]
  if (review === 'REVIEW_REQUIRED') return ['relecture attendue', C.gray]
  return null
}

export function checksText(c: PrChecks): [string, string][] {
  return [
    c.passed ? ([`✓${NB}${c.passed}`, C.green] as [string, string]) : null,
    c.failed ? ([`✗${NB}${c.failed}`, C.red] as [string, string]) : null,
    c.pending ? ([`◌${NB}${c.pending}`, C.amber] as [string, string]) : null,
  ].filter((x): x is [string, string] => x !== null)
}

/**
 * « fetch il y a 4 min », « fetch en échec », ou « fetch jamais » quand ni la session ni
 * `FETCH_HEAD` ne donnent d'âge : « ✓ à jour » ne vaut que ce que vaut le dernier fetch.
 * Rien sans distant (il n'y a rien à récupérer).
 */
export function fetchedText(m: Meta, now: number, hasRemote: boolean): { text: string; isError: boolean } | null {
  if (m.fetchError) return { text: `fetch${NB}en${NB}échec`, isError: true }
  if (m.fetchedAt) return { text: `fetch${NB}${ago(m.fetchedAt, now)}`, isError: false }
  return hasRemote ? { text: `fetch${NB}jamais`, isError: false } : null
}

export function gitError(res: Run) {
  const lines = res.stderr
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  return lines.slice(0, 4).join(' ') || `git a échoué (code ${res.exitCode})`
}

export function firstLine(text: string) {
  return text.split('\n').map((x) => x.trim()).find(Boolean) ?? ''
}

// origin/feat/x → feat/x
export function localOf(remote: string) {
  return remote.replace(/^[^/]+\//, '')
}

/** Comparaison de dossiers insensible à la casse et aux `\` / `/` (Windows). */
export function sameDir(a: string, b: string) {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

export function unique(list: string[]) {
  return [...new Set(list)]
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n}${NB}${n > 1 ? many : one}`
}

/** Âge relatif : « à l'instant », « il y a 4 min », « hier », puis la date. */
export function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `à${NB}l'instant`
  const min = Math.round(s / 60)
  if (min < 60) return `il${NB}y${NB}a${NB}${min}${NB}min`
  const h = Math.round(min / 60)
  if (h < 24) return `il${NB}y${NB}a${NB}${h}${NB}h`
  const d = Math.round(h / 24)
  if (d === 1) return 'hier'
  if (d < 30) return `il${NB}y${NB}a${NB}${d}${NB}j`
  const date = new Date(ms)
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** Arguments réservés de /git : les onglets (identifiants ou libellés) et hide / show. */
export function tabOfArg(arg: string): 'changes' | 'branches' | 'history' | null {
  const a = arg.toLowerCase()
  if (a === 'changes' || a === 'modifications') return 'changes'
  if (a === 'branches') return 'branches'
  if (a === 'history' || a === 'historique') return 'history'
  return null
}

/**
 * Une commande /project lancée du panneau a-t-elle fait son effet ? Le dépôt relu le dit sans
 * attendre la fin du tour de Claude, qui peut enchaîner sur tout autre chose dans le même tour.
 * Commit : HEAD a bougé. Sync : un fetch depuis le lancement et plus rien à récupérer. Push :
 * plus rien à pousser vers le suivi. PR : une PR existe pour HEAD (voir `prOfBranch`). Une commande sans ces
 * repères (lancée par une version précédente) n'est finie qu'avec le tour.
 */
export function isRunDone(run: NonNullable<Running>, r: GitRepo, m: Meta, p: PrState): boolean {
  if (!run.isStarted || run.startedAt === undefined) return false
  if (run.action === 'commit') return run.head !== undefined && r.head !== null && r.head !== run.head
  if (run.action === 'pull') return (m.fetchedAt ?? 0) >= run.startedAt && r.behind === 0 && !r.operation
  if (run.action === 'push') return Boolean(r.upstream) && r.ahead === 0
  if (run.action === 'pr') return prOfBranch(r, p) !== null
  return false
}
