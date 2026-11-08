// Fermeture d'un worker rendu (un groupe, ou la session des pistes d'une phase) : le texte
// de la procédure que Claude suit, pour le bouton de repli comme pour la réponse de l'outil flow.
// Fonctions pures. Le mod n'a pas d'API pour arrêter une session ni retirer un worktree : la
// procédure les fait faire à Claude, qui vérifie d'abord, puis seulement arrête et retire.
//
// Invariant : une fermeture ne fait jamais perdre un commit, un fichier modifié ou non suivi, ni la
// conversation d'un worker : un worktree n'est retiré que si sa branche est entièrement
// contenue dans la branche de travail et que son arbre ne contient rien d'autre que des fichiers de
// la liste jetable, vérifié de nouveau après l'arrêt de la session ; la branche n'est jamais
// supprimée par la fermeture ; une session qui travaille encore n'est jamais arrêtée. Le texte de la
// fermeture ne nomme donc jamais une option qui force, ni une suppression de branche, ni une fusion.
// La branche part plus tard, à la validation du compte rendu (`branchCleanupText`), par `git branch -d`.

import type { Closing, Run } from '../types'
import { SKILLS } from './catalog.ts'
import { TITLE_SEPARATOR } from './linked.ts'

/** Longueur au-delà de laquelle le titre de la mission est coupé dans le titre d'un worker. */
const PREFIX_MAX = 28

/**
 * Le début du titre de tout worker : le titre de la mission, raccourci, puis « > » (ASCII :
 * l'app affichait « ' » à la place de « › »). Dans la
 * liste des discussions, les sessions filles d'une même discussion mère se reconnaissent ainsi. Sans
 * guillemets ni `$`, `\`, accent grave : le titre passe aussi dans `claude --bg -n`, cité par `shellQuote`.
 * Sans guillemets « » ni crochets, ni leurs sosies, non plus (les tables de `neutralInPrompt`, après
 * NFKC), ni caractère de contrôle ou invisible : il se cite entre « … » dans les demandes mises dans le prompt.
 */
export const linkedPrefix = (run: Run): string => {
  const clean = run.title
    .normalize('NFKC')
    .replace(INVISIBLES, '')
    .replace(QUOTE_OPEN, '')
    .replace(QUOTE_CLOSE, '')
    .replace(BRACKET_OPEN, '')
    .replace(BRACKET_CLOSE, '')
    .replace(/["`$\\]/g, '')
    .replace(/>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return ''
  if (clean.length <= PREFIX_MAX) return `${clean} ${TITLE_SEPARATOR} `
  const cut = clean.slice(0, PREFIX_MAX)
  const at = cut.lastIndexOf(' ')
  return `${(at > PREFIX_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·–-]+$/, '')}… ${TITLE_SEPARATOR} `
}

/**
 * Le nom court d'une mission dans le nom du worktree d'une session de groupe : `-w groupe-<id>`
 * était entré en collision avec le worktree d'une autre mission. Le préfixe `groupe-` reste :
 * `/stats-board:recap --worktrees` retrouve les sessions d'une mission par les worktrees `groupe-*`.
 */
const WORKTREE_SLUG_MAX = 20
const slugOf = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const shortSlug = (slug: string): string => {
  if (slug.length <= WORKTREE_SLUG_MAX) return slug
  const cut = slug.slice(0, WORKTREE_SLUG_MAX)
  const at = cut.lastIndexOf('-')
  return (at > WORKTREE_SLUG_MAX / 2 ? cut.slice(0, at) : cut).replace(/-+$/, '')
}
const worktreeSlug = (run: Run): string => shortSlug(slugOf(run.title))

/**
 * Le nom court d'une mission dans le worktree de ses groupes. Celui d'une rétro (« Rétrospective ·
 * <sujet> ») se prend sur le sujet, derrière `retro-` : tronqué au premier mot, il donnait
 * `retrospective` à toutes les rétros, et la branche gardée d'un groupe bloquait le même groupe de
 * la rétro suivante. Les worktrees de pistes (`itemsWorktree`) gardent l'ancien nom court.
 */
const groupSlug = (run: Run): string => {
  if (run.entry !== 'retro') return worktreeSlug(run)
  const subject = slugOf(run.title).replace(/^retrospective(?:-|$)/, '')
  return shortSlug(subject ? `retro-${subject}` : 'retro')
}

/**
 * Le worktree d'un groupe : `groupe-<nom court de la mission>-<id>`, `groupe-<id>` pour une mission
 * sans titre ; à partir du deuxième envoi du groupe, son numéro en plus (`-2`, `-3`…) : la branche
 * d'un envoi précédent reste, fermée ou non. Null pour un id hors forme (`isGroupId`), quel que soit
 * l'appelant : aucun nom de worktree ni de branche n'est jamais tiré de lui.
 */
export const groupWorktree = (run: Run, id: unknown, seq?: number): string | null => (isGroupId(id) ? worktreeName(run, id, seq) : null)

/** Le nom du worktree d'un groupe, la place de son id gardée (« <id> ») : le gabarit d'un brief, jamais une commande. */
export const groupWorktreeTemplate = (run: Run): string => worktreeName(run, '<id>')

const worktreeName = (run: Run, id: string, seq?: number): string => {
  const slug = groupSlug(run)
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
 * minuscules, le nom court de la mission et le numéro de l'envoi (`pistes-retro-a-2`) : la branche
 * d'une session fermée reste, un nouvel envoi, de la même mission ou d'une autre, ne bute pas sur
 * elle. Sans numéro (envoi d'avant), le libellé seul.
 */
export const itemsWorktree = (run: Run, label: string, seq?: number): string => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  seq = sendNumber(seq)
  if (seq === undefined) return base
  const slug = worktreeSlug(run)
  return slug ? `${base}-${slug}-${seq}` : `${base}-${seq}`
}

/** Les titres des workers lancés avant le séparateur « > » : l'app y affichait « ' » à la place de « › ». */
export const OLD_SEPARATORS = "« › » ou « ' » à la place de « > » pour une session lancée avant la 0.61.0"

/** Le début du titre du worker d'un groupe, tel que la demande de lancement le fixe (ou sans préfixe, avant la 0.37.0). */
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
  /**
   * Le compte rendu de la session d'un groupe est au relais, entier ou coupé avec son fichier, et déposé par cette
   * session même (son entrée de relais, dont l'id commence par l'id court de son lancement ; jamais pour un id
   * inconnu ou de l'app) : à calculer par `relayedReportAt` de model.ts, jamais d'après le seul compte rendu du
   * groupe. Sans lui, la
   * fermeture ne lance jamais `claude rm`, qui effacerait le dossier de job de la session, peut-être le seul
   * exemplaire du compte rendu. Requis, pour qu'un appelant oublié ne vaille jamais « présent ». Sans effet pour la
   * session des pistes, qui ne dépose pas de compte rendu au relais et n'a donc jamais `claude rm`.
   */
  hasReport: boolean
  /** La fermeture déjà notée pour cet envoi (`closing` de son lien) : gardée faute de compte rendu, elle rend `claude rm` à la suivante. */
  noted?: Closing | null
}

/**
 * La fermeture notée de cet envoi a retiré son worktree en gardant sa session, faute de compte rendu au relais :
 * « stopped », avec pour worktree retiré celui de cet envoi (son nom), comme le point 10 le demande dans ce cas.
 * Dérivé de la fermeture notée, sans champ gardé de plus.
 */
export const isKeptForReport = (run: Run, target: CloseTarget, seq: number | undefined, noted: Closing | null | undefined): boolean => {
  if (target.kind !== 'group' || !isGroupId(target.id)) return false
  if (noted === null || typeof noted !== 'object' || noted.state !== 'stopped' || typeof noted.worktree !== 'string') return false
  const name = describe(run, target, seq).worktree
  const removed = noted.worktree.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? ''
  return name !== '' && removed.toLowerCase() === name.toLowerCase()
}

// Les formes sûres des valeurs qui entrent dans une commande (fermeture, réouverture) : une valeur
// lue du tableau de bord (un fichier partagé) ou rapportée par Claude n'y entre que vérifiée.
// Aucune ne commence par « - » : elle serait lue comme une option.

/**
 * Un id de groupe en forme : lettres et chiffres ASCII, 12 au plus (D1). La seule définition : elle
 * filtre l'entrée de l'outil, et un id hors forme (enregistré avant elle, ou dans un fichier modifié)
 * n'entre ni dans la procédure de fermeture ni dans la suppression des branches.
 */
export const isGroupId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9]{1,12}$/.test(id)

/** La forme d'un id de groupe (et d'un id de piste nouveau), dite en clair, d'après `isGroupId`. */
export const GROUP_ID_FORM = 'ASCII letters and digits, 12 at most'

/** La même forme, en français, pour les textes à la personne et les procédures. */
export const GROUP_ID_FORM_FR = 'lettres et chiffres ASCII, 12 au plus'

/**
 * Les caractères de contrôle et invisibles qu'une valeur recopiée perd, par propriété Unicode : les
 * contrôles (Cc : C0, DEL, C1), les caractères de format (Cf) et tout point ignorable par défaut
 * (Default_Ignorable_Code_Point : espaces sans chasse, marques et renversements de sens, trait d'union
 * conditionnel, sélecteurs de variante, remplissages hangûl, et le bloc U+E0000–E0FFF entier,
 * étiquettes comprises, assignés ou non).
 */
const INVISIBLES = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu

/**
 * Un texte relu mis sur une seule ligne d'arguments (le titre passé à `/rename`) : contrôles, invisibles,
 * bidirectionnels et séparateurs de ligne deviennent des espaces, resserrées.
 */
export const plainArgs = (text: string): string => text.replace(INVISIBLES, ' ').replace(/[\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()

/** Les guillemets « » et leurs sosies (chevrons, guillemets bas), après NFKC : ouvrants, puis fermants. */
const QUOTE_OPEN = /[«‹≪《〈❮⟨⟪❬❰⦑⧼‚„]/g
const QUOTE_CLOSE = /[»›≫》〉❯⟩⟫❭❱⦒⧽]/g

/**
 * Les crochets et leurs sosies : toute ponctuation ouvrante ou fermante d'Unicode (Ps, Pe), lue après
 * les guillemets ; seuls ( ) et { } restent, qui ne ferment ni une citation « … » ni un [id].
 */
const BRACKET_OPEN = /(?![({])\p{Ps}/gu
const BRACKET_CLOSE = /(?![)}])\p{Pe}/gu

/**
 * Le cœur commun de toute neutralisation d'un texte venu du tableau de bord ou d'une autre session,
 * écrit une fois : NFKC (un sosie pleine chasse devient son modèle), fins de ligne montrées « ⏎ »,
 * tabulations en espaces, contrôles et invisibles retirés. `neutralInPrompt` et `neutralRelayed` y
 * ajoutent ce que leur citation demande. Totale : une valeur qui n'est pas du texte (null, un nombre,
 * un objet relu d'un fichier) donne le texte vide, au lieu de lever une erreur.
 */
const neutralCore = (text: unknown): string =>
  (typeof text === 'string' ? text : '')
    .normalize('NFKC')
    .replace(/\r?\n|[\r\v\f\u2028\u2029\u0085]/g, ' ⏎ ')
    .replace(/\t/g, ' ')
    .replace(INVISIBLES, '')

/**
 * Une valeur relue recopiée dans une consigne donnée avec un skill, où seule la ligne fait structure
 * (les faits du compte rendu, la file de /implement) : le cœur commun (`neutralCore`) seul ; elle
 * n'y ouvre aucune ligne, et garde ses guillemets « » et ses « · ».
 */
export const neutralLine = (text: unknown): string => neutralCore(text)

/**
 * Une valeur recopiée dans une demande mise dans le prompt (titre de la mission, id ou libellé d'une
 * piste, description d'une fermeture) : le cœur commun (`neutralCore`), puis ses guillemets « » et
 * leurs sosies montrés “ ”, ses crochets et leurs sosies montrés ( ) : elle ne ferme ni une citation
 * « … », ni un [id], et n'ajoute ni piste ni consigne. Le « · » reste : il ne sépare des sections que
 * dans la réponse de l'outil.
 */
export const neutralInPrompt = (text: unknown): string =>
  neutralCore(text).replace(QUOTE_OPEN, '“').replace(QUOTE_CLOSE, '”').replace(BRACKET_OPEN, '(').replace(BRACKET_CLOSE, ')')

/**
 * Un texte relayé par un worker, cité dans une réponse de l'outil : le cœur commun
 * (`neutralCore`), puis chaque « · » qui ouvre une section de la réponse montré « • » (ses sosies
 * aussi), ses crochets doubles retirés (ils ne ferment pas la citation ⟦ … ⟧), ses « ∥ » montrés
 * « ‖ » (ils ne séparent pas deux comptes rendus) : un texte relayé ne produit jamais une section de
 * la réponse.
 */
export const neutralRelayed = (text: unknown): string =>
  neutralCore(text)
    .replace(/[\u27e6\u27e7\u301a\u301b]/g, '')
    .replace(/[\u00b7\u0387\u2027\u2219\u22c5\u30fb\uff65]/g, '•')
    .replace(/[\u2016\u2225\u2af4]/g, '‖')

/** Une valeur en JSON, tout caractère hors de l'ASCII imprimable échappé (\uXXXX) : elle se recopie exacte, sans rien glisser dans la réponse. */
export const asciiJson = (value: unknown): string =>
  (JSON.stringify(value) ?? 'null').replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

/**
 * Une version de plugin relue d'un `plugin.json` (celle du mod installé ou du dépôt) avant d'entrer dans un
 * texte de l'outil ou de la demande de lancement : x.y.z en chiffres ASCII, un suffixe de préversion court admis.
 */
export const isVersionForm = (value: unknown): value is string => typeof value === 'string' && /^\d{1,4}\.\d{1,5}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,20})?$/.test(value)

/** Un id de session (id court du CLI, `local_…` de l'app) ou de conversation : lettres, chiffres, _ et -. */
export const isSafeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)

/**
 * Un id de question bloquante en forme : lettres et chiffres ASCII, puis aussi `_ : # + . -` (ceux que le
 * mod génère : `sans-suite:review:A#1+B#1`, `relance:A#2`, `illisible-<empreinte>`), 200 au plus ; ni
 * espace, ni virgule, ni « · », ni fin de ligne.
 */
export const isQuestionIdForm = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_:#+.-]{0,199}$/.test(value)

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
 * Le chemin d'un worktree de worker : absolu, sans apostrophe (ni ‘ ’ ‚ ‛, que PowerShell lit
 * comme elle), caractère de contrôle (C0, C1, séparateurs de ligne et de paragraphe U+2028/2029) ni
 * segment `.` ou `..`, et exactement `<dossier du dépôt>/.claude/worktrees/<nom>`, un nom en ASCII
 * (`[a-z0-9][a-z0-9._-]{0,199}`, comme ceux que crée flow-board), autre que la
 * racine elle-même (le manager dans un worktree) ; faux quand la racine du projet est inconnue.
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
 * Le dossier temporaire du système, relu de l'environnement (`TMPDIR`, `TEMP` ou `TMP`), avant qu'il
 * entre dans le chemin d'un brief et dans la commande de lancement qui le cite : absolu (POSIX ou lettre
 * de lecteur, jamais un partage réseau `\\` ou `//`), sans apostrophe (ni ‘ ’ ‚ ‛), guillemet, `$`, accent
 * grave, caractère de contrôle ou invisible, ni segment `.` ou `..`, autre que la racine d'un disque, 300
 * signes au plus. Rendu à barres
 * obliques, sans barre finale ; null hors forme.
 */
export const tempDirForm = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 300) return null
  if (/['"`$\u2018-\u201b\u2028\u2029]/.test(value) || /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(value)) return null
  const path = value.replace(/\\/g, '/')
  if (!/^(?:\/(?!\/)|[A-Za-z]:\/)/.test(path)) return null
  const trimmed = path.replace(/\/+$/, '')
  // La racine d'un disque n'est pas un dossier temporaire.
  if (trimmed === '' || /^[A-Za-z]:$/.test(trimmed)) return null
  if (trimmed.split('/').some((part, i) => part === '.' || part === '..' || (i > 0 && part === ''))) return null
  return trimmed
}

/**
 * Le nom du fichier d'un brief de worker, un par lancement et par groupe :
 * `flow-board-brief-<mission>-<groupe>-<horodatage>.md`, fait des seuls ids contrôlés (`isSafeId`,
 * `isGroupId`) et de l'heure du lancement, jamais du titre ; null hors forme. Le nom entier ne garde
 * que `[A-Za-z0-9._-]`.
 */
export const briefFileName = (runId: unknown, groupId: unknown, at: unknown): string | null => {
  if (!isSafeId(runId) || !isGroupId(groupId) || typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return null
  const name = `flow-board-brief-${runId}-${groupId}-${at}.md`
  return /^[A-Za-z0-9._-]{1,200}$/.test(name) ? name : null
}

/**
 * La première commande d'une fermeture dans un dépôt : `core.fsmonitor` fait exécuter une commande
 * à chaque `git status`, que la procédure lance ensuite dans le worktree.
 */
const FSMONITOR =
  "Avant toute autre commande : git config --get core.fsmonitor dans ce dossier ; si elle affiche autre chose qu’un booléen (true, false, yes, no, on, off, 1, 0 : le démon intégré de git, sans danger), ne ferme rien et ne lance aucune autre commande git : cette valeur est une commande que git status exécuterait ; dis-le-moi, puis envoie \"state\": \"stopped\" avec cette raison. La même vérification se fait sur le worktree, git -C '<worktree>' config --get core.fsmonitor (sa config propre peut la poser), dès que <worktree> est connu et avant toute autre commande git -C '<worktree>'."

/**
 * Une valeur citée pour le shell qui la lira, entre apostrophes. POSIX : chaque apostrophe écrite
 * '\''. PowerShell, qui lit aussi ‘ ’ ‚ ‛ comme des apostrophes : chacune doublée, pour qu'aucune ne
 * ferme la chaîne.
 */
export const shellQuote = (value: string, shell: 'posix' | 'powershell' = 'posix'): string =>
  shell === 'powershell' ? `'${value.replace(/['‘’‚‛]/g, c => c + c)}'` : `'${value.replace(/'/g, `'\\''`)}'`

/**
 * La liste jetable, fermée, validée au cadrage (ses dossiers le sont en entier) : ce qu'un worktree
 * peut emporter sans demander. Les types générés d'un mod (`.claude-plugin/types/`, écrits par Claude
 * Code ou copiés par `scripts/check.sh`) le sont en entier, quelle que soit leur version : ils se
 * régénèrent, et une version différente de celle du clone principal avait arrêté des fermetures.
 */
const DISPOSABLE =
  'liste jetable : les liens symboliques, quelle que soit leur cible (test -L) ; __pycache__/ et *.pyc ; .show-your-work/ ; .pytest_cache/, .mypy_cache/, .ruff_cache/, node_modules/, .DS_Store ; les types générés d’un mod, un dossier .claude-plugin/types/ à toute profondeur, en entier : ils se régénèrent'

/**
 * La forme de chaque valeur avant qu'elle entre dans une commande : une valeur hors forme arrête la
 * fermeture (point (1) du durcissement).
 */
const FORMS =
  'Forme des valeurs, avant toute commande : <branche> ne s’emploie que si elle est l’un des noms connus du point 1 ou la ligne branch exacte d’un bloc de git worktree list --porcelain (sans refs/heads/), et ne contient que [A-Za-z0-9._/-], sans - en tête ; <branche de travail> a la même forme ; <worktree> ne se retire que s’il est sous <dossier du dépôt>/.claude/worktrees/ (<dossier du dépôt> : la ligne worktree du premier bloc de git worktree list --porcelain, le clone principal), chemin absolu sans segment . ni .. ; un <pid> n’a que des chiffres ; <worktree>, <dossier>, <dossier du dépôt> et <plugin> n’ont ni apostrophe, ni saut de ligne, ni caractère de contrôle ; chaque valeur se cite pour le shell entre apostrophes (\'…\'), dans chaque commande ; une valeur hors forme arrête la fermeture : ne lance aucune commande avec elle, dis-la-moi.'

/** Les dossiers de la liste jetable, exclus par pathspec : la liste des fichiers ignorés ne montre que ce qui reste à juger. */
const DISPOSABLE_DIRS = ['__pycache__', '.show-your-work', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'node_modules', '.claude-plugin/types']
const IGNORED_FILES = `git -C '<worktree>' ls-files --others --ignored --exclude-standard -- . ${DISPOSABLE_DIRS.map(dir => `':(exclude,glob)**/${dir}/**'`).join(' ')}`

/** La ligne de chaque compte rendu de fermeture : le travail est en sécurité avant tout avertissement. */
const COMMITS_LINE = '« les N commits de <branche> sont dans <branche de travail> (vérifié) ; ils partiront au push de fin de mission »'

/** La conversation est gardée : elle se reprend par son id complet, plus par `claude attach` une fois retirée. */
const RESUME = 'sa conversation est gardée et se reprend par claude --resume <sessionId> (le champ sessionId de claude agents --json, à relever avant l’arrêt)'

/** Une session de l'app archivée se rouvre dans l'app : sa conversation y reste. */
const APP_RESUME = 'sa conversation est gardée dans l’app, qui la rouvre si on la désarchive (pour la reprendre dans le CLI : claude --resume <sessionId>, si l’app en donne un)'

/**
 * L'accord donné d'avance pour archiver les sessions de l'app que la fermeture a vérifiées : la date de
 * `/flow archive on`, venu d'un geste de la personne (Entrée, Remote Control, message de l'app ; jamais
 * d'un plugin, d'une tâche programmée ni d'une autre session), gardée dans `$.store` et relue par le
 * mod ; null sans accord. L'outil archive_session de l'app ne s'appelle qu'avec un accord explicite pour
 * une session précise : la procédure le cite en nommant la session.
 */
export const archiveConsent: { at: number | null } = { at: null }

/**
 * Le script des vérifications d'une fermeture, `scripts/fermeture.mjs` du plugin installé (la version qui
 * tourne, comme ce texte) : son chemin absolu, posé par le mod au chargement (`$.plugin.root`) ; null sans
 * lui (un test, une racine inconnue), et la procédure se recopie alors en entier.
 */
export const closingScript: { path: string | null } = { path: null }

/**
 * Un chemin de script qui entre dans une commande citée : absolu, en ASCII sûr seulement (lettres, chiffres,
 * . _ ~ + @ - et les séparateurs ; ni espace, ni guillemet, ni caractère du shell), sans segment . ni .. ; sinon la
 * procédure entière se recopie.
 */
export const isScriptPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 400 &&
  /^(?:\/|[A-Za-z]:[\\/])[A-Za-z0-9._~+@\\/-]*[\\/]fermeture\.mjs$/.test(value) &&
  value.split(/[\\/]/).every(part => part !== '.' && part !== '..')

/** La plus grande avance tolérée sur l'horloge pour la date d'un accord relu (horloges de deux processus). */
const CONSENT_SKEW_MS = 60_000

/**
 * La date d'un accord relu du stockage du mod (un fichier sur disque), bornée en ce seul point : un
 * nombre entier entre l'époque et maintenant, à une minute près ; toute autre valeur vaut « pas d'accord ».
 */
export const consentAt = (value: unknown, now: number): number | null => {
  const at = value !== null && typeof value === 'object' ? (value as { at?: unknown }).at : undefined
  return typeof at === 'number' && Number.isSafeInteger(at) && at > 0 && at <= now + CONSENT_SKEW_MS ? at : null
}

/** Le jour d'un accord borné par `consentAt`, en AAAA-MM-JJ. */
export const consentDay = (at: number): string => new Date(at).toISOString().slice(0, 10)

/** Comment Claude archive une session de l'app, avec l'accord donné d'avance ou en le demandant. */
const appArchive = (title: string): string => {
  const at = archiveConsent.at
  if (at !== null)
    return `tu as mon accord pour l’archiver : je l’ai donné d’avance par /flow archive on, le ${consentDay(at)}, pour chaque worker que cette fermeture a vérifié ; il vaut pour la session dont le titre commence par ${title}, ne me le redemande pas : archive-la par l’outil archive_session de l’app, avec une raison (« flow-board : rendue, vérifiée, fusionnée »)`
  return `l’outil d’archivage de l’app demande mon accord pour cette session : demande-le-moi en une ligne, en nommant la session (titre qui commence par ${title}), et dis que /flow archive on, tapé par moi, donne cet accord d’avance pour les fermetures suivantes ; sans attendre ma réponse, continue le reste de la mission (les autres groupes ; la suite de cette fermeture attend l’archivage) ; mon oui donné, archive-la par l’outil archive_session de l’app`
}

/** Ce que la fermeture désigne : la cible, en clair, et ce qui reconnaît sa session. */
const describe = (run: Run, target: CloseTarget, seq?: number) => {
  if (target.kind === 'group') {
    // Un id hors forme n'a pas de nom de worktree : `closingProcedure` et `reopenText` s'arrêtent avant.
    const wt = groupWorktree(run, target.id, seq) ?? ''
    const n = sendNumber(seq)
    // Un envoi suivant : son titre et ses branches portent son numéro, sans les noms d'avant la 0.59.0.
    if (n !== undefined && n > 1) {
      const title = `« ${linkedPrefix(run)}${groupTitle(target.id, n)}»`
      return {
        what: `le worker du groupe ${target.id} (${neutralInPrompt(target.name)}, envoi ${n}) de la mission « ${neutralInPrompt(run.title)} »`,
        owner: 'du groupe',
        title,
        titles: title,
        worktree: wt,
        branches: `worktree-${wt} (lancée par le CLI), ${wt} ou claude/${wt}-<suffixe> (lancée par l’app)`,
      }
    }
    return {
      what: `le worker du groupe ${target.id} (${neutralInPrompt(target.name)}) de la mission « ${neutralInPrompt(run.title)} »`,
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
    what: `la session des ${label.toLowerCase()} de la phase ${def?.label ?? neutralInPrompt(String(target.skill))} de la mission « ${neutralInPrompt(run.title)} »`,
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
  // Un id de groupe hors forme : rien ne se ferme d'ici, seul l'arrêt se rapporte.
  if (target.kind === 'group' && !isGroupId(target.id))
    return `Then send {"closed": [{"group": ${asciiJson(target.id)}${link !== undefined ? `, "link": ${link}` : ''}, "state": "stopped", "why": "id de groupe hors forme"}]}: nothing is closed from here; tell the user why, without offering to close it another way.`
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
 * De quoi rouvrir un worker fermé, sur sa branche gardée et jamais dans le dossier principal :
 * pour le CLI, une commande en une ligne qui vérifie que la branche gardée existe (`show-ref`, qui
 * dit « not a valid ref » sinon), recrée
 * le worktree au chemin noté (sans rien forcer : `git worktree add` échoue sans rien toucher si le
 * chemin existe ou si la branche manque), puis reprend la conversation dedans ; pour l'app (id
 * `local_…`), la même commande sans la reprise, la consigne de la désarchiver passant par le toast :
 * le presse-papiers ne porte que la commande, jamais le titre de la mission, qui n'est pas cité. Rien
 * sans `sessionId` sûr, ni pour l'app sans commande. Chaque champ de la fermeture, lu du tableau de bord
 * (un fichier partagé, peut-être d'avant leur validation), se revérifie ici avant d'entrer dans la commande.
 */
export const reopenText = ({ run, target, closing, session, seq, root }: { run: Run; target: CloseTarget; closing: Closing | undefined; session?: string | undefined; seq?: number | undefined; root: string }): ReopenText | null => {
  // Marquée, sa branche était dans une consigne de suppression partie (séries 18 et 24) : plus rien à
  // rouvrir. Toute marque relue compte, même hors forme : la branche a pu partir.
  if (closing?.state === 'closed' && closing.cleanupAt !== undefined) return null
  if (closing?.state !== 'closed' || !isSessionId(closing.sessionId)) return null
  // Un id de groupe hors forme : aucun titre ni worktree tiré de lui, rien à rouvrir.
  if (target.kind === 'group' && !isGroupId(target.id)) return null
  const id = closing.sessionId
  const isApp = session?.startsWith('local_') === true || id.startsWith('local_')
  // Sans branche ni worktree sûrs, rien à copier, pour le CLI comme pour l'app.
  if (!isSafeBranch(closing.branch) || !isWorktreePath(closing.worktree, root)) return null
  const worktree = closing.worktree.replace(/\\/g, '/').replace(/\/+$/, '')
  // Un chemin Windows : PowerShell, le terminal par défaut, où « && » n'existe pas avant la 7 ; ailleurs, un shell POSIX.
  const isWindows = /^[A-Za-z]:\//.test(worktree)
  const shell = isWindows ? 'PowerShell' : 'un terminal'
  // Chaque valeur citée pour le shell qui la lira (PowerShell lit aussi ‘ ’ ‚ ‛ comme des apostrophes).
  const quote = (value: string): string => shellQuote(value, isWindows ? 'powershell' : 'posix')
  const repo = quote(repoDir(root))
  // Chaque étape seulement si la précédente a réussi : la branche existe (pas une HEAD détachée),
  // le worktree est recréé, on y est entré ; sous PowerShell, Set-Location sans jokers.
  const steps = [
    `git -C ${repo} show-ref --verify ${quote(`refs/heads/${closing.branch}`)}`,
    `git -C ${repo} worktree add ${quote(worktree)} ${quote(closing.branch)}`,
  ]
  const chain = (list: string[]): string => (isWindows ? list.reduceRight((rest, step) => `${step}; if ($?) { ${rest} }`) : list.join(' && '))
  const add = chain(steps)
  // claude --resume ne reprend que le sessionId du CLI (un UUID) : ni l'id court, ni un id local_… de l'app (essai, point 5).
  const command = isConversationId(id)
    ? chain([...steps, isWindows ? `Set-Location -LiteralPath ${quote(worktree)}` : `cd ${quote(worktree)}`, `claude --resume ${quote(id)}`])
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
 * Une fermeture relue du tableau de bord (un fichier partagé) : un objet, tel quel, sinon aucune. Le
 * plan de la consigne de suppression et sa marque (`markCleanupSent`, link.ts) la lisent par ce seul garde.
 */
export const readClosing = (value: unknown): Closing | undefined => (value !== null && typeof value === 'object' ? (value as Closing) : undefined)

/** Les sessions précédentes d'un groupe confié de nouveau, relues : une liste, ou une seule entrée d'avant. */
const earlierLinks = (value: unknown): { seq?: number; closing?: Closing }[] =>
  (Array.isArray(value) ? value : value ? [value] : []).filter(x => x !== null && typeof x === 'object')

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * La branche notée porte l'un des noms que flow-board donne à la session de cette cible (série 22) :
 * `worktree-<worktree>` (CLI), `<worktree>` ou `claude/<worktree>-<suffixe>` (app, un suffixe sans
 * « - »), et `groupe-<id>` pour le premier
 * envoi d'un groupe lancé avant la 0.59.0. La session des pistes gardée à côté du lien n'a pas noté
 * son numéro d'envoi : sans lui, tout numéro de cette mission est admis, ou le libellé seul (envoi d'avant la numérotation).
 */
export const isOwnBranch = (run: Run, target: CloseTarget, seq: unknown, branch: string): boolean => {
  const n = sendNumber(seq)
  // `cli` : le worktree tel qu'en worktree-<…> et <…> ; `app` : celui avant le suffixe de claude/<…>-<suffixe>.
  let cli: string
  let app: string
  let legacy = ''
  if (target.kind === 'group') {
    cli = app = escapeRe(groupWorktree(run, target.id, n) ?? '')
    if ((n ?? 1) === 1) legacy = `|groupe-${escapeRe(target.id)}`
  } else {
    const label = SKILLS[target.skill]?.items?.label ?? 'Éléments'
    const slug = worktreeSlug(run)
    // Sans numéro, la branche de l'app n'a que sa forme numérotée : « claude/pistes-<suffixe> » serait celle d'une autre mission.
    app = n !== undefined ? escapeRe(itemsWorktree(run, label, n)) : `${escapeRe(itemsWorktree(run, label))}-${slug ? `${escapeRe(slug)}-` : ''}[0-9]{1,5}`
    cli = n !== undefined ? app : `${escapeRe(itemsWorktree(run, label))}(?:-${slug ? `${escapeRe(slug)}-` : ''}[0-9]{1,5})?`
  }
  // Le suffixe de l'app sans « - » ni seulement des chiffres : il ne prolonge ni le nom d'un envoi
  // suivant (`-2`, `-2-…`), ni celui d'un autre groupe ou d'une autre mission.
  return new RegExp(`^(?:(?:worktree-)?${cli}|claude/${app}-(?![0-9]+$)[A-Za-z0-9._]+${legacy})$`).test(branch)
}

/** Ce que devient la branche d'un worker à la validation du compte rendu : supprimée par -d si notée sur une fermeture « closed » sous un nom de la cible, gardée sinon, avec la raison. */
export const branchFate = (run: Run, target: CloseTarget, seq: unknown, closing: Closing | undefined): { branch: string } | { kept: string } => {
  if (closing?.state === 'closed') {
    if (target.kind === 'group' && !isGroupId(target.id)) return { kept: 'fermé, id de groupe hors forme, branche gardée' }
    if (closing.branch === undefined) return { kept: 'fermé, branche inconnue, gardée' }
    // Ni un pseudo-ref (ORIG_HEAD…), ni un nom qui imite un espace de refs (tags/…) : la suppression ne vise que refs/heads.
    if (!isSafeBranch(closing.branch) || /(?:^|\/)[A-Z_]*_HEAD$|^(?:heads|tags|remotes)\//.test(closing.branch)) return { kept: 'fermé, branche notée hors forme, gardée' }
    if (!isOwnBranch(run, target, seq, closing.branch)) return { kept: 'fermé, nom de branche inattendu (pas celui de cette session), gardée' }
    return { branch: closing.branch }
  }
  if (closing?.state === 'app') return { kept: 'à archiver dans l’app, branche gardée' }
  if (closing?.state === 'stopped') return { kept: 'fermeture arrêtée, branche gardée' }
  return { kept: 'pas fermé, branche gardée' }
}

/**
 * Le dossier de la mission (la racine du tableau de bord), tel qu'il entre dans `git -C` : absolu, sans
 * apostrophe (droite ou typographique), guillemet « » et leurs sosies (ils encadrent les commandes de la
 * consigne), chevron < > (il imiterait le marqueur <branche de travail>),
 * caractère de contrôle ni segment `.` ou `..` ; un « \\ » seulement dans un chemin Windows (ailleurs,
 * c'est un caractère du nom : le convertir viserait un autre dossier) ; sinon rien.
 */
const runFolder = (root: unknown): string | undefined => {
  if (typeof root !== 'string' || root.length > 400 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029'\u2018-\u201b«»‹›<>≪≫《》〈〉❮❯]/.test(root)) return undefined
  if (root.includes('\\') && !/^[A-Za-z]:\\/.test(root)) return undefined
  const path = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!/^(?:\/|[A-Za-z]:\/)./.test(path) || path.split('/').some(part => part === '.' || part === '..')) return undefined
  return path
}

type CleanupInput = { run: Run; isRepo: boolean; root: unknown }

/**
 * Ce que la validation du compte rendu fait des branches des workers de la mission (groupes, leurs
 * envois précédents, sessions des pistes) : à supprimer, une branche notée sur une fermeture « closed »
 * sous un nom de sa session (séries 18 et 22), le dossier de la mission connue ; gardées, les autres, avec la raison.
 */
const cleanupPlan = ({ run, isRepo, root }: CleanupInput): { folder: string | undefined; toDelete: Map<string, string[]>; kept: string[] } => {
  const folder = runFolder(root)
  const toDelete = new Map<string, string[]>()
  const kept: string[] = []
  if (!isRepo) return { folder, toDelete, kept }
  const note = (who: string, target: CloseTarget, seq: unknown, closing: unknown) => {
    const fate = branchFate(run, target, seq, readClosing(closing))
    if ('kept' in fate) kept.push(`${who} : ${fate.kept}`)
    else if (folder === undefined) kept.push(`${who} : fermé, dossier de la mission hors forme, branche gardée`)
    else toDelete.set(fate.branch, [...(toDelete.get(fate.branch) ?? []), who])
  }
  const sent = (seq: unknown) => {
    const n = sendNumber(seq)
    return n !== undefined && n > 1 ? `, envoi ${n}` : ''
  }
  // Relus d'un fichier partagé : une entrée qui n'est pas un objet est ignorée, sans rien faire tomber.
  const isEntry = <T,>(x: T | null | undefined): x is T => x !== null && typeof x === 'object'
  for (const [rank, g] of (Array.isArray(run.groups) ? run.groups : []).filter(isEntry).entries()) {
    const link = isEntry(g.delegated) ? g.delegated : undefined
    // Ni le nom du groupe ni un id hors forme, du texte libre relu du tableau de bord, n'entrent entre les
    // commandes ; deux groupes hors forme se distinguent par leur rang dans le plan.
    const who = (seq: unknown) => `groupe ${isGroupId(g.id) ? g.id : `(id hors forme, ${rank + 1}e groupe du plan)`}${sent(seq)}`
    const target = { kind: 'group', id: g.id, name: g.name } as const
    for (const prev of earlierLinks(link?.earlier)) note(who(prev.seq), target, prev.seq, prev.closing)
    if (link) note(who(link.seq), target, link.seq, link.closing)
    if (isEntry(g.linked)) note(who(g.linked.seq), target, g.linked.seq, undefined)
  }
  for (const phase of (Array.isArray(run.phases) ? run.phases : []).filter(isEntry)) {
    const label = SKILLS[phase.skill]?.items?.label
    if (!label) continue
    const who = (seq: unknown) => `${label.toLowerCase()} de la phase ${SKILLS[phase.skill]!.label}${sent(seq)}`
    const target = { kind: 'items', skill: phase.skill } as const
    if (isEntry(phase.linkedEarlier)) note(who(phase.linkedEarlier.seq), target, phase.linkedEarlier.seq, phase.linkedEarlier.closing)
    if (isEntry(phase.linked) && phase.linked.session) note(who(phase.linked.seq), target, phase.linked.seq, phase.linked.closing)
  }
  return { folder, toDelete, kept }
}


/**
 * Ce que le message de « ✓ Valider le rapport » dit des branches. Avec une branche à supprimer, la
 * consigne : chaque branche vérifiée sortie par aucun worktree et contenue dans la branche de travail,
 * puis supprimée par `git branch -d`, jamais `-D` ni `--force`, chaque commande écrite en entier, par
 * `git -C '<dossier de la mission>'`. Sans branche à supprimer mais avec des branches gardées, leur seul
 * bilan, sans commande (série 23). Rien sans git, ni sans worker. Invariant : une validation du
 * compte rendu ne supprime jamais une branche qui n'est pas entièrement contenue dans la branche de
 * travail, ni une branche qui n'est pas celle notée pour une session fermée de la mission ; une branche
 * refusée par git reste, et elle est dite.
 */
export const branchCleanupText = (input: CleanupInput): string | null => branchCleanup(input)?.text ?? null

/**
 * Le texte de `branchCleanupText` et les branches que sa consigne vise, tirés d'un même plan : leurs
 * fermetures se marquent une fois le message entré dans la session (série 24) ; un bilan sans consigne n'en vise aucune.
 */
export const branchCleanup = (input: CleanupInput): { text: string; branches: string[] } | null => {
  const { folder, toDelete, kept } = cleanupPlan(input)
  const keptList = `${kept.join(' ; ')}.`
  if (toDelete.size === 0 || folder === undefined)
    return kept.length > 0 ? { text: `Aucune branche de worker à supprimer pour cette mission. Gardées, sans aucune commande : ${keptList} Redis-les-moi en une liste, avant la suite.`, branches: [] } : null
  const git = `git -C ${shellQuote(folder)}`
  // Chaque commande entre « », écrite en entier, citée, par refs/heads (un tag du même nom ne répond
  // pas à sa place) : aucune ne se lit comme une suite de commandes du shell.
  const lines = [...toDelete].map(([branch, whos]) => {
    const ref = shellQuote(`refs/heads/${branch}`)
    return `${shellQuote(branch)} (${whos.join(' ; ')}) : a) « ${git} show-ref --verify --quiet ${ref} », puis b) « ${git} merge-base --is-ancestor ${ref} 'refs/heads/<branche de travail>' », puis c) « ${git} branch -d ${shellQuote(branch)} »`
  })
  const text =
    `Le compte rendu validé, supprime les branches des workers fermés de cette mission, et elles seules, celles de la liste ci-dessous, jamais une autre. ` +
    `Une commande à la fois, jamais enchaînées, toutes par ${git} (le dossier de la mission, quel que soit ton dossier courant) : 1) « ${git} branch --show-current » donne <branche de travail> ; rien (HEAD détachée), ou un nom qui n’a pas que [A-Za-z0-9._/-] ou commence par - : ne supprime rien et dis-le-moi ; ` +
    `2) « ${git} worktree list --porcelain », lue une fois : une branche de la liste qu’une ligne branch refs/heads/<branche> porte (un worktree l’a sortie, le dossier de la mission compris) est gardée, sans autre commande ; ` +
    `3) pour chaque autre branche, ses commandes a, b, c telles qu’écrites, <branche de travail> mis à sa place, chacune seulement si la précédente a rendu 0 : a) rend 1 : elle n’existe plus, déjà supprimée, passe à la suivante ; un autre code (une erreur de git) : garde-la, inconnue ; b) rend autre chose que 0 : ses commits ne sont pas tous dans <branche de travail>, garde-la ; c) la suppression par -d, sans aucune autre option : si git refuse, la branche reste, ne la force d’aucune façon, et garde son message. Une commande que ton garde-fou refuse, ou qui ne tourne pas : ne la réécris pas (ni sans -C, ni autrement), ne supprime rien de plus et dis-le-moi. ` +
    `Branches : ${lines.join(' — ')}. ` +
    (kept.length > 0 ? `Gardées, sans aucune commande : ${keptList} ` : '') +
    `Puis dis-moi en une liste, avant la suite, ce qui est supprimé, déjà supprimé, gardé (avec la raison, le message de git quand il refuse) et inconnu.`
  return { text, branches: [...toDelete.keys()] }
}

/** La fin d'un refus de fermeture : rien ne se ferme, et l'arrêt se rapporte. */
const CLOSE_NOTHING = 'Ne ferme rien : n’arrête aucune session, ne retire aucun worktree ; dis-le-moi, puis envoie "state": "stopped" avec cette raison.'

/**
 * Les noms connus de la branche d'un envoi, passés au script (il reconnaît aussi claude/<nom>-<suffixe>, celle
 * de l'app) : jamais ceux d'un envoi suivant ; `groupe-<id>` seulement au premier envoi d'un groupe (avant la 0.59.0).
 */
const knownBranches = (target: CloseTarget, worktree: string, seq?: number): string[] => {
  const n = sendNumber(seq)
  return [`worktree-${worktree}`, worktree, ...(target.kind === 'group' && (n === undefined || n <= 1) ? [`groupe-${target.id}`] : [])]
}

/**
 * La procédure d'une fermeture dans un dépôt, quand le script de vérification est là (`closingScript`) : la
 * commande qui vérifie (lecture seule) et les gestes à faire sur son verdict, au lieu des 11 000 caractères de
 * la procédure entière. Les mêmes gardes : rien d'arrêté sans « SÛR », rien de retiré sans « SÛR » de la même
 * commande relancée après l'arrêt (`--apres-arret`), la branche jamais supprimée, `claude rm` selon le relais.
 */
const scriptProcedure = (d: ReturnType<typeof describe>, target: CloseTarget, script: string, session: string | undefined, seq: number | undefined, isApp: boolean, isKept: boolean, hasReport: boolean): string => {
  const cmd = `node ${shellQuote(script)} --worktree ${shellQuote(d.worktree)} ${knownBranches(target, d.worktree, seq).map(b => `--branche ${shellQuote(b)}`).join(' ')}${session ? ` --session ${shellQuote(session)}` : ''}`
  const id = session !== undefined ? shellQuote(session) : "'<id>'"
  const gone = isKept
    ? 'retiré par la fermeture précédente, gardée faute de compte rendu (il est maintenant au relais) : passe au point 3'
    : 'pas de claude rm (le worktree n’a pas été vu retiré ici) ; dis-moi ce qui reste'
  const removal = isApp
    ? '3) pas de claude rm : une session de l’app n’est pas dans la liste du CLI ; '
    : target.kind === 'items'
      ? '3) pas de claude rm : la session des pistes ne dépose pas son compte rendu au relais ; '
      : !hasReport
        ? `3) pas de claude rm : le relais n’a pas son compte rendu ; demande-le-lui (SendMessage), la session est gardée ; rapporte "state": "stopped", "why": "compte rendu absent du relais : session gardée", avec "worktree" et "sessionId" ; `
        : `3) seulement une fois le retrait constaté (la même commande relancée rend DÉJÀ RETIRÉ) : claude rm ${id}, sans aucune option ; s’il refuse pour des commits non poussés, ne force rien et dis-le-moi ; `
  return (
    `Ferme ${d.what} et son worktree par le script de vérification, qui ne fait que lire ; rien n’est forcé, la fermeture ne fusionne jamais. ` +
    `0) si une question de son compte rendu attend encore une réponse, ne ferme rien et dis-le-moi ; ` +
    `1) dans ce dossier, lance ${cmd} : sa première ligne est le verdict, sa dernière (« suite : ») le seul geste à faire ; sans verdict en première ligne (node ou le script introuvable) : rien n’est sûr, envoie "state": "stopped" avec sa sortie ; sur SÛR, reconnais d’abord dans les commits qu’il liste ceux ${d.owner} (au moindre doute, demande-moi) ; DÉJÀ RETIRÉ dès ce premier lancement : ${gone} ; ` +
    (isApp
      ? `2) seulement quand sa dernière ligne le demande (sur SÛR, ou sur DÉJÀ RETIRÉ) et une fois ListAgents la montrant au repos (busy : n’arrête rien, remets la fermeture à plus tard), arrêter une session de l’app, c’est l’archiver : si l’app te donne l’outil archive_session, ${appArchive(d.title)} ; sinon, demande-moi en clair de l’archiver (titre qui commence par ${d.titles}) et de te dire « archivée », sans attendre pour le reste de la mission ; puis `
      : '2) après l’arrêt fait sur SÛR, ') +
    `la même commande avec --apres-arret : seulement sur SÛR, la commande de retrait qu’il imprime ; la branche reste : ne la supprime pas ; ` +
    removal +
    `4) dis-moi ce qui a été fermé et ce qui reste, avec la ligne ${COMMITS_LINE} ; ${isApp ? APP_RESUME : RESUME}.`
  )
}

/**
 * La procédure de fermeture d'un worker rendu, pour Claude dans la discussion de la mission.
 * Dans un dépôt : retrouver la branche et la ligne du worktree, vérifier la fusion, l'arbre, les
 * instantanés de revue et que la session ne travaille pas ; puis arrêter, revérifier, retirer le
 * worktree, `claude rm` sans option, seulement avec le compte rendu de la session au relais (`hasReport`) et jamais
 * pour une session de l'app ou de pistes ; un worktree déjà retiré au départ ne mène à `claude rm` que s'il l'a été
 * par la fermeture précédente, gardée faute de compte rendu (`isKeptForReport`). Sans git : vérifier, puis arrêter
 * la session seulement.
 */
export const closingProcedure = ({ run, target, isRepo, session, seq, hasReport, noted }: CloseInput): string => {
  // Un id de groupe hors forme : le titre de sa session, le nom de son worktree et de sa branche en
  // seraient tirés. Rien n'en est écrit, pas même l'id : la fermeture s'arrête, avec git comme sans
  // (invariant : aucun worktree ni branche tiré de lui).
  if (target.kind === 'group' && !isGroupId(target.id))
    return `Ne ferme pas le worker d’un groupe de la mission « ${neutralInPrompt(run.title)} » : son id n’a pas la forme d’un id de groupe (${GROUP_ID_FORM_FR}), et le titre de sa session, le nom de son worktree et celui de sa branche en seraient tirés. ${CLOSE_NOTHING}`
  const d = describe(run, target, seq)
  // Un id ou un nom de worktree hors forme n'entre dans aucune commande : la fermeture s'arrête.
  // Sans git, aucun nom de worktree n'entre dans une commande : seul l'id compte.
  const unsafe =
    session !== undefined && !isSafeId(session)
      ? 'l’id relevé de sa session'
      : isRepo && !isSafeBranch(d.worktree)
        ? `le nom attendu de son worktree (tiré de la phase ; celui d’un groupe l’est d’un id déjà vérifié)`
        : ''
  if (unsafe !== '')
    return `Ne ferme pas ${d.what} : ${unsafe} n’a pas une forme sûre pour une commande (seulement lettres, chiffres, ., _, / et -, sans - en tête). ${CLOSE_NOTHING}`
  const isApp = session?.startsWith('local_') === true
  const id = session !== undefined ? shellQuote(session) : "'<id>'"
  const busy = 'si elle travaille ("status": "busy", ou "state": "working"), remets la fermeture à plus tard, sans erreur : n’arrête rien, ne retire rien, dis-le-moi en une ligne ; une réponse suivante de l’outil flow la reprendra'
  if (!isRepo) {
    const idle = isApp
      ? `c’est une session de l’app Desktop : ListAgents doit la montrer (« Claude Desktop session », titre qui commence par ${d.titles}) au repos, pas busy ; absente de ListAgents, elle est déjà archivée (déjà fait)`
      : `claude agents --json : son entrée (id ${id}${session ? '' : `, son name commence par ${d.titles}`}) doit porter "status": "idle" ; relève son sessionId ; absente de claude agents --json mais montrée sans pid par claude agents --json --all, elle est déjà arrêtée (déjà fait) ; une session que ListAgents montre en « Claude Desktop session » est de l’app`
    const stop = isApp
      ? `c’est une session de l’app Desktop : si l’app te donne l’outil archive_session, ${appArchive(d.title)} (stop_session n’interrompt qu’un tour, il ne l’archive pas) ; sinon, écris-moi en clair d’archiver la session dont le titre commence par ${d.titles} dans la liste des sessions de l’app Claude Desktop`
      : `claude stop ${id} (une session de l’app : comme ci-dessus, archivée dans l’app)`
    return (
      `Ferme ${d.what}, rendue ici ; ce dossier n’a pas de git, donc pas de worktree : la fermeture n’arrête que la session. ` +
      `1) vérifie d’abord que ses tickets sont faits et rendus ici (son compte rendu), et qu’aucune question de son compte rendu ne t’attend ; ` +
      `2) vérifie qu’elle ne travaille plus : ${idle} ; ${busy} ; ` +
      `3) arrête-la : ${stop} ; ` +
      `4) dis-moi ce qui a été fermé : ${isApp ? APP_RESUME : RESUME}.`
    )
  }
  // Le script des vérifications là (le plugin installé) : sa commande et les gestes, pas la procédure entière.
  const script = closingScript.path
  if (isScriptPath(script)) return scriptProcedure(d, target, script, session, seq, isApp, !isApp && hasReport && isKeptForReport(run, target, seq, noted), hasReport)
  // L'entrée de la session dans claude agents --json n'est retenue que si son cwd est le worktree vérifié.
  const entry = `son entrée dans claude agents --json (${session ? `id ${session}` : `son name commence par ${d.titles}`}), retenue seulement si son cwd est <worktree> ; une autre entrée dont le cwd est dans <worktree> (une autre session au travail dedans) arrête la fermeture`
  const idle = isApp
    ? `c’est une session de l’app Desktop : ListAgents doit la montrer (« Claude Desktop session », titre qui commence par ${d.titles}) au repos, pas busy ; absente de ListAgents, elle est déjà archivée (déjà fait)`
    : `${entry} ; elle doit porter "status": "idle" (le signe est status ; "state": "blocked" d’une session qui a fini ne compte pas) ; ListAgents en second, par son nom, ne doit pas la montrer busy ; relève son sessionId ; absente de claude agents --json mais montrée sans pid par claude agents --json --all, elle est déjà arrêtée (déjà fait) ; absente des deux, et sans ligne dans ListAgents dont le titre commence par ${d.titles}, elle est déjà retirée du CLI (déjà fait) ; une telle ligne (busy ou idle) est une session encore là : seule une session que ListAgents montre en « Claude Desktop session » est de l’app (sans son id, arrête la fermeture et demande-moi)`
  const appGesture = `si l’app te donne l’outil archive_session, ${appArchive(d.title)} (stop_session n’interrompt qu’un tour, il ne l’archive pas) ; sinon, écris-moi en clair, sans attendre ma réponse pour continuer le reste de la mission (les autres groupes, pas les points 8 à 10 de cette fermeture, qui attendent « archivée ») : « Archive dans la liste des sessions de l’app Claude Desktop la session dont le titre commence par ${d.titles} ; ses N commits sont tous dans <branche de travail> (vérifié), rien n’est perdu même si l’app parle de changements ; dis-moi « archivée » et je retire son worktree. »`
  const stop = isApp ? `c’est une session de l’app Desktop : ${appGesture}` : `claude stop ${id} ; une session de l’app (point 6) : ${appGesture}`
  // Invariant : la fermeture ne lance jamais `claude rm` sur une session dont le compte rendu n'est pas au relais.
  // Sans lui, les points 0 à 9 restent (fusion vérifiée, session arrêtée, worktree retiré) et la session est gardée ;
  // la fermeture suivante, son compte rendu arrivé, la retire du CLI malgré son worktree déjà retiré par celle-ci.
  const isKept = !isApp && hasReport && isKeptForReport(run, target, seq, noted)
  const alreadyGone = isKept
    ? 'le worktree est déjà retiré, par la fermeture précédente de cette session, notée, qui l’a gardée faute de compte rendu au relais (il l’a maintenant) : fais quand même le point 3, puis passe au point 6 (une session montrée arrêtée : déjà fait) et au point 7 (déjà arrêtée : déjà fait), sans les points 8 et 9, puis le point 10 ; '
    : 'le worktree est déjà retiré : fais quand même le point 3, puis passe au point 6, sans les points 8, 9 et 10 : pas de claude rm (son worktree n’a pas été vu retiré ici) ; une session du CLI que le point 6 trouve encore dans claude agents y reste : dis-le-moi ; '
  const unpushed = `si claude rm refuse pour des commits non poussés, ne force rien : dis-moi que la session reste dans la liste de claude agents, que ses N commits sont tous dans <branche de travail> (vérifié), et qu’un ctrl+x de ma part ne supprimerait que la branche <branche>, pas ces commits ; `
  const removal = isApp
    ? '10) pas de claude rm : une session de l’app n’est pas dans la liste du CLI ; '
    : target.kind === 'items'
      ? '10) pas de claude rm : la session des pistes ne dépose pas son compte rendu au relais, et claude rm effacerait son dossier de job ; dis-moi que la session reste dans la liste de claude agents ; '
      : !hasReport
        ? `10) pas de claude rm : le relais n’a pas son compte rendu ; demande-le-lui (SendMessage) ; la fermeture se repropose d'elle-même quand il arrive au relais, ou la personne la relance par « ↻ Relancer la fermeture » (claude rm effacerait son dossier de job, peut-être le seul exemplaire de ce compte rendu : la session est gardée) ; rapporte cette fermeture en "state": "stopped", pas "closed" (la session reste), avec "why": "compte rendu absent du relais : session gardée", "worktree": "<le worktree retiré>" et "sessionId" ; une fois son compte rendu au relais, la fermeture se repropose et la suivante lance claude rm ; `
        : isKept
          ? `10) dans le CLI, seulement si le point 2 a constaté le worktree retiré par la fermeture précédente (git worktree list --porcelain n’a aucun bloc pour <dossier> et test -e '<dossier>' échoue ; sinon arrête-toi) : claude rm ${id}, sans aucune option (déjà retirée du CLI : pas de claude rm) ; ${unpushed}`
          : `10) dans le CLI, seulement une fois le worktree retiré par cette fermeture (git worktree remove a réussi, git worktree list --porcelain n’a plus de bloc pour <worktree> et test -e '<worktree>' échoue ; sinon arrête-toi) : claude rm ${id}, sans aucune option (une session de l’app, ou déjà retirée du CLI : pas de claude rm ; un worktree constaté déjà retiré au point 2 : pas de claude rm, dis-moi que la session reste dans la liste de claude agents) ; ${unpushed}`
  return (
    `Ferme ${d.what}, rendue ici, et son worktree. Vérifie d’abord, n’arrête et ne retire qu’ensuite, une commande par étape, lancée dans ce dossier (celui de la mission). ` +
    `${FSMONITOR} ` +
    `Ce qui n’est pas sûr arrête la fermeture et se dit à moi au lieu d’être forcé ; une session déjà arrêtée ou un worktree déjà retiré comptent comme déjà faits, pas comme une erreur ; la fermeture ne fusionne jamais : des commits pas fusionnés arrêtent la fermeture, et le circuit normal (vérifier, fusionner, rendre les comptes) la relancera. ` +
    `${FORMS} ` +
    `0) ses questions : relis son compte rendu ; si une question qu’il pose attend encore une réponse (de moi ou d’ici), ne ferme rien et dis-le-moi ; ` +
    `1) la branche : celle du bloc de git worktree list --porcelain dont la ligne worktree est le cwd de son entrée dans claude agents --json (list_sessions dans l’app Desktop) ; à défaut, l’un des noms connus : ${d.branches} ; une branche que nomme sa note de fin ne s’emploie que si elle est l’une de celles-là, sinon arrête la fermeture et dis-le-moi ; vérifie par git log '<branche>' --oneline -10 que ses commits sont ceux ${d.owner} ; au moindre doute (nom différent, branche sans commit ${d.owner}, une autre mission), arrête-toi et demande-moi ; ` +
    `2) la ligne du worktree : dans git worktree list --porcelain, le bloc dont la ligne branch est refs/heads/<branche> ; sa ligne worktree donne <worktree>, et note s’il porte locked ; le worktree se désigne toujours par cette ligne, jamais par un chemin deviné ; si <worktree> est ce dossier, ou <branche> la branche sortie ici, arrête la fermeture ; sans bloc pour cette branche, cherche un bloc dont la ligne worktree est le dossier de la session, <dossier> (son cwd dans claude agents --json quand elle tourne encore, list_sessions dans l’app Desktop ; sinon <dossier du dépôt>/.claude/worktrees/${d.worktree}, le worktree de cet envoi : après claude stop, son cwd n’est plus le worktree) : s’il y en a un (HEAD détachée, rebase ou bisect en cours), arrête la fermeture et dis-le-moi ; seulement si aucun bloc ne le porte et que test -e '<dossier>' échoue (le dossier n’existe plus), ${alreadyGone}un dossier encore là sans bloc arrête la fermeture : dis-le-moi, ne touche à rien ; ` +
    `3) la fusion : git branch --show-current dans ce dossier donne <branche de travail> ; git branch --merged '<branche de travail>' doit lister <branche> ; sinon, arrête la fermeture et dis-moi combien de commits ne sont pas fusionnés (git log '<branche de travail>..<branche>' --oneline) ; N, le nombre de ses commits que le CLI dit non poussés : git rev-list --count '<branche>' --not --remotes ; ` +
    `4) l’arbre : git -C '<worktree>' status --porcelain --untracked-files=all doit être vide ; puis ${IGNORED_FILES} (les dossiers de la liste, exclus, sont jetables en entier, quel que soit leur contenu) : chaque fichier listé doit être de la ${DISPOSABLE} ; les dossiers de la liste exclus ci-dessus (${DISPOSABLE_DIRS.map(dir => `${dir}/`).join(', ')}) sont jetables en entier, quel que soit leur contenu ; un lien, un .pyc ou un .DS_Store le sont où qu’ils soient ; tout autre fichier ignoré, tout fichier modifié ou non suivi arrête la fermeture : liste-les-moi, ne retire rien ; ` +
    `5) les instantanés de revue : git -C '<worktree>' for-each-ref refs/worktree/flow-board/ ; pour chacun, si l’arbre de l’instantané (git -C '<worktree>' rev-parse '<ref>^{tree}') est identique à l’arbre d’un commit déjà dans la branche de travail (cherche-le dans git log '<branche de travail>' --format=%T, filtré sur cet arbre, sans afficher tout l’historique), la fermeture continue, et dis-le dans le compte rendu ; sinon, arrête la fermeture et dis-le-moi ; ` +
    `6) la session ne travaille pas : ${idle} ; ${busy} ; ` +
    `7) seulement si tout tient : arrête la session : ${stop} ; ` +
    `8) une fois la session arrêtée (claude agents --json --all la montre sans pid, en "state": "stopped" ou "done" ; pour l’app, archivée, ce qui vaut « montrée arrêtée »), refais d’abord les deux vérifications de core.fsmonitor, dans ce dossier puis sur le worktree (la session a pu la poser avant son arrêt : une valeur qui n’est pas un booléen arrête la fermeture comme au début), puis les vérifications des points 3, 4 et 5 : un commit pas fusionné, un fichier ou un instantané de plus qu’avant l’arrêt, et tu ne retires rien et me le dis ; ` +
    `9) git worktree unlock '<worktree>', seulement si sa ligne de git worktree list --porcelain porte locked, que la raison du verrou nomme cette session (« claude session <nom> (pid <pid> … » ; <pid> n’a que des chiffres, sinon arrête la fermeture) et que ps -p '<pid>' ne trouve plus ce processus, et une fois la session montrée arrêtée ; un autre verrou (posé à la main, une autre session) arrête la fermeture ; puis git worktree remove '<worktree>', sans aucune option ; la branche reste : ne la supprime pas ; ` +
    removal +
    `11) dis-moi ce qui a été fermé et ce qui reste, avec la ligne ${COMMITS_LINE} ; ${isApp ? APP_RESUME : RESUME}.`
  )
}
