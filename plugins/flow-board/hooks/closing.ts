// Fermeture d'une session liée rendue (un groupe, ou la session des pistes d'une phase) : le texte
// de la procédure que Claude suit, pour le bouton de repli comme pour la réponse de l'outil flow.
// Fonctions pures. Le mod n'a pas d'API pour arrêter une session ni retirer un worktree : la
// procédure les fait faire à Claude, qui vérifie d'abord, puis seulement arrête et retire.
//
// Invariant : une fermeture ne fait jamais perdre un commit, un fichier modifié ou non suivi, ni la
// conversation d'une session liée : un worktree n'est retiré que si sa branche est entièrement
// contenue dans la branche de travail et que son arbre ne contient rien d'autre que des fichiers de
// la liste jetable, vérifié de nouveau après l'arrêt de la session ; la branche n'est jamais
// supprimée ; une session qui travaille encore n'est jamais arrêtée. Le texte ne nomme donc jamais
// une option qui force, ni une suppression de branche, ni une fusion.

import type { Closing, Run } from '../types'
import { SKILLS } from './catalog.ts'
import { TITLE_SEPARATOR } from './linked.ts'

/** Longueur au-delà de laquelle le titre du parcours est coupé dans le titre d'une session liée. */
const PREFIX_MAX = 28

/**
 * Le début du titre de toute session liée : le titre du parcours, raccourci, puis « > » (ASCII :
 * l'app affichait « ' » à la place de « › »). Dans la
 * liste des discussions, les sessions filles d'une même discussion mère se reconnaissent ainsi. Sans
 * guillemets ni `$`, `\`, accent grave : le titre passe aussi dans `claude --bg -n`, cité par `shellQuote`.
 */
export const linkedPrefix = (run: Run): string => {
  const clean = run.title.replace(/["`$\\«»]/g, '').replace(/[>›]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.length <= PREFIX_MAX) return `${clean} ${TITLE_SEPARATOR} `
  const cut = clean.slice(0, PREFIX_MAX)
  const at = cut.lastIndexOf(' ')
  return `${(at > PREFIX_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·–-]+$/, '')}… ${TITLE_SEPARATOR} `
}

/**
 * Le nom court d'un parcours dans le nom du worktree d'une session de groupe : `-w groupe-<id>`
 * était entré en collision avec le worktree d'un autre parcours. Le préfixe `groupe-` reste :
 * `/stats-board:recap --worktrees` retrouve les sessions d'un parcours par les worktrees `groupe-*`.
 */
const WORKTREE_SLUG_MAX = 20
const worktreeSlug = (run: Run): string => {
  const slug = run.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= WORKTREE_SLUG_MAX) return slug
  const cut = slug.slice(0, WORKTREE_SLUG_MAX)
  const at = cut.lastIndexOf('-')
  return (at > WORKTREE_SLUG_MAX / 2 ? cut.slice(0, at) : cut).replace(/-+$/, '')
}
/**
 * Le worktree d'un groupe : `groupe-<nom court du parcours>-<id>`, `groupe-<id>` pour un parcours
 * sans titre ; à partir du deuxième envoi du groupe, son numéro en plus (`-2`, `-3`…) : la branche
 * d'un envoi précédent reste, fermée ou non.
 */
export const groupWorktree = (run: Run, id: string, seq?: number): string => {
  const slug = worktreeSlug(run)
  const base = slug ? `groupe-${slug}-${id}` : `groupe-${id}`
  const n = sendNumber(seq)
  return n !== undefined && n > 1 ? `${base}-${n}` : base
}

/** Un numéro d'envoi lu du tableau de bord (un fichier partagé) : un entier plausible, sinon aucun. */
export const sendNumber = (seq: unknown): number | undefined => (typeof seq === 'number' && Number.isInteger(seq) && seq >= 1 && seq <= 10_000 ? seq : undefined)

/** Le titre d'un envoi suivant d'un groupe le nomme : « Groupe A (envoi 2) · », distinct de celui du premier. */
export const groupTitle = (id: string, seq?: number): string => {
  const n = sendNumber(seq)
  return n !== undefined && n > 1 ? `Groupe ${id} (envoi ${n}) · ` : `Groupe ${id} · `
}

/**
 * Le worktree de la session des éléments d'une phase (les pistes d'une rétro) : leur libellé, en
 * minuscules, le nom court du parcours et le numéro de l'envoi (`pistes-retro-a-2`) : la branche
 * d'une session fermée reste, un nouvel envoi, du même parcours ou d'un autre, ne bute pas sur
 * elle. Sans numéro (envoi d'avant), le libellé seul.
 */
export const itemsWorktree = (run: Run, label: string, seq?: number): string => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  seq = sendNumber(seq)
  if (seq === undefined) return base
  const slug = worktreeSlug(run)
  return slug ? `${base}-${slug}-${seq}` : `${base}-${seq}`
}

/** Les titres des sessions liées lancées avant le séparateur « > » : l'app y affichait « ' » à la place de « › ». */
export const OLD_SEPARATORS = "« › » ou « ' » à la place de « > » pour une session lancée avant la 0.61.0"

/** Le début du titre de la session liée d'un groupe, tel que la demande de lancement le fixe (ou sans préfixe, avant la 0.37.0). */
export const linkedTitles = (run: Run, groupId: string): string => `« ${linkedPrefix(run)}Groupe ${groupId} · » (${OLD_SEPARATORS}) ou « Groupe ${groupId} · »`

/** Ce que la fermeture vise : un groupe rendu, ou la session des éléments d'une phase (les pistes d'une rétro). */
export type CloseTarget = { kind: 'group'; id: string; name: string } | { kind: 'items'; skill: string }

export type CloseInput = {
  run: Run
  target: CloseTarget
  /** Le dossier est un dépôt git : sans git, pas de worktree, la fermeture n'arrête que la session. */
  isRepo: boolean
  /** L'id de la session, relevé à son lancement (`local_…` pour l'app Desktop, l'id court du CLI sinon). */
  session?: string
  /** Le numéro de l'envoi (session des éléments, ou envoi suivant d'un groupe), qui nomme son worktree. */
  seq?: number
}

// Les formes sûres des valeurs qui entrent dans une commande (fermeture, réouverture) : une valeur
// lue du tableau de bord (un fichier partagé) ou rapportée par Claude n'y entre que vérifiée.
// Aucune ne commence par « - » : elle serait lue comme une option.

/** Un id de session (id court du CLI, `local_…` de l'app) ou de conversation : lettres, chiffres, _ et -. */
export const isSafeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)

/** Le sessionId que reprend `claude --resume` : l'id complet d'une conversation, un UUID. */
const isConversationId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** Le sessionId noté à la fermeture : celui d'une conversation du CLI (un UUID), ou l'id `local_…` d'une session de l'app. */
export const isSessionId = (value: unknown): value is string => isSafeId(value) && (isConversationId(value) || /^local_[A-Za-z0-9_-]{1,93}$/.test(value))

/**
 * Une branche : seulement [A-Za-z0-9._/-], et un nom que git accepte (`git check-ref-format`) :
 * ni `..`, ni `//`, ni `/` au bout, ni segment qui commence par `.` ou finit par `.lock`, ni `.` final ;
 * et un nom de branche, pas `refs/…`, `HEAD` ni un hash : `git worktree add` en ferait une HEAD détachée.
 */
export const isSafeBranch = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(?!-)[A-Za-z0-9._/-]{1,200}$/.test(value) &&
  !/\.\.|\/\/|^\/|\/$|\.$/.test(value) &&
  value.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock')) &&
  !/^(?:refs\/|HEAD$)/.test(value) &&
  !/^[0-9a-f]{7,40}$/i.test(value)

/** Le dossier du dépôt d'une racine de projet : celle d'un worktree est sous `<dépôt>/.claude/worktrees/`. */
const repoDir = (root: string): string => {
  const norm = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const at = norm.toLowerCase().indexOf('/.claude/worktrees/')
  return at >= 0 ? norm.slice(0, at) : norm
}

/**
 * Le chemin d'un worktree de session liée : absolu, sans apostrophe (ni ‘ ’ ‚ ‛, que PowerShell lit
 * comme elle), caractère de contrôle (C0, C1, séparateurs de ligne et de paragraphe U+2028/2029) ni
 * segment `.` ou `..`, et exactement `<dossier du dépôt>/.claude/worktrees/<nom>`, un nom en ASCII
 * (`[a-z0-9][a-z0-9._-]{0,199}`, comme ceux que crée flow-board), autre que la
 * racine elle-même (l'orchestrateur dans un worktree) ; faux quand la racine du projet est inconnue.
 * La casse ne compte pas : macOS et Windows l'ignorent par défaut.
 */
export const isWorktreePath = (value: unknown, root: string): value is string => {
  if (typeof value !== 'string' || value.length > 400 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029'\u2018-\u201b]/.test(value)) return false
  const path = value.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!/^(?:\/|[A-Za-z]:\/)/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return false
  const repo = repoDir(root)
  if (repo === '') return false
  const base = `${repo}/.claude/worktrees/`.toLowerCase()
  const lower = path.toLowerCase()
  const name = lower.startsWith(base) ? lower.slice(base.length) : ''
  // Le nom vérifié tel qu'écrit, pas en minuscules : « \u212A » (signe kelvin) deviendrait « k ».
  return name !== '' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(path.split('/').pop() ?? '') && !name.includes('/') && lower !== root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * La première commande d'une fermeture dans un dépôt : `core.fsmonitor` fait exécuter une commande
 * à chaque `git status`, que la procédure lance ensuite dans le worktree.
 */
const FSMONITOR =
  "Avant toute autre commande : git config --get core.fsmonitor dans ce dossier ; si elle affiche autre chose qu’un booléen (true, false, yes, no, on, off, 1, 0 : le démon intégré de git, sans danger), ne ferme rien et ne lance aucune autre commande git : cette valeur est une commande que git status exécuterait ; dis-le-moi, puis envoie \"state\": \"stopped\" avec cette raison. La même vérification se fait sur le worktree, git -C '<worktree>' config --get core.fsmonitor (sa config propre peut la poser), dès que <worktree> est connu et avant toute autre commande git -C '<worktree>'."

/** Une valeur citée pour le shell (POSIX) : entre apostrophes, chaque apostrophe écrite '\''. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * La liste jetable, fermée, validée au cadrage (ses dossiers le sont en entier) : ce qu'un worktree
 * peut emporter sans demander. Les types générés d'un mod (série 13) le sont seulement s'ils sont
 * identiques à ceux du clone principal, d'où `scripts/check.sh` les copie dans chaque worktree.
 */
const DISPOSABLE =
  'liste jetable : les liens symboliques, quelle que soit leur cible (test -L) ; __pycache__/ et *.pyc ; .show-your-work/ ; .pytest_cache/, .mypy_cache/, .ruff_cache/, node_modules/, .DS_Store ; les types générés d’un mod, un dossier <plugin>/.claude-plugin/types/, seulement s’ils sont identiques à ceux du clone principal au même chemin (diff -rq \'<worktree>/<plugin>/.claude-plugin/types\' \'<dossier du dépôt>/<plugin>/.claude-plugin/types\' ne dit rien et rend 0) ; s’ils diffèrent, ou si le clone principal n’en a pas, ils arrêtent la fermeture comme tout autre fichier ignoré'

/**
 * La forme de chaque valeur avant qu'elle entre dans une commande : une valeur hors forme arrête la
 * fermeture (point (1) du durcissement).
 */
const FORMS =
  'Forme des valeurs, avant toute commande : <branche> ne s’emploie que si elle est l’un des noms connus du point 1 ou la ligne branch exacte d’un bloc de git worktree list --porcelain (sans refs/heads/), et ne contient que [A-Za-z0-9._/-], sans - en tête ; <branche de travail> a la même forme ; <worktree> ne se retire que s’il est sous <dossier du dépôt>/.claude/worktrees/ (<dossier du dépôt> : la ligne worktree du premier bloc de git worktree list --porcelain, le clone principal), chemin absolu sans segment . ni .. ; un <pid> n’a que des chiffres ; <worktree>, <dossier>, <dossier du dépôt> et <plugin> n’ont ni apostrophe, ni saut de ligne, ni caractère de contrôle ; chaque valeur se cite pour le shell entre apostrophes (\'…\'), dans chaque commande ; une valeur hors forme arrête la fermeture : ne lance aucune commande avec elle, dis-la-moi.'

/** Les dossiers de la liste jetable, exclus par pathspec : la liste des fichiers ignorés ne montre que ce qui reste à juger. */
const DISPOSABLE_DIRS = ['__pycache__', '.show-your-work', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'node_modules']
const IGNORED_FILES = `git -C '<worktree>' ls-files --others --ignored --exclude-standard -- . ${DISPOSABLE_DIRS.map(dir => `':(exclude,glob)**/${dir}/**'`).join(' ')}`

/** La ligne de chaque compte rendu de fermeture : le travail est en sécurité avant tout avertissement. */
const COMMITS_LINE = '« les N commits de <branche> sont dans <branche de travail> (vérifié) ; ils partiront au push de fin de parcours »'

/** La conversation est gardée : elle se reprend par son id complet, plus par `claude attach` une fois retirée. */
const RESUME = 'sa conversation est gardée et se reprend par claude --resume <sessionId> (le champ sessionId de claude agents --json, à relever avant l’arrêt)'

/** Une session de l'app archivée se rouvre dans l'app : sa conversation y reste. */
const APP_RESUME = 'sa conversation est gardée dans l’app, qui la rouvre si on la désarchive (pour la reprendre dans le CLI : claude --resume <sessionId>, si l’app en donne un)'

/** Ce que la fermeture désigne : la cible, en clair, et ce qui reconnaît sa session. */
const describe = (run: Run, target: CloseTarget, seq?: number) => {
  if (target.kind === 'group') {
    const wt = groupWorktree(run, target.id, seq)
    const n = sendNumber(seq)
    // Un envoi suivant : son titre et ses branches portent son numéro, sans les noms d'avant la 0.59.0.
    if (n !== undefined && n > 1) {
      const title = `« ${linkedPrefix(run)}${groupTitle(target.id, n)}»`
      return {
        what: `la session liée du groupe ${target.id} (${target.name}, envoi ${n}) du parcours « ${run.title} »`,
        owner: 'du groupe',
        title,
        titles: title,
        worktree: wt,
        branches: `worktree-${wt} (lancée par le CLI), ${wt} ou claude/${wt}-<suffixe> (lancée par l’app)`,
      }
    }
    return {
      what: `la session liée du groupe ${target.id} (${target.name}) du parcours « ${run.title} »`,
      owner: 'du groupe',
      title: `« ${linkedPrefix(run)}Groupe ${target.id} · »`,
      titles: linkedTitles(run, target.id),
      worktree: wt,
      branches: `worktree-${wt} (lancée par le CLI), ${wt} ou claude/${wt}-<suffixe> (lancée par l’app, avec ou sans branch_name), groupe-${target.id} pour un groupe lancé avant la 0.59.0 ; jamais celles d’un envoi suivant du groupe (${wt}-2, claude/${wt}-2-<suffixe>…), ni une session au titre « Groupe ${target.id} (envoi <n°>) · »`,
    }
  }
  const def = SKILLS[target.skill]
  const label = def?.items?.label ?? 'Éléments'
  const wt = itemsWorktree(run, label, seq)
  const title = `« ${linkedPrefix(run)}${label} · »`
  return {
    what: `la session des ${label.toLowerCase()} de la phase ${def?.label ?? target.skill} du parcours « ${run.title} »`,
    owner: `des ${label.toLowerCase()}`,
    title,
    titles: title,
    worktree: wt,
    branches: `worktree-${wt} (lancée par le CLI), ${wt} ou claude/${wt}-<suffixe> (lancée par l’app)`,
  }
}

/**
 * Ce que Claude rapporte après la procédure, par le champ `closed` de l'outil flow : sans cet envoi,
 * le tableau de bord la lui redemanderait. Rien quand la session travaille encore : la fermeture attend.
 */
export const closedHint = (target: CloseTarget, link?: number): string => {
  // `link` : la session précédente d'un groupe confié de nouveau, désignée par son envoi.
  const key = target.kind === 'group' ? `"group": ${JSON.stringify(target.id)}${link !== undefined ? `, "link": ${link}` : ''}` : `"items": "${target.skill}"`
  return (
    `Then send {"closed": [{${key}, "state": "closed", "sessionId": "<full sessionId>", "branch": "<kept branch>", "worktree": "<removed worktree path>"}]} once closed (the last three when known); ` +
    `"state": "app" with "why" when the user must archive it in the app; "state": "stopped" with "why" when something stopped it (an unknown ignored file, unmerged commits, a review snapshot, an open question); nothing when the session is still working: closing waits for a next call.`
  )
}

/** Ce que copie « ↺ Rouvrir », et les toasts qui le disent (copié, ou à recopier à la main). */
export type ReopenText = { text: string; isApp: boolean; copied: string; uncopied: string }

/** Une session rouverte reste notée fermée : l'état « closed » ne recule jamais (T2). */
const NOT_RECLOSED = 'Une session rouverte ne se referme pas d’office : demande à Claude de la refermer.'

/** git worktree add ne refait pas ce que faisait claude -w au lancement. */
const NEW_WORKTREE = 'Le worktree recréé n’a pas les copies (.worktreeinclude) ni les liens que le lancement y avait mis.'

/**
 * De quoi rouvrir une session liée fermée, sur sa branche gardée et jamais dans le dossier principal :
 * pour le CLI, une commande en une ligne qui vérifie que la branche gardée existe (`show-ref`, qui
 * dit « not a valid ref » sinon), recrée
 * le worktree au chemin noté (sans rien forcer : `git worktree add` échoue sans rien toucher si le
 * chemin existe ou si la branche manque), puis reprend la conversation dedans ; pour l'app (id
 * `local_…`), la même commande sans la reprise, la consigne de la désarchiver passant par le toast :
 * le presse-papiers ne porte que la commande, jamais le titre du parcours, qui n'est pas cité. Rien
 * sans `sessionId` sûr, ni pour l'app sans commande. Chaque champ de la fermeture, lu du tableau de bord
 * (un fichier partagé, peut-être d'avant leur validation), se revérifie ici avant d'entrer dans la commande.
 */
export const reopenText = ({ run, target, closing, session, seq, root }: { run: Run; target: CloseTarget; closing: Closing | undefined; session?: string | undefined; seq?: number | undefined; root: string }): ReopenText | null => {
  if (closing?.state !== 'closed' || !isSessionId(closing.sessionId)) return null
  const id = closing.sessionId
  const isApp = session?.startsWith('local_') === true || id.startsWith('local_')
  // Sans branche ni worktree sûrs, rien à copier, pour le CLI comme pour l'app.
  if (!isSafeBranch(closing.branch) || !isWorktreePath(closing.worktree, root)) return null
  const worktree = closing.worktree.replace(/\\/g, '/').replace(/\/+$/, '')
  const repo = shellQuote(repoDir(root))
  // Un chemin Windows : PowerShell, le terminal par défaut, où « && » n'existe pas avant la 7 ; ailleurs, un shell POSIX.
  const isWindows = /^[A-Za-z]:\//.test(worktree)
  const shell = isWindows ? 'PowerShell' : 'un terminal'
  // Chaque étape seulement si la précédente a réussi : la branche existe (pas une HEAD détachée),
  // le worktree est recréé, on y est entré ; sous PowerShell, Set-Location sans jokers.
  const steps = [
    `git -C ${repo} show-ref --verify ${shellQuote(`refs/heads/${closing.branch}`)}`,
    `git -C ${repo} worktree add ${shellQuote(worktree)} ${shellQuote(closing.branch)}`,
  ]
  const chain = (list: string[]): string => (isWindows ? list.reduceRight((rest, step) => `${step}; if ($?) { ${rest} }`) : list.join(' && '))
  const add = chain(steps)
  // claude --resume ne reprend que le sessionId du CLI (un UUID) : ni l'id court, ni un id local_… de l'app (essai, point 5).
  const command = isConversationId(id)
    ? chain([...steps, isWindows ? `Set-Location -LiteralPath ${shellQuote(worktree)}` : `cd ${shellQuote(worktree)}`, `claude --resume ${shellQuote(id)}`])
    : null
  if (!isApp) {
    if (!command) return null
    return {
      text: command,
      isApp,
      copied: `Commande copiée, à coller dans ${shell} : elle recrée le worktree de la session sur sa branche gardée, puis reprend sa conversation. ${NEW_WORKTREE} ${NOT_RECLOSED}`,
      uncopied: `Copie impossible : recopie cette commande dans ${shell} : ${command}`,
    }
  }
  // Le worktree d'une session fermée a été retiré : le recréer d'abord (la seule chose copiée), puis la désarchiver.
  const unarchive = `Puis désarchive dans l’app Claude Desktop la session dont le titre commence par ${describe(run, target, seq).title} : elle reprend dans ce worktree.`
  return {
    text: add,
    isApp,
    copied: `Commande copiée, à coller dans ${shell} : elle recrée le worktree de la session sur sa branche gardée. ${unarchive} ${NEW_WORKTREE} ${NOT_RECLOSED}`,
    uncopied: `Copie impossible : recopie cette commande dans ${shell} : ${add}. ${unarchive}`,
  }
}


/**
 * La procédure de fermeture d'une session liée rendue, pour Claude dans la discussion du parcours.
 * Dans un dépôt : retrouver la branche et la ligne du worktree, vérifier la fusion, l'arbre, les
 * instantanés de revue et que la session ne travaille pas ; puis arrêter, revérifier, retirer le
 * worktree, `claude rm` sans option. Sans git : vérifier, puis arrêter la session seulement.
 */
export const closingProcedure = ({ run, target, isRepo, session, seq }: CloseInput): string => {
  const d = describe(run, target, seq)
  // Un id ou un nom de worktree hors forme n'entre dans aucune commande : la fermeture s'arrête.
  // Sans git, aucun nom de worktree n'entre dans une commande : seul l'id compte.
  const unsafe =
    session !== undefined && !isSafeId(session)
      ? 'l’id relevé de sa session'
      : isRepo && !isSafeBranch(d.worktree)
        ? `le nom attendu de son worktree (tiré de l’id ${target.kind === 'group' ? 'du groupe' : 'de la phase'})`
        : ''
  if (unsafe !== '')
    return `Ne ferme pas ${d.what} : ${unsafe} n’a pas une forme sûre pour une commande (seulement lettres, chiffres, ., _, / et -, sans - en tête). Ne ferme rien : n’arrête aucune session, ne retire aucun worktree ; dis-le-moi, puis envoie "state": "stopped" avec cette raison.`
  const isApp = session?.startsWith('local_') === true
  const id = session !== undefined ? shellQuote(session) : "'<id>'"
  const busy = 'si elle travaille ("status": "busy", ou "state": "working"), remets la fermeture à plus tard, sans erreur : n’arrête rien, ne retire rien, dis-le-moi en une ligne ; une réponse suivante de l’outil flow la reprendra'
  if (!isRepo) {
    const idle = isApp
      ? `c’est une session de l’app Desktop : ListAgents doit la montrer (« Claude Desktop session », titre qui commence par ${d.titles}) au repos, pas busy ; absente de ListAgents, elle est déjà archivée (déjà fait)`
      : `claude agents --json : son entrée (id ${id}${session ? '' : `, son name commence par ${d.titles}`}) doit porter "status": "idle" ; relève son sessionId ; absente de claude agents --json mais montrée sans pid par claude agents --json --all, elle est déjà arrêtée (déjà fait) ; une session que ListAgents montre en « Claude Desktop session » est de l’app`
    const stop = isApp
      ? `c’est une session de l’app Desktop : archive-la par l’outil de session de l’app s’il t’en donne un (stop_session n’interrompt qu’un tour, il ne l’archive pas) ; sinon, écris-moi en clair d’archiver la session dont le titre commence par ${d.titles} dans la liste des sessions de l’app Claude Desktop`
      : `claude stop ${id} (une session de l’app : comme ci-dessus, archivée dans l’app)`
    return (
      `Ferme ${d.what}, rendue ici ; ce dossier n’a pas de git, donc pas de worktree : la fermeture n’arrête que la session. ` +
      `1) vérifie d’abord que ses tickets sont faits et rendus ici (son compte rendu), et qu’aucune question de son compte rendu ne t’attend ; ` +
      `2) vérifie qu’elle ne travaille plus : ${idle} ; ${busy} ; ` +
      `3) arrête-la : ${stop} ; ` +
      `4) dis-moi ce qui a été fermé : ${isApp ? APP_RESUME : RESUME}.`
    )
  }
  // L'entrée de la session dans claude agents --json n'est retenue que si son cwd est le worktree vérifié.
  const entry = `son entrée dans claude agents --json (${session ? `id ${session}` : `son name commence par ${d.titles}`}), retenue seulement si son cwd est <worktree> ; une autre entrée dont le cwd est dans <worktree> (une autre session au travail dedans) arrête la fermeture`
  const idle = isApp
    ? `c’est une session de l’app Desktop : ListAgents doit la montrer (« Claude Desktop session », titre qui commence par ${d.titles}) au repos, pas busy ; absente de ListAgents, elle est déjà archivée (déjà fait)`
    : `${entry} ; elle doit porter "status": "idle" (le signe est status ; "state": "blocked" d’une session qui a fini ne compte pas) ; ListAgents en second, par son nom, ne doit pas la montrer busy ; relève son sessionId ; absente de claude agents --json mais montrée sans pid par claude agents --json --all, elle est déjà arrêtée (déjà fait) ; absente des deux, et sans ligne dans ListAgents dont le titre commence par ${d.titles}, elle est déjà retirée du CLI (déjà fait) ; une telle ligne (busy ou idle) est une session encore là : seule une session que ListAgents montre en « Claude Desktop session » est de l’app (sans son id, arrête la fermeture et demande-moi)`
  const appGesture = `archive-la par l’outil de session de l’app s’il t’en donne un (stop_session n’interrompt qu’un tour, il ne l’archive pas) ; sinon, écris-moi en clair, sans attendre ma réponse pour continuer le reste du parcours (les autres groupes, pas les points 8 à 10 de cette fermeture, qui attendent « archivée ») : « Archive dans la liste des sessions de l’app Claude Desktop la session dont le titre commence par ${d.titles} ; ses N commits sont tous dans <branche de travail> (vérifié), rien n’est perdu même si l’app parle de changements ; dis-moi « archivée » et je retire son worktree. »`
  const stop = isApp ? `c’est une session de l’app Desktop : ${appGesture}` : `claude stop ${id} ; une session de l’app (point 6) : ${appGesture}`
  return (
    `Ferme ${d.what}, rendue ici, et son worktree. Vérifie d’abord, n’arrête et ne retire qu’ensuite, une commande par étape, lancée dans ce dossier (celui du parcours). ` +
    `${FSMONITOR} ` +
    `Ce qui n’est pas sûr arrête la fermeture et se dit à moi au lieu d’être forcé ; une session déjà arrêtée ou un worktree déjà retiré comptent comme déjà faits, pas comme une erreur ; la fermeture ne fusionne jamais : des commits pas fusionnés arrêtent la fermeture, et le circuit normal (vérifier, fusionner, rendre les comptes) la relancera. ` +
    `${FORMS} ` +
    `0) ses questions : relis son compte rendu ; si une question qu’il pose attend encore une réponse (de moi ou d’ici), ne ferme rien et dis-le-moi ; ` +
    `1) la branche : celle du bloc de git worktree list --porcelain dont la ligne worktree est le cwd de son entrée dans claude agents --json (list_sessions dans l’app Desktop) ; à défaut, l’un des noms connus : ${d.branches} ; une branche que nomme sa note de fin ne s’emploie que si elle est l’une de celles-là, sinon arrête la fermeture et dis-le-moi ; vérifie par git log '<branche>' --oneline -10 que ses commits sont ceux ${d.owner} ; au moindre doute (nom différent, branche sans commit ${d.owner}, un autre parcours), arrête-toi et demande-moi ; ` +
    `2) la ligne du worktree : dans git worktree list --porcelain, le bloc dont la ligne branch est refs/heads/<branche> ; sa ligne worktree donne <worktree>, et note s’il porte locked ; le worktree se désigne toujours par cette ligne, jamais par un chemin deviné ; si <worktree> est ce dossier, ou <branche> la branche sortie ici, arrête la fermeture ; sans bloc pour cette branche, cherche un bloc dont la ligne worktree est le dossier de la session, <dossier> (son cwd dans claude agents --json quand elle tourne encore, list_sessions dans l’app Desktop ; sinon <dossier du dépôt>/.claude/worktrees/${d.worktree}, le worktree de cet envoi : après claude stop, son cwd n’est plus le worktree) : s’il y en a un (HEAD détachée, rebase ou bisect en cours), arrête la fermeture et dis-le-moi ; seulement si aucun bloc ne le porte et que test -e '<dossier>' échoue (le dossier n’existe plus), le worktree est déjà retiré : fais quand même le point 3, puis passe au point 6, sans les points 8, 9 et 10 : pas de claude rm (son worktree n’a pas été vu retiré ici) ; une session du CLI que le point 6 trouve encore dans claude agents y reste : dis-le-moi ; un dossier encore là sans bloc arrête la fermeture : dis-le-moi, ne touche à rien ; ` +
    `3) la fusion : git branch --show-current dans ce dossier donne <branche de travail> ; git branch --merged '<branche de travail>' doit lister <branche> ; sinon, arrête la fermeture et dis-moi combien de commits ne sont pas fusionnés (git log '<branche de travail>..<branche>' --oneline) ; N, le nombre de ses commits que le CLI dit non poussés : git rev-list --count '<branche>' --not --remotes ; ` +
    `4) l’arbre : git -C '<worktree>' status --porcelain --untracked-files=all doit être vide ; puis ${IGNORED_FILES} (les dossiers de la liste, exclus, sont jetables en entier, quel que soit leur contenu) : chaque fichier listé doit être de la ${DISPOSABLE} ; les dossiers de la liste exclus ci-dessus (${DISPOSABLE_DIRS.map(dir => `${dir}/`).join(', ')}) sont jetables en entier, quel que soit leur contenu ; les types générés d’un mod, eux, seulement après ce diff -rq ; un lien, un .pyc ou un .DS_Store le sont où qu’ils soient ; tout autre fichier ignoré, tout fichier modifié ou non suivi arrête la fermeture : liste-les-moi, ne retire rien ; ` +
    `5) les instantanés de revue : git -C '<worktree>' for-each-ref refs/worktree/flow-board/ ; pour chacun, si l’arbre de l’instantané (git -C '<worktree>' rev-parse '<ref>^{tree}') est identique à l’arbre d’un commit déjà dans la branche de travail (cherche-le dans git log '<branche de travail>' --format=%T, filtré sur cet arbre, sans afficher tout l’historique), la fermeture continue, et dis-le dans le compte rendu ; sinon, arrête la fermeture et dis-le-moi ; ` +
    `6) la session ne travaille pas : ${idle} ; ${busy} ; ` +
    `7) seulement si tout tient : arrête la session : ${stop} ; ` +
    `8) une fois la session arrêtée (claude agents --json --all la montre sans pid, en "state": "stopped" ou "done" ; pour l’app, archivée, ce qui vaut « montrée arrêtée »), refais d’abord les deux vérifications de core.fsmonitor, dans ce dossier puis sur le worktree (la session a pu la poser avant son arrêt : une valeur qui n’est pas un booléen arrête la fermeture comme au début), puis les vérifications des points 3, 4 et 5 : un commit pas fusionné, un fichier ou un instantané de plus qu’avant l’arrêt, et tu ne retires rien et me le dis ; ` +
    `9) git worktree unlock '<worktree>', seulement si sa ligne de git worktree list --porcelain porte locked, que la raison du verrou nomme cette session (« claude session <nom> (pid <pid> … » ; <pid> n’a que des chiffres, sinon arrête la fermeture) et que ps -p '<pid>' ne trouve plus ce processus, et une fois la session montrée arrêtée ; un autre verrou (posé à la main, une autre session) arrête la fermeture ; puis git worktree remove '<worktree>', sans aucune option ; la branche reste : ne la supprime pas ; ` +
    (isApp
      ? '10) pas de claude rm : une session de l’app n’est pas dans la liste du CLI ; '
      : `10) dans le CLI, seulement une fois le worktree retiré par cette fermeture (git worktree remove a réussi, git worktree list --porcelain n’a plus de bloc pour <worktree> et test -e '<worktree>' échoue ; sinon arrête-toi) : claude rm ${id}, sans aucune option (une session de l’app, ou déjà retirée du CLI : pas de claude rm ; un worktree constaté déjà retiré au point 2 : pas de claude rm, dis-moi que la session reste dans la liste de claude agents) ; si claude rm refuse pour des commits non poussés, ne force rien : dis-moi que la session reste dans la liste de claude agents, que ses N commits sont tous dans <branche de travail> (vérifié), et qu’un ctrl+x de ma part ne supprimerait que la branche <branche>, pas ces commits ; `) +
    `11) dis-moi ce qui a été fermé et ce qui reste, avec la ligne ${COMMITS_LINE} ; ${isApp ? APP_RESUME : RESUME}.`
  )
}
