// Panneau Git (/git) et bandeau au-dessus du prompt : la branche, ses écarts avec le
// distant, les fichiers modifiés, les branches (bascule, création), l'historique et la
// pull request.
//
// - Ce module est le seul à parler au moteur (`$`) : état, hooks, lectures git et gh.
//   Le dessin est dans view.tsx, les données pures dans model.ts, les SVG dans svg.ts.
// - Le panneau ne lance lui-même que des lectures git, `git fetch` et `git switch`
//   (sans les hooks du dépôt : `$.process.run` les coupe pour git).
// - Commit, pull, push et PR passent par les commandes du plugin project
//   (/project:commit, /project:sync, /project:push, /project:pr) : le bouton les lance
//   comme si on les tapait ; si le moteur refuse, la commande est mise dans le prompt.
// - Le bandeau résume la branche dans un dépôt ; masqué, la ligne d'état prend le relais. Son
//   bouton de l'étape suivante lance l'étape suggérée ; pendant un parcours flow-board (lu
//   dans la valeur `board` de flow-board), ni Push ni PR.
// - `/git-board:git` (commands/git.md) est connue dès le premier message ; `/git`, déclarée
//   au démarrage, sort du menu mais reste utilisable tapée en entier.
// - Après un push, la CI du commit poussé est suivie jusqu'à ce que ses checks soient finis.
// - À la fin d'un tour, des commits à pousser sur un arbre propre : `/project:push` est
//   proposé en suggestion grisée dans le prompt.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Action, CiWatch, Expanded, FlowBoardSeen, Form, GitFile, GitRepo, Meta, Notice, PrChecks, PrState, Running, Switching, Tab } from '../types'
import {
  CI_EVERY_MS,
  LOG_FORMAT,
  MAX_COMMITS,
  PR_FIELDS,
  REF_FORMAT,
  RUN_FIELDS,
  ciPhaseOf,
  isCiActive,
  plural,
  prOfBranch,
  runsOf,
  commandFor,
  defaultOf,
  firstLine,
  gitError,
  githubUrl,
  localOf,
  parseLog,
  parseNumstat,
  parseRefs,
  parseRemoteUrls,
  parseStatus,
  prOf,
  sameDir,
  isFreshReflog,
  isFlowActive,
  isRunDone,
  slash,
  SYNC_BASE,
  VERSION_COMMAND,
  statusText,
  tabOfArg,
  type LoadOptions,
  type Run,
} from './model.ts'
import { drawBand, drawPane, kitOf, type Actions, type Caps, type View } from './view.tsx'

const PANE = 'git'
const PANE_TITLE = 'Git'
/** La commande déclarée par `commands/git.md`, préfixée du nom du plugin. */
const STATIC_GIT = 'git-board:git'
/** La suggestion grisée de fin de tour (texte exact, que flow-board reconnaît). */
const PUSH_SUGGESTION = '/project:push'
const ARG_HINT = '[changes|branches|history|hide|show|dossier du dépôt]'
const TAB_LABEL: Record<Tab, string> = { changes: 'Modifications', branches: 'Branches', history: 'Historique' }

const EMPTY_META: Meta = { folder: null, sessionRoot: null, loading: null, error: null, fetchedAt: null, fetchError: null }
const EMPTY_FORM: Form = { hint: '', prBase: '', prDraft: false, prAuto: false, filter: '', newBranch: '' }
const EMPTY_EXPANDED: Expanded = { files: false, branches: false, remotes: false, commits: false }

// Gardés par l'hôte : survivent au rechargement à chaud du module.
const repo = atom({ plugin: 'git-board', key: 'repo' } as const, null as GitRepo | null)
const prState = atom({ plugin: 'git-board', key: 'pr' } as const, null as PrState)
const meta = atom({ plugin: 'git-board', key: 'meta' } as const, EMPTY_META)
const tab = atom({ plugin: 'git-board', key: 'tab' } as const, 'changes' as Tab)
const action = atom({ plugin: 'git-board', key: 'action' } as const, null as Action | null)
const form = atom({ plugin: 'git-board', key: 'form' } as const, EMPTY_FORM)
const notice = atom({ plugin: 'git-board', key: 'notice' } as const, null as Notice)
const busy = atom({ plugin: 'git-board', key: 'busy' } as const, null as string | null)
const running = atom({ plugin: 'git-board', key: 'running' } as const, null as Running)
const switching = atom({ plugin: 'git-board', key: 'switching' } as const, null as Switching)
const showRemotes = atom({ plugin: 'git-board', key: 'showRemotes' } as const, false)
// Bandeau masqué : le temps de la session, comme flow-board.
const isBandHidden = atom({ plugin: 'git-board', key: 'isBandHidden' } as const, false)
const expanded = atom({ plugin: 'git-board', key: 'expanded' } as const, EMPTY_EXPANDED)
const ci = atom({ plugin: 'git-board', key: 'ci' } as const, null as CiWatch)
// La valeur `board` de flow-board, lue seulement (seul son propriétaire l'écrit) : un parcours
// actif retire Push et PR du bandeau. Absente sans flow-board.
const FLOW_BOARD = { plugin: 'flow-board', key: 'board' } as const

// Les éléments que chaque surface dessine, d'après le contrat `Elements` du moteur : pas de
// `Svg` sur le terminal, ni `Input` ni `Select` sur le mobile. La table de `$.ui.resolve`
// les contient quand même (fragments vides) : on ne peut pas s'y fier.
const capsOf = (surface: string): Caps => ({ hasSvg: surface !== 'terminal', hasFields: surface !== 'mobile' })

// Outils après lesquels l'état git a pu changer.
const WRITERS = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// État du module, perdu au rechargement : rien que des optimisations.
let inFlight: Promise<void> | null = null
let queued: LoadOptions | null = null
let lastPeek = ''
let timer: { cancel: () => void } | null = null
let wantPr = false
let wantCi = false
let ticks = 0
// Suivi de la CI : la minuterie des relectures, et une relecture à la fois.
let ciTimer: { cancel: () => void } | null = null
let isCiPolling = false

/** Un effet d'interface raté (pas d'écran, surface sans panneau) ne doit jamais gêner la lecture. */
const quietly = async (effect: () => unknown) => {
  try {
    await effect()
  } catch {
    // Rien à afficher ici : l'état, lui, est déjà écrit.
  }
}

// ─── Commande /git et /git-board:git ────────────────────────────────────────

// `/git` n'existe qu'après le démarrage du mod ; `/git-board:git`, déclarée par
// `commands/git.md`, est connue dès le premier message. Les deux reçoivent la même réponse,
// sans passer par le modèle. Aucun état posé par `session.start` n'est supposé ici.
const answerGit = async ($: any, e: { args: string }) => {
  const arg = e.args.trim()
  const word = arg.toLowerCase()
  if (word === 'hide') {
    await setBandHidden($, true)
    return { text: 'Bandeau Git masqué (/git show pour le réafficher).' }
  }
  const tabArg = tabOfArg(word)
  let text = 'Panneau Git ouvert.'
  if (word === 'show') {
    await setBandHidden($, false)
    text = 'Bandeau Git réaffiché, panneau Git ouvert.'
  } else if (tabArg) {
    await update($, tab, () => tabArg)
    text = `Panneau Git ouvert (onglet ${TAB_LABEL[tabArg]}).`
  } else if (arg) {
    await update($, meta, (m) => ({ ...m, folder: arg }))
    text = `Panneau Git ouvert sur ${arg}.`
  }
  await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
  // Par une minuterie : la relecture (fetch compris) survit à la fin de la commande.
  $.clock.after(0, () => void refresh($, { fetch: true, pr: true, say: true }))
  return { text }
}

// `/git` reste utilisable tapée en entier, mais sort du menu : `/git-board:git`, déjà là
// avant le premier message, y suffit et le doublon disparaît.
const hideDuplicate = async ($: any, e: any, next: any) => ({ ...(await next(e)), isHidden: true })

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Un enregistrement refusé ne doit pas empêcher la minuterie ni la première lecture.
    await quietly(() =>
      $.command.register({
        name: 'git',
        description: 'Panneau Git : modifications, branches, historique, commit, pull, push et PR',
        argumentHint: ARG_HINT,
      }),
    )
    // Toutes les 5 s : un coup d'œil léger une fois sur deux (10 s) pour les changements faits
    // hors de la session, et le redessin des âges affichés.
    $.clock.every(5_000, () => void tick($))
    // Des données dès le début, en arrière-plan : une seule lecture locale (sans fetch). Le
    // dépôt est écrit (le bandeau s'affiche) avant la lecture de la PR, un seul appel gh.
    if (!(await read($, repo))) $.clock.after(0, () => void refresh($, { pr: true }))
    return result
  })

  on('command.run', { command: 'git' }, answerGit)
  on('command.describe', { command: 'git' }, hideDuplicate)
  on('command.run', { command: STATIC_GIT }, answerGit)

  // Claude modifie des fichiers ou lance git : le panneau se relit juste après.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (WRITERS.has(e.tool)) {
      const command = (e as { command?: unknown }).command
      const text = typeof command === 'string' ? command : ''
      // Après un `git push`, la CI du commit poussé est suivie (une fois le dépôt relu).
      schedule($, /\bgit\s+push\b|\bgh\s+pr\b/.test(text), /\bgit\s+push\b/.test(text))
    }
    return result
  })

  // Une commande /project lancée du panneau est un tour de Claude : elle commence au
  // prochain tour (un tour déjà en cours finit d'abord) et se termine avec lui.
  on('turn.start', async ($, e, next) => {
    // Le tour d'un sous-agent du tour en cours ne fait pas démarrer la commande en attente.
    if (e.agentId !== undefined) return next(e)
    const r = await read($, running)
    if (r && !r.isStarted) await update($, running, (x) => (x ? { ...x, isStarted: true } : x))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const r = await read($, running)
    if (!e.agentId && r?.isStarted) {
      await update($, running, () => null)
      // Pas de ✓ : un tour fini n'est pas une réussite, le résultat se lit dans la relecture.
      if (e.isAborted) await say($, 'info', `${r.command} interrompue : relecture du dépôt.`)
      else await say($, 'ok', `${r.command} : tour terminé, relecture du dépôt.`)
      // Les outils du tour ont déjà relu le dépôt ; reste la pull request, et la CI après
      // un /project:push.
      schedule($, true, r.action === 'push')
    }
    // Fin d'un tour principal : la commande suivante en suggestion grisée, dépôt relu.
    if (!e.agentId) $.clock.after(0, () => void suggestPush($))
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await readView($)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, capsOf(e.surface))
    return drawPane(kit, view, actionsFor($)) as any
  })

  // Le bandeau se compose avec ceux des autres plugins (flow-board, asana-board…) : le leur
  // reste au-dessus, celui de Git dessous ; jamais seul quand un autre bandeau existe.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Lire AVANT tout retour anticipé : la lecture abonne le bandeau aux changements.
    const view = await readView($)
    if (!view.repo || view.isBandHidden) return next(e)
    const below = await next(e)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, capsOf(e.surface))
    const own = drawBand(kit, view, actionsFor($)) as any
    if (!own) return below
    if (below.type === 'engine') return own
    const { Box } = kit
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {below}
        {own}
      </Box>
    )
  })
}

// ─── Vue et actions ─────────────────────────────────────────────────────────

async function readView($: any): Promise<View> {
  return {
    repo: await read($, repo),
    pr: await read($, prState),
    meta: await read($, meta),
    tab: await read($, tab),
    action: await read($, action),
    form: await read($, form),
    notice: await read($, notice),
    busy: await read($, busy),
    running: await read($, running),
    switching: await read($, switching),
    showRemotes: await read($, showRemotes),
    expanded: await read($, expanded),
    isBandHidden: await read($, isBandHidden),
    ci: await read($, ci),
    isFlowActive: isFlowActive(await readFlowBoard($)),
    now: await $.clock.now(),
  }
}

/** La valeur `board` de flow-board ; null sans flow-board ou si la lecture échoue. */
async function readFlowBoard($: any): Promise<FlowBoardSeen> {
  try {
    const { value } = await $.state.get(FLOW_BOARD)
    return value ?? null
  } catch {
    return null
  }
}

function actionsFor($: any): Actions {
  return {
    setTab: (t) => update($, tab, () => t),
    toggleAction: (a) => update($, action, (x) => (x === a ? null : a)),
    closeAction: () => update($, action, () => null),
    setForm: (patch) => update($, form, (x) => ({ ...x, ...patch })),
    refresh: async () => {
      // Une commande restée « en file » sans jamais ouvrir de tour : ↻ l'oublie.
      await update($, running, (x) => (x && !x.isStarted ? null : x))
      await refresh($, { fetch: true, pr: true, say: true })
    },
    launch: (a) => launch($, a),
    launchBase: () => launch($, 'pull', true),
    launchVersion: () => launchVersion($),
    openFolder: (value) => openFolder($, value),
    backToSession: () => openFolder($, ''),
    askSwitch: (name, isRemote) => askSwitch($, name, isRemote),
    confirmSwitch: (name, isRemote) => switchBranch($, name, isRemote),
    cancelSwitch: () => update($, switching, () => null),
    createBranch: (value) => createBranch($, value),
    toggleRemotes: () => update($, showRemotes, (v) => !v),
    toggleExpanded: (list) => update($, expanded, (x) => ({ ...x, [list]: !x[list] })),
    dismissNotice: () => update($, notice, () => null),
    hideBand: async () => {
      await setBandHidden($, true)
      await quietly(() => $.ui.toast('Bandeau Git masqué : /git show pour le réafficher'))
    },
    openPane: () => quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE })),
    copyLink: (url, copied, surface) => copyLink($, url, copied, surface),
  }
}

/** Copie une adresse dans le presse-papiers de la surface pressée et le dit ; sans copie, le toast donne l'adresse à recopier. */
async function copyLink($: any, url: string, copied: string, surface?: string) {
  let done: { isCopied?: boolean } | null = null
  try {
    done = await $.ui.copy({ text: url, ...(surface ? { surface } : {}) })
  } catch {
    // Le toast donne alors l'adresse à recopier.
  }
  await quietly(() => $.ui.toast(done?.isCopied ? copied : `Copie impossible : ${url}`))
}

async function setBandHidden($: any, hidden: boolean) {
  await update($, isBandHidden, () => hidden)
  await syncStatus($)
}

/** La ligne d'état sous le prompt ne sert que de relais quand le bandeau est masqué. */
async function syncStatus($: any) {
  const r = await read($, repo)
  const hidden = await read($, isBandHidden)
  const text = r && hidden ? statusText(r) : undefined
  await quietly(() => $.ui.status(text))
}

/** Redessine pour faire avancer les âges : toutes les 5 s en activité, toutes les 30 s au repos. */
async function tick($: any) {
  ticks += 1
  if (ticks % 2 === 0) await peek($)
  // Un rechargement du module perd la minuterie de la CI, pas son suivi : on la relance.
  if (!ciTimer && isCiActive(await read($, ci))) ciTimer = $.clock.every(CI_EVERY_MS, () => void pollCi($))
  const m = await read($, meta)
  const isBusy = Boolean(m.loading) || (await read($, busy)) !== null || (await read($, running)) !== null
  if (isBusy || ticks % 6 === 0) await quietly(() => $.ui.invalidate('ui.render'))
}

// ─── Lecture du dépôt ───────────────────────────────────────────────────────

// Lectures sans verrou optionnel : le coup d'œil périodique ne doit jamais bloquer un
// `git commit` lancé au même moment (index.lock). Jamais d'invite d'identifiants.
// Ne rejette jamais : git introuvable ou trop lent se lit comme un échec (code -1),
// pour qu'une commande en échec n'emporte pas toute la lecture du dépôt.
async function git($: any, cwd: string, args: string[], timeoutMs = 20_000): Promise<Run> {
  try {
    return await $.process.run(['git', '--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args], {
      cwd,
      timeoutMs,
      env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
  } catch (err: any) {
    return { exitCode: -1, stdout: '', stderr: String(err?.message ?? err) }
  }
}

// Une relecture à la fois ; celles demandées entre-temps sont fusionnées en une seule.
function refresh($: any, opts: LoadOptions): Promise<void> {
  if (inFlight) {
    queued = { fetch: queued?.fetch || opts.fetch, pr: queued?.pr || opts.pr, say: queued?.say || opts.say }
    return inFlight
  }
  inFlight = (async () => {
    try {
      await load($, opts)
      await settleRun($)
    } catch (err: any) {
      await setMeta($, { loading: null })
      if (opts.say) await say($, 'error', String(err?.message ?? err))
    } finally {
      inFlight = null
    }
    const again = queued
    queued = null
    if (again) await refresh($, again)
  })()
  return inFlight
}

async function load($: any, opts: LoadOptions) {
  const m = await read($, meta)
  const cwd: string = await $.session.cwd()
  const folder = m.folder ?? cwd
  // Seule une relecture demandée (say) montre son avancement : chaque écriture redessine.
  const step = async (loading: string | null) => {
    if (opts.say) await setMeta($, { loading })
  }

  await step('Lecture du dépôt…')
  const top = await git($, folder, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    await putRepo($, null)
    await putPr($, null)
    if (await read($, ci)) await stopCi($)
    await setMeta($, { loading: null, error: top.exitCode === -1 ? `git ne répond pas : ${firstLine(top.stderr)}` : `${folder} n'est pas dans un dépôt git.` })
    await syncStatus($)
    return
  }
  const root = top.stdout.trim()

  if (opts.fetch) {
    await step('Récupération du distant (git fetch)…')
    const fetched = await git($, root, ['fetch', '--prune', '--quiet'], 60_000)
    if (fetched.exitCode === 0) await setMeta($, { fetchedAt: await $.clock.now(), fetchError: null })
    else {
      // Sans distant, rien à récupérer : ce n'est pas une erreur.
      const remotes = await git($, root, ['remote'])
      if (remotes.stdout.trim()) {
        await setMeta($, { fetchError: firstLine(fetched.stderr) || 'git fetch a échoué' })
        if (opts.say) await say($, 'error', `git fetch : ${firstLine(fetched.stderr) || 'échec'}`)
      }
    }
    await step('Lecture du dépôt…')
  }

  const [status, numstat, refs, log, unpushed, urls, originHead, gitDir, commonDir, sessionTop] = await Promise.all([
    git($, root, ['status', '--porcelain=v2', '--branch', '--show-stash', '-z']),
    git($, root, ['diff', 'HEAD', '--numstat', '-z']),
    git($, root, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes']),
    git($, root, ['log', '-n', String(MAX_COMMITS), `--format=${LOG_FORMAT}`]),
    git($, root, ['rev-list', '-n', '500', 'HEAD', '--not', '--remotes']),
    git($, root, ['config', '--get-regexp', '^remote\\..*\\.url$']),
    git($, root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
    git($, root, ['rev-parse', '--absolute-git-dir']),
    git($, root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    sameDir(folder, cwd) ? Promise.resolve(top) : git($, cwd, ['rev-parse', '--show-toplevel']),
  ])
  if (status.exitCode !== 0) throw new Error(`git status : ${firstLine(status.stderr) || 'échec'}`)
  lastPeek = status.stdout + numstat.stdout

  // L'âge du dernier fetch, même fait hors de la session : la date de `FETCH_HEAD`. Un
  // fetch plus récent de la session l'emporte.
  if (gitDir.exitCode === 0) {
    const fetchHead = await $.fs.stat(`${gitDir.stdout.trim()}/FETCH_HEAD`).catch(() => null)
    const mtime = typeof fetchHead?.mtimeMs === 'number' ? fetchHead.mtimeMs : 0
    if (mtime > 0 && mtime > ((await read($, meta)).fetchedAt ?? 0)) await setMeta($, { fetchedAt: mtime })
  }

  const st = parseStatus(status.stdout)
  const stats = numstat.exitCode === 0 ? parseNumstat(numstat.stdout) : new Map<string, [number | null, number | null]>()
  const files: GitFile[] = st.files.map((x) => {
    const s = x.kind === 'untracked' ? undefined : stats.get(x.path)
    return { ...x, added: s ? s[0] : null, removed: s ? s[1] : null }
  })
  const { locals, remotes, remoteNames } = parseRefs(refs.exitCode === 0 ? refs.stdout : '')
  const remoteUrls = parseRemoteUrls(urls.exitCode === 0 ? urls.stdout : '')
  const hasRemote = remoteUrls.size > 0
  const notPushed = new Set(unpushed.exitCode === 0 ? unpushed.stdout.split('\n').filter(Boolean) : [])
  const url = remoteUrls.get('origin') ?? [...remoteUrls.values()][0] ?? null
  const defaultBranch = defaultOf(originHead, locals, remoteNames)
  // Une branche sans distante : ses commits absents de la branche par défaut locale.
  const counted =
    !st.upstream && st.branch && defaultBranch && st.branch !== defaultBranch && locals.some((b) => b.name === defaultBranch)
      ? await git($, root, ['rev-list', '--count', `refs/heads/${defaultBranch}..HEAD`])
      : null
  const toMerge = counted && counted.exitCode === 0 && /^\d+$/.test(counted.stdout.trim()) ? Number(counted.stdout.trim()) : null
  // Rien d'absent de la branche par défaut : vide ou fusionnée ? Vide seulement si l'entrée la
  // plus ancienne du reflog de la branche est sa création et qu'aucun commit n'y a été fait
  // depuis (voir `isFreshReflog`). Sans reflog : fusionnée.
  const reflog = toMerge === 0 ? await git($, root, ['reflog', 'show', '--format=%H%x00%gs', `refs/heads/${st.branch}`]) : null
  const isFresh = reflog !== null && reflog.exitCode === 0 && isFreshReflog(reflog.stdout)

  const next: GitRepo = {
    root,
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    branch: st.branch,
    head: st.oid ? st.oid.slice(0, 7) : null,
    oid: st.oid,
    upstream: st.upstream,
    ahead: st.ahead,
    behind: st.behind,
    defaultBranch,
    webUrl: url ? githubUrl(url) : null,
    hasRemote,
    operation: gitDir.exitCode === 0 ? await operationOf($, gitDir.stdout.trim()) : null,
    stash: st.stash,
    unpushed: notPushed.size,
    isLinkedWorktree: gitDir.exitCode === 0 && commonDir.exitCode === 0 && !sameDir(gitDir.stdout.trim(), commonDir.stdout.trim()),
    toMerge,
    isFresh,
    files,
    branches: locals,
    remotes,
    commits: log.exitCode === 0 ? parseLog(log.stdout, notPushed, hasRemote) : [],
  }
  await putRepo($, next)
  await setMeta($, { error: null, sessionRoot: sessionTop.exitCode === 0 ? sessionTop.stdout.trim() : null })
  // Changement de branche ou de dossier : le suivi de la CI s'arrête.
  const watched = await read($, ci)
  if (watched && (watched.root !== root || watched.branch !== next.branch)) await stopCi($)
  await syncStatus($)

  // La pull request : à la demande, ou quand la branche a changé depuis la dernière lecture.
  const known = await read($, prState)
  if (opts.pr || (known !== null && known.branch !== (next.branch ?? ''))) {
    await step('Lecture de la pull request (gh)…')
    await putPr($, await loadPr($, next))
  }
  await step(null)
}

// Coup d'œil périodique : deux commandes légères, une relecture seulement si l'état a bougé.
async function peek($: any) {
  if (inFlight) return
  const r = await read($, repo)
  if (!r) return
  try {
    const [s, n] = await Promise.all([
      git($, r.root, ['status', '--porcelain=v2', '--branch', '--show-stash', '-z']),
      git($, r.root, ['diff', 'HEAD', '--numstat', '-z']),
    ])
    if (s.stdout + n.stdout !== lastPeek) await refresh($, {})
  } catch {
    // Dépôt déplacé ou git introuvable : la prochaine relecture complète le dira.
  }
}

// Après un outil de Claude : une relecture groupée, une demi-seconde après le dernier.
// `watch` : un push vient d'avoir lieu, la CI est suivie une fois le dépôt relu.
function schedule($: any, pr: boolean, watch = false) {
  wantPr = wantPr || pr
  wantCi = wantCi || watch
  timer?.cancel()
  timer = $.clock.after(500, () => {
    timer = null
    void runScheduled($)
  })
}

async function runScheduled($: any) {
  const withPr = wantPr
  const withCi = wantCi
  wantPr = false
  wantCi = false
  await refresh($, { pr: withPr })
  if (withCi) await startCi($)
}

/** La relecture groupée en attente part tout de suite ; sinon on attend celle en cours. */
async function flush($: any) {
  if (timer) {
    timer.cancel()
    timer = null
    await runScheduled($)
  } else if (inFlight) await inFlight
}

// ─── Suggestion de fin de tour ──────────────────────────────────────────────

// Des commits en avance sur l'amont, un arbre propre et aucune commande /project en file ni
// en cours : /project:push en suggestion grisée. Dans le dossier de la session seulement,
// là où agit la commande ; jamais pendant une opération (rebase, merge…).
async function suggestPush($: any) {
  await flush($)
  const r = await read($, repo)
  if (!r || !r.branch || !r.upstream || r.ahead === 0 || r.files.length > 0 || r.operation) return
  const m = await read($, meta)
  if (m.sessionRoot === null || !sameDir(m.sessionRoot, r.root)) return
  if ((await read($, running)) !== null) return
  await quietly(() => $.prompt.suggest({ text: PUSH_SUGGESTION }))
}

// ─── Suivi de la CI après un push ───────────────────────────────────────────

const NO_CHECKS: PrChecks = { passed: 0, failed: 0, pending: 0, firstFailed: null }

// Un push a eu lieu (dépôt relu) : la CI du commit poussé est suivie, relue toutes les 25 s
// jusqu'à ce que tous ses checks soient finis. Seulement sur GitHub, une fois le commit
// arrivé sur l'amont ; un commit déjà suivi (ou fini) ne repart pas.
async function startCi($: any) {
  const r = await read($, repo)
  if (!r || !r.branch || !r.upstream || r.ahead > 0 || !r.webUrl || !r.oid) return
  const w = await read($, ci)
  if (w && w.sha === r.oid && w.root === r.root && w.branch === r.branch) return
  const next: CiWatch = { root: r.root, branch: r.branch, sha: r.oid, startedAt: await $.clock.now(), phase: 'waiting', checks: NO_CHECKS }
  await update($, ci, () => next)
  ciTimer?.cancel()
  ciTimer = $.clock.every(CI_EVERY_MS, () => void pollCi($))
  await pollCi($)
}

// Une relecture des checks : par la PR ouverte quand il y en a une (ses checks se mettent à
// jour dans le panneau), sinon par les exécutions GitHub Actions du commit. gh absent, non
// connecté ou illisible : le suivi s'arrête sans rien dire, le panneau reste comme avant.
async function pollCi($: any) {
  if (isCiPolling) return
  const w = await read($, ci)
  if (!w || !isCiActive(w)) return stopCiTimer()
  isCiPolling = true
  try {
    const r = await read($, repo)
    if (!r || r.root !== w.root || r.branch !== w.branch) return await stopCi($)
    let checks: PrChecks | null = null
    const known = prOfBranch(r, await read($, prState))
    if (known && known.state === 'OPEN') {
      const p = await loadPr($, r)
      if (!p || p.error) return await stopCi($)
      await putPr($, p)
      // Juste après le push, la PR peut encore montrer l'ancien commit et ses checks.
      if (p.pr) checks = p.pr.head && p.pr.head !== w.sha ? NO_CHECKS : p.pr.checks
    }
    if (!checks) {
      const res: Run = await $.process.run(['gh', 'run', 'list', '--commit', w.sha, '--json', RUN_FIELDS, '--limit', '50'], {
        cwd: r.root,
        timeoutMs: 20_000,
        env: { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
      })
      if (res.exitCode !== 0) return await stopCi($)
      checks = runsOf(res.stdout)
    }
    const phase = ciPhaseOf(checks, (await $.clock.now()) - w.startedAt)
    const next: CiWatch = { ...w, phase, checks }
    // Un nouveau push a pu remplacer le suivi pendant la lecture : celle-ci est alors périmée.
    const current = await read($, ci)
    if (!current || current.sha !== w.sha || current.root !== w.root || current.branch !== w.branch) return
    if (JSON.stringify(next) !== JSON.stringify(current)) await update($, ci, (cur) => (cur && cur.sha === w.sha ? next : cur))
    if (!isCiActive(next)) {
      stopCiTimer()
      await announceCi($, next)
    }
  } catch {
    await stopCi($)
  } finally {
    isCiPolling = false
  }
}

async function announceCi($: any, w: NonNullable<CiWatch>) {
  const c = w.checks
  const total = c.passed + c.failed + c.pending
  if (w.phase === 'passed') await say($, 'ok', `✓ CI réussie sur ${w.branch} (${plural(total, 'check')}).`)
  else if (w.phase === 'failed') await say($, 'error', `✗ CI échouée sur ${w.branch} : ${c.firstFailed ?? `${plural(c.failed, 'check')} en échec`}.`)
  else if (w.phase === 'timeout') await say($, 'info', `CI encore en cours sur ${w.branch} après 20 min : suivi arrêté (↻ relit la PR).`)
}

function stopCiTimer() {
  ciTimer?.cancel()
  ciTimer = null
}

async function stopCi($: any) {
  stopCiTimer()
  await update($, ci, () => null)
}

async function operationOf($: any, gitDir: string) {
  const has = (name: string) =>
    $.fs.stat(`${gitDir}/${name}`).then(
      () => true,
      () => false,
    )
  if ((await has('rebase-merge')) || (await has('rebase-apply'))) return 'rebase'
  if (await has('MERGE_HEAD')) return 'merge'
  if (await has('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (await has('REVERT_HEAD')) return 'revert'
  return null
}

async function loadPr($: any, r: GitRepo): Promise<PrState> {
  const branch = r.branch ?? ''
  if (!r.branch || !r.webUrl || r.branch === r.defaultBranch) return { branch, pr: null, error: null }
  let res: Run
  try {
    res = await $.process.run(['gh', 'pr', 'view', r.branch, '--json', PR_FIELDS], {
      cwd: r.root,
      timeoutMs: 20_000,
      env: { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    })
  } catch {
    return { branch, pr: null, error: 'GitHub CLI (gh) introuvable : la pull request ne peut pas être lue.' }
  }
  if (res.exitCode !== 0) {
    if (/no (open )?pull requests? found/i.test(res.stderr)) return { branch, pr: null, error: null }
    return { branch, pr: null, error: `gh : ${firstLine(res.stderr) || 'lecture de la PR impossible'}` }
  }
  // Un JSON illisible lève ici : `refresh` le relève, le dépôt est déjà écrit.
  return prOf(branch, res.stdout)
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function openFolder($: any, value: string) {
  await update($, meta, (m) => ({ ...m, folder: value.trim() || null }))
  await refresh($, { fetch: true, pr: true, say: true })
}

// Avec des modifications suivies, la bascule demande confirmation : elles suivent la
// branche, et git refuse si l'une entre en conflit.
async function askSwitch($: any, name: string, isRemote: boolean) {
  const r = await read($, repo)
  if (!r) return
  if (r.files.some((x) => x.kind !== 'untracked')) await update($, switching, () => ({ name, isRemote }))
  else await switchBranch($, name, isRemote)
}

async function switchBranch($: any, name: string, isRemote: boolean) {
  const r = await read($, repo)
  if (!r) return
  const target = isRemote ? localOf(name) : name
  await update($, switching, () => null)
  await update($, busy, () => `Bascule vers ${target}…`)
  let isDone = false
  try {
    // Une branche seulement distante : `--track` crée la branche locale qui la suit.
    const res = await git($, r.root, isRemote ? ['switch', '--track', name] : ['switch', name], 60_000)
    if (res.exitCode === 0) isDone = true
    else await say($, 'error', gitError(res))
  } catch (err: any) {
    await say($, 'error', String(err?.message ?? err))
  } finally {
    await update($, busy, () => null)
  }
  if (isDone) {
    await say($, 'ok', `✓ Sur la branche ${target}`)
    await refresh($, { pr: true })
  }
}

async function createBranch($: any, value: string) {
  const name = value.trim()
  const r = await read($, repo)
  if (!r || !name) return
  if (r.branches.some((b) => b.name === name)) return say($, 'error', `La branche ${name} existe déjà : bascule dessus depuis la liste.`)
  await update($, busy, () => `Création de ${name}…`)
  let isDone = false
  try {
    const check = await git($, r.root, ['check-ref-format', '--branch', name])
    if (check.exitCode !== 0) await say($, 'error', `« ${name} » n'est pas un nom de branche valide.`)
    else {
      const res = await git($, r.root, ['switch', '-c', name], 60_000)
      if (res.exitCode === 0) isDone = true
      else await say($, 'error', gitError(res))
    }
  } catch (err: any) {
    await say($, 'error', String(err?.message ?? err))
  } finally {
    await update($, busy, () => null)
  }
  if (isDone) {
    await update($, form, (x) => ({ ...x, newBranch: '' }))
    await say($, 'ok', r.files.length ? `✓ Branche ${name} créée : tes modifications l'ont suivie.` : `✓ Branche ${name} créée.`)
    await refresh($, { pr: true })
  }
}

// Le bouton lance la commande comme si on la tapait : elle part dès que la session est
// libre. Introuvable ou refusée, elle est mise dans le prompt, prête à envoyer. `isBase` :
// le pull intègre la branche par défaut (`/project:sync base`) au lieu de la branche distante.
// Une seule commande à la fois, quel que soit le bouton (tiroir ou bandeau) : la place est prise
// avant tout le reste, deux appuis rapprochés ne lancent qu'une commande.
async function launch($: any, a: Action, isBase = false) {
  const now = await $.clock.now()
  const r = await read($, repo)
  const f = await read($, form)
  if (!r) return
  const c = isBase && a === 'pull' ? SYNC_BASE : commandFor(a, r, f)
  const text = slash(c)
  const run: Running = { command: text, isStarted: false, action: a, head: r.head, startedAt: now }
  if (!(await claimRun($, run))) return
  await update($, action, () => null)
  if (a === 'commit') await update($, form, (x) => ({ ...x, hint: '' }))
  const list: { name: string; plugin?: string }[] = await $.command.list().catch(() => [])
  const hit = list.find((x) => x.name === `project:${c.name}`)
  if (!hit) {
    await releaseRun($, run)
    return toPrompt($, text, 'commande introuvable : le plugin project est-il activé ?')
  }
  await quietly(() => $.ui.toast(`${text} lancée : elle part dès que Claude est libre`))
  $.command.run({ command: hit.name, args: c.args }).catch(async (err: any) => {
    await releaseRun($, run)
    await toPrompt($, text, String(err?.message ?? err))
  })
}

/**
 * Prend la place de la commande en file, d'un seul coup (`update` relit et réécrit à la
 * version lue) : false, et un mot, quand une commande est déjà en file ou en cours.
 */
async function claimRun($: any, run: NonNullable<Running>): Promise<boolean> {
  let held: Running = null
  await update($, running, (x) => {
    held = x
    return x ?? run
  })
  if (held === null) return true
  await say($, 'info', `${(held as NonNullable<Running>).command} est déjà en file ou en cours : attends sa fin (↻ oublie une commande restée en file).`)
  return false
}

/** Rend la place prise par `run`, sans effacer une commande lancée depuis. */
async function releaseRun($: any, run: NonNullable<Running>) {
  await update($, running, (x) => (x && x.command === run.command && x.startedAt === run.startedAt ? null : x))
}

// /project:version, suggérée dans le tiroir Push : lancée comme les autres, mais sans repère
// dans le dépôt, elle n'est finie qu'avec le tour de Claude.
async function launchVersion($: any) {
  const now = await $.clock.now()
  const run: NonNullable<Running> = { command: VERSION_COMMAND, isStarted: false, startedAt: now }
  if (!(await claimRun($, run))) return
  const list: { name: string; plugin?: string }[] = await $.command.list().catch(() => [])
  const hit = list.find((x) => x.name === 'project:version')
  if (!hit) {
    await releaseRun($, run)
    return toPrompt($, VERSION_COMMAND, 'commande introuvable : le plugin project est-il activé ?')
  }
  await quietly(() => $.ui.toast(`${VERSION_COMMAND} lancée : elle part dès que Claude est libre`))
  $.command.run({ command: hit.name, args: '' }).catch(async (err: any) => {
    await releaseRun($, run)
    await toPrompt($, VERSION_COMMAND, String(err?.message ?? err))
  })
}

async function toPrompt($: any, text: string, why: string) {
  const filled = await $.prompt.fill({ text, mode: 'replace' }).catch(() => null)
  await say($, 'info', filled?.isFilled ? `${text} est dans le prompt : Entrée pour le lancer (${why}).` : `Tape ${text} dans le prompt (${why}).`)
}

// ─── Petits outils ──────────────────────────────────────────────────────────

// Un mot dans la zone d'activité, doublé d'un toast ; les confirmations s'effacent seules,
// les erreurs restent jusqu'au « x ».
async function say($: any, tone: 'ok' | 'error' | 'info', text: string) {
  await update($, notice, () => ({ text, tone }))
  await quietly(() => $.ui.toast(text))
  if (tone !== 'error') $.clock.after(8000, () => void update($, notice, (x) => (x && x.text === text ? null : x)))
}

// Une commande /project dont le dépôt montre l'effet est finie, même si le tour de Claude
// continue sur autre chose : on ne la dit plus « en cours ».
async function settleRun($: any) {
  const run = await read($, running)
  const r = await read($, repo)
  if (!run || !r || !isRunDone(run, r, await read($, meta), await read($, prState))) return
  await update($, running, () => null)
  await say($, 'ok', `${run.command} : fait d'après le dépôt.`)
  // Hors de la relecture en cours (qui appelle cette fonction) : le suivi de la CI du push.
  if (run.action === 'push') $.clock.after(0, () => void startCi($))
}

async function setMeta($: any, patch: Partial<Meta>) {
  const m = await read($, meta)
  if (Object.entries(patch).some(([k, v]) => (m as any)[k] !== v)) await update($, meta, (x) => ({ ...x, ...patch }))
}

// N'écrivent que ce qui a changé : chaque écriture redessine le panneau et le bandeau.
async function putRepo($: any, value: GitRepo | null) {
  if (JSON.stringify(await read($, repo)) !== JSON.stringify(value)) await update($, repo, () => value)
}

async function putPr($: any, value: PrState) {
  if (JSON.stringify(await read($, prState)) !== JSON.stringify(value)) await update($, prState, () => value)
}
