// Consignes de compaction : ce que flow-board demande au résumé de garder quand la discussion se
// compacte, selon son rôle. Fonctions pures.
//
// - Le manager garde des renvois plutôt que du contenu : le tableau de bord et les fichiers
//   gardent l'état, et sa rétro relira son transcript.
// - Un worker de groupe garde de quoi reprendre son ticket et joindre le manager.
// - Une valeur que le mod ne connaît pas est omise, jamais inventée.
// - `/compact` se propose une fois `/to-tickets` fini dans une mission à groupes (ou une rétro, une fois ses
//   pistes découpées en tickets), tant qu'aucun groupe n'est lancé et que la discussion ne s'est pas
//   compactée depuis ; en auto, le mod l'envoie lui-même à ce moment, une fois (`compactionMoment`).
// - Le COO garde des renvois (feuille de route, fichier de coordination, missions suivies par id, questions
//   ouvertes), jamais un état recopié : sa mémoire est dans des fichiers.
// - La rétro d'une discussion compactée relit son transcript : ce qui précède la dernière compaction
//   n'est plus dans le contexte, mais le transcript le garde.

import type { Board, Run, SessionRegistry } from '../types'
import { SKILLS } from './catalog.ts'
import { groupDone, nextLaunchFor } from './model.ts'
import { linkedSessionsOf } from './link.ts'
import { activeRun, currentPhase } from './basics.ts'
import { lastCompactionAt } from './registry.ts'
import { seatState } from './seat.ts'
import { isSafeId, shellQuote } from './closing.ts'

export type CompactionGroup = { id: string; name: string; done: number; total: number; session?: string }

export type CompactionRole =
  | {
      kind: 'orchestrator'
      run: { id: string; title: string; phase: string }
      groups: readonly CompactionGroup[]
      /** Les autres workers de la mission (pistes confiées par une phase), hors groupes. */
      sessions?: readonly string[]
      transcript?: string
    }
  | {
      kind: 'group'
      run: string
      runTitle?: string
      group: string
      main?: string
      /** Une compaction lancée par le mod entre deux tickets : le ticket fini, et le suivant à commencer quand le mod le connaît. */
      between?: { done: string; next?: string }
    }
  /** La discussion qui tient le siège du COO : les missions qu'elle suit, par leur id seul. */
  | { kind: 'coo'; missions: readonly string[] }

/**
 * Le rôle de la discussion qui se compacte : session de groupe quand elle travaille pour une
 * mission (`delegate` avec un groupe), COO quand elle tient le siège (à `now`) sans porter de
 * mission, manager quand elle porte une mission active, sinon aucun (null) : flow-board n'ajoute rien.
 */
export const compactionRoleOf = (board: Board | null | undefined, reg: SessionRegistry | null | undefined, now?: number, between?: { done: string; next?: string }): CompactionRole | null => {
  const delegate = board?.delegate
  // La discussion du COO (elle ne porte jamais de mission) : ses consignes de rôle.
  if (board && !delegate && !activeRun(board) && now !== undefined && board.cooHere !== undefined && seatState(board.coo, board.cooHere, now) === 'mine') {
    return { kind: 'coo', missions: board.runs.filter(r => r.archivedAt === undefined && isSafeId(r.id)).map(r => r.id) }
  }
  if (delegate) {
    if (delegate.group === undefined) return null
    const runTitle = board?.runs.find(r => r.id === delegate.run)?.title ?? delegate.title
    return { kind: 'group', run: delegate.run, group: delegate.group, ...(runTitle ? { runTitle } : {}), ...(delegate.main ? { main: delegate.main } : {}), ...(between ? { between } : {}) }
  }
  const run = activeRun(board)
  if (!run) return null
  const phase = currentPhase(run)
  const groups = (run.groups ?? []).map(g => {
    // Les tickets que le plan lui rattache comptent aussi, comme partout où la fin d'un groupe se juge.
    const { done, total } = groupDone(run, g)
    const session = (g.linked ?? g.delegated)?.session
    return { id: g.id, name: g.name, done, total, ...(session ? { session } : {}) }
  })
  // Toutes les sessions que `linkedSessionsOf` relève : celles des groupes, et celles des pistes d'une phase.
  const ofGroups = new Set(groups.map(g => g.session).filter(id => id !== undefined))
  const sessions = linkedSessionsOf(run).ids.filter(id => !ofGroups.has(id))
  return {
    kind: 'orchestrator',
    run: { id: run.id, title: run.title, phase: SKILLS[phase.skill]?.label ?? phase.skill },
    groups,
    ...(sessions.length > 0 ? { sessions } : {}),
    ...(reg?.transcript ? { transcript: reg.transcript } : {}),
  }
}

const TRANSCRIPT_HINT = 'the .jsonl file of this session under ~/.claude/projects/'

/** Les consignes de compaction d'un rôle, en anglais comme les autres consignes du mod au modèle. */
export const compactionInstructions = (role: CompactionRole): string => {
  if (role.kind === 'coo') {
    return [
      'Compaction instructions from flow-board: this discussion is the COO of the project (the seat holder). Its memory is in files: keep pointers, never a copied state.',
      '- the roadmap file (its path, as the COO statement names it) and the coordination file of the project, kept by the dashboard;',
      `- the missions followed, by id only: ${role.missions.length > 0 ? role.missions.join(', ') : 'none'} (their state is reread in the COO statement of each message, never from memory);`,
      '- the questions still open with the user, word for word, and the decisions relayed but not yet written in a DECISIONS.md;',
      '- after the compaction, speak about the project only from the next COO statement and the files you read again.',
    ].join('\n')
  }
  if (role.kind === 'group') {
    const run = role.runTitle ? `"${role.runTitle}" (id ${role.run})` : role.run
    const between = role.between
    return [
      `Compaction instructions from flow-board: this discussion is a worker working on group ${role.group} of the mission ${run}. The summary must keep:`,
      ...(between
        ? [
            `- this compaction runs between two tickets: ticket ${between.done} is done${between.next ? `, and the next one to start is ${between.next}` : ''}; keep its commit hashes (the ticket's, and its review fixes') and, for the final report, its tracks (bug-pass findings that do not break the invariant, except a regression the diff introduces, which gets fixed), its findings on code older than the lot and what the CHANGELOG must say for it, but not the rest of the detail of its work (its diffs, its fixed findings, its fixes); the place in the procedure: the next ticket starts at step 1 of section 2 of the procedure${between.next ? '' : ' (when no ticket of the group is left, the group review and the report follow, sections 4 to 6, in reference/procedure-groupe-fin.md of flow-board)'};`,
          ]
        : []),
      '- the work plan or spec path, the current task (N of M), a summary of the progress, what is done, left or blocked, the files changed, the results of the checks, the last error, the branch and the worktree;',
      '- the ticket in progress and its review step (Standards and Spec axes, or the Spec axis alone for a sensitive ticket, bug pass, snapshot ref refs/worktree/flow-board/<ticket>), and the commit hash of each ticket done;',
      '- the questions sent to the manager still without an answer, word for word, and the choices already declared (the "decided" sent to the flow tool);',
      '- the review findings not yet applied (each with its file:line and the expected fix), or the path of the file that holds them (the notes-compte-rendu.md of the session\'s temporary folder, kept up to date with them before the compaction): a worker had reread its own transcript to find them again;',
      '- after the compaction, reload with ToolSearch, in one call (select:<names>), the deferred tools the session was using before calling any of them (SendMessage, TaskCreate, TaskUpdate, Monitor): their schemas do not survive it;',
      role.main ? `- the manager to report to: ${role.main};` : '- the reference of the manager to report to, as the brief gives it;',
      '- the paths of the brief, of DECISIONS.md and of the procedure of a worker: its core, reference/procedure-groupe.md of flow-board, to reread after the compaction, and, once the last ticket is committed, reference/procedure-groupe-fin.md (group review, security review, report).',
    ].join('\n')
  }
  const lines = [
    'Compaction instructions from flow-board: this discussion is the manager of a mission. Keep pointers rather than content: the dashboard and the files hold the state.',
    `- Mission: "${role.run.title}" (id ${role.run.id}), phase ${role.run.phase}.`,
  ]
  if (role.groups.length > 0) {
    const groups = role.groups.map(g => `${g.id} "${g.name}": ${g.done}/${g.total} tickets done${g.session ? `, worker ${g.session}` : ''}`)
    lines.push(`- Groups: ${groups.join('; ')}.`)
  }
  if (role.sessions && role.sessions.length > 0) lines.push(`- Other workers: ${role.sessions.join(', ')}.`)
  lines.push(
    '- Keep the paths of DECISIONS.md, of the spec and of the work plans (travail/tasks/…), and the questions still open with the user, word for word.',
    '- After the compaction, reread the state of the mission with the flow tool (mcp__flow-board__flow) before acting.',
    `- Keep this line as is: "This discussion was compacted: for the retro, reread its transcript ${role.transcript ?? `(${TRANSCRIPT_HINT})`}."`,
  )
  return lines.join('\n')
}

/** Le texte tapé après `/compact` (ou celui d'un plugin) en tête, les consignes de flow-board après. */
export const withCompactionInstructions = (given: string | undefined, instructions: string): string =>
  given !== undefined && given.trim() !== '' ? `${given}\n\n${instructions}` : instructions

/**
 * `/compact` se propose (en gris, et dans la carte « Ensuite ») : manager, mission dont le
 * découpage est fini (la phase Tickets, ou une rétro dont les pistes sont découpées en tickets) et dont
 * la suite est de lancer des groupes, aucun groupe lancé, aucune compaction depuis ce découpage
 * (`compactionMoment`). La question qui attend se juge à part.
 */
export const suggestsCompaction = (board: Board | null | undefined, reg: SessionRegistry | null | undefined): boolean => {
  if (board?.delegate) return false
  const run = activeRun(board)
  if (!run) return false
  const moment = compactionMoment(run)
  if (moment === null) return false
  const compactedAt = lastCompactionAt(reg)
  return compactedAt === null || compactedAt < moment.at
}

/**
 * Le moment de compacter une mission à groupes : son découpage fini (la phase « Tickets », ou une rétro
 * dont les pistes sont découpées en tickets), la suite étant de lancer des groupes, et aucun groupe encore
 * lancé (en cours ou rendu ; les pistes d'une phase, avant les tickets, ne comptent pas). Rend la clé de
 * l'action de l'auto (une par phase de découpage, pour ne jamais partir deux fois) et la date de ce découpage.
 */
export const compactionMoment = (run: Run): { key: string; at: number } | null => {
  const cut = [...run.phases.entries()].filter(([, p]) => (p.skill === 'to-tickets' || p.skill === 'retro') && p.status === 'done' && p.finishedAt !== undefined).pop()
  if (!cut) return null
  const [index, phase] = cut
  if (phase.skill === 'retro' && (run.groups ?? []).length === 0) return null
  const rec = nextLaunchFor(run)
  if (rec === null || (rec.kind !== 'group' && rec.kind !== 'parallel')) return null
  if ((run.groups ?? []).some(g => (g.linked ?? g.delegated) !== undefined)) return null
  const rank = run.phases.slice(0, index + 1).filter(p => p.skill === phase.skill).length
  return { key: `compact:${phase.skill}#${rank}`, at: phase.finishedAt! }
}

/**
 * Le contexte d'un worker au-delà duquel il se compacte à la clôture d'un ticket (passé à « done » : revue
 * rendue, correctifs commités), au lieu que la compaction automatique (600 000, `autoCompactWindow` de
 * `config/settings.shared.json`, gardée comme filet) tombe en plein ticket : 5 compactions en plein travail
 * au lieu de 14, coût 94,8 pour 100 sans rien, d'après l'étude des seuils d'un worker du 02/11/2026 (317 sessions Claude Code, dont 64 workers).
 */
export const WORKER_COMPACT_TOKENS = 450_000

/**
 * Le contexte au-delà duquel le COO se compacte lui-même quand rien n'attend la personne : le même seuil que
 * celui d'un worker, car une discussion du COO démarre déjà vers 150 000 tokens (décision de la personne du 03/11/2026).
 */
export const COO_COMPACT_TOKENS = WORKER_COMPACT_TOKENS

/** Un « ? » de question : suivi d'un blanc, d'une balise de fin (gras, italique, parenthèse, crochet de lien, guillemet, cellule de tableau, « ! ») ou de la fin du texte ; pas celui d'une adresse (`?id=`). */
const QUESTION_MARK = /\?(?=[\s*_)\]"”’»|!]|$)/

/** Une ligne « needs input: … », avec ou sans balises devant (gras, citation, puce, titre, code). */
const NEEDS_INPUT_LINE = /^[\s>*_`#-]*needs input\b/im

/**
 * La dernière réponse du COO attend la personne : elle finit sur « ? » (même règle que `endsWithQuestion`), une de
 * ses lignes est une ligne « needs input », ou elle pose une question ailleurs, hors code (une question suivie de ses
 * options, sur sa ligne ou en dessous, ou dans un tableau). Prudente : une question de trop retarde la compaction
 * jusqu'au tour suivant, une question manquée la fait tomber avant la réponse de la personne.
 */
export const answerAwaitsPerson = (answer: unknown): boolean => {
  if (typeof answer !== 'string') return false
  const text = answer.trim()
  if (/\?[\s*_)"»]*$/.test(text) || NEEDS_INPUT_LINE.test(text)) return true
  let isInCode = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) isInCode = !isInCode
    else if (!isInCode && QUESTION_MARK.test(line.replace(/`[^`]*`/g, ''))) return true
  }
  return false
}

/**
 * Ce que fait le mod d'un worker au repos, un ticket clos au-delà du seuil (`workerCompactStep`) : `compact`
 * l'envoie ; `wait` attend le repos suivant (un tour ouvert, une revue de fond qui tourne) ; `drop` y renonce
 * pour ce ticket (un ticket en cours, des statuts illisibles, déjà compacté pour lui, sous le seuil).
 * Invariant : jamais pendant un ticket en cours ni pendant une revue qui tourne.
 */
export const workerCompactStep = (s: {
  tokens: number | undefined
  isTurnOpen: boolean
  hasBackgroundWork: boolean
  /** Les tickets « doing » de l'entrée de relais de la session ; null quand elle ne s'est pas relue. */
  doing: readonly string[] | null
  isMarked: boolean
}): 'compact' | 'wait' | 'drop' => {
  if (s.isTurnOpen || s.hasBackgroundWork) return 'wait'
  if (s.doing === null || s.doing.length > 0 || s.isMarked) return 'drop'
  return typeof s.tokens === 'number' && s.tokens >= WORKER_COMPACT_TOKENS ? 'compact' : 'drop'
}

/** Ce que lit le worker dont un ticket passe « done » au-delà du seuil : finir son tour avant le ticket suivant. */
export const workerCompactNotice = (ticket: string, tokens: number): string =>
  `flow-board: ticket ${ticket} is done and this discussion's context holds ${Math.round(tokens / 1000)}k tokens, past the ${WORKER_COMPACT_TOKENS / 1000}k threshold of a worker. Finish closing it (its commit, its status, its review counts), then end your turn before starting the next ticket: set no ticket « doing » and launch no review or subagent. The dashboard then compacts this discussion with instructions that keep your place, and sends you a message to go on.`

/** Le message qui relance le worker après la compaction entre deux tickets (`isCompacted`), ou quand elle n'a pas eu lieu. */
export const workerResumeText = (done: string, next: string | undefined, isCompacted: boolean): string =>
  `${isCompacted ? `flow-board: this discussion was compacted between two tickets (ticket ${done} done).` : `flow-board: no compaction was made after ticket ${done}.`} Go on with ${next ? `ticket ${next}, from step 1 of section 2 of your procedure` : 'the next ticket of your group, from step 1 of section 2 of your procedure, or, when none is left, with its group review and your report (sections 4 to 6, in procedure-groupe-fin.md)'} (reread the procedure and DECISIONS.md first); if you already started it, carry on where you are.`

/** Le toast du bouton « ⇣ Compacter d'abord ». */
export const COMPACT_FIRST_TOAST = '/compact est dans le prompt : flow-board ajoute ses consignes de compaction, ajoute les tiennes si tu veux, puis Entrée'

/**
 * Un transcript peut continuer un autre fichier, qui commence à sa compaction : la règle pour
 * remonter au fichier d'origine, écrite une fois pour la consigne de `/retro` et pour la demande du
 * bouton Rétro (les lecteurs des workers).
 */
export const ORIGIN_FILE_RULE =
  'If the transcript starts with a compaction (no conversation message before its first "compact_boundary" entry, only settings entries such as title, mode or permissions), it continues another file: look in the other .jsonl files of the same project folder (not this one, which copies that entry too) for the entry whose "uuid" is the "logicalParentUuid" of that boundary, read that file up to that entry, and apply the same rule again if that file too starts with a compaction.'

/**
 * Un texte relu qui ouvrirait une ligne ou retournerait l'affichage là où il est recopié (une demande mise
 * dans le prompt, une commande) : une fin de ligne ou un séparateur de ligne, un contrôle, une
 * incorporation, un forçage ou un isolat bidirectionnel. Les autres caractères (émojis et leurs
 * sélecteurs, marques LRM et RLM) restent ordinaires : un nom de dossier en porte.
 */
export const breaksLine = (text: string): boolean => /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/.test(text)

/**
 * La consigne ajoutée à `/retro` : un spécialiste en lecture seule relit le transcript jusqu'à la
 * dernière compaction ; la discussion fait la suite, puis fusionne. Affirmative quand le mod a vu
 * une compaction (`isSeen`) ; sinon une vérification par grep d'abord, car une discussion reprise
 * dans un nouveau fichier après une compaction n'a pas de repère ici. Dans les deux cas, les rapports
 * de ses spécialistes se lisent par le script `scripts/rapports-specialistes.mjs` (`reports` : son
 * chemin à lancer, puis, quand le projet contient la source du mod, son chemin installé en repli), au
 * lieu de relire chaque transcript. Un id de session relu hors forme, ou un chemin relu qui
 * ouvrirait une ligne (`breaksLine`), laisse place au gabarit, que la note dit de remplir en tête.
 */
export const retroTranscriptNote = (transcript: string | undefined, session: string | undefined, isSeen: boolean, reports: { script: string; fallback?: string }): string => {
  // Valeurs relues (registre, tableau de bord) : un id hors forme ne nomme aucun fichier, et un chemin qui
  // ouvrirait une ligne (`breaksLine`) n'entre ni dans la note ni dans une commande ;
  // chacun laisse place au gabarit, à remplir.
  const id = isSafeId(session) ? session : undefined
  const known = transcript !== undefined && !breaksLine(transcript) ? transcript : undefined
  const rest = `.claude/projects/<project folder>/${id ?? '<session id>'}.jsonl`
  const where = known ?? `~/${rest}`
  // Le chemin connu se cite en entier, entre apostrophes (jamais entre guillemets, où `$` et l'accent grave
  // s'interprètent) ; le gabarit garde son `~/` hors des apostrophes, pour que le shell le développe une
  // fois rempli.
  const cited = known === undefined ? `~/${shellQuote(rest)}` : shellQuote(known)
  // En tête de la note, avant le premier usage du gabarit (le grep, le chemin donné au spécialiste).
  const fill = known === undefined ? ` In the transcript path of this note, replace <project folder> with the folder of this discussion under ~/.claude/projects/${id === undefined ? ', and <session id> with its session id' : ''}, before running any command or handing the path on.` : ''
  const reading = `have a read-only subagent (general-purpose, not Haiku) read the transcript ${where} from its start to its last "compact_boundary" entry and do the retro of that part along the steps and categories of this skill, which you pass to it as you read them here; do the part after that entry yourself, from your context, then merge both.`
  const head = isSeen
    ? `Transcript (flow-board):${fill} ${fill ? 'This' : 'this'} discussion was compacted, so what came before its last compaction is no longer in your context. So ${reading}`
    : `Transcript (flow-board):${fill} ${fill ? 'First' : 'first'} check whether this discussion was compacted, here or before it was resumed, by counting the real compaction entries of its transcript (a mere mention of the word, such as this text, does not count): grep -c '"subtype":"compact_boundary"' ${cited}. If it does hold such an entry, what came before the last one is no longer in your context: ${reading}`
  const run = (script: string): string => `node ${shellQuote(script)} ${cited}`
  const fallback = reports.fallback === undefined ? '' : ` (from the root of the working folder: the repository's source, which prevails; else ${run(reports.fallback)})`
  const subagents = `In every case, compacted or not, the reports of its subagents (name, type, model, effort, finished, final report: the last SubagentHandback, else the last text) come from one command, rather than rereading each subagent transcript: ${run(reports.script)}${fallback}, and the same command on each origin file the rule above leads to (the subagents launched before a resumption live beside that file); add --prefixe "<start of the name>" to keep some (« Spec · », « Sécurité · »); with many subagents, write its output to a file named after this session's id in your own temporary folder (never a generic /tmp name another session could overwrite) and read it in parts.`
  return ['', '', '---', `${head} ${ORIGIN_FILE_RULE} ${subagents}`].join('\n')
}
