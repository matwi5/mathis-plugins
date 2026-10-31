// Consignes de compaction : ce que flow-board demande au résumé de garder quand la discussion se
// compacte, selon son rôle. Fonctions pures.
//
// - L'orchestrateur garde des renvois plutôt que du contenu : le tableau de bord et les fichiers
//   gardent l'état, et sa rétro relira son transcript.
// - Une session liée de groupe garde de quoi reprendre son ticket et joindre l'orchestrateur.
// - Une valeur que le mod ne connaît pas est omise, jamais inventée.
// - `/compact` se propose une fois `/to-tickets` fini dans un parcours à groupes, tant qu'aucun
//   groupe n'est lancé et que la discussion ne s'est pas compactée depuis.
// - La rétro d'une discussion compactée relit son transcript : ce qui précède la dernière compaction
//   n'est plus dans le contexte, mais le transcript le garde.

import type { Board, SessionRegistry } from '../types'
import { SKILLS } from './catalog.ts'
import { activeRun, currentPhase, groupDone, linkedSessionsOf, nextLaunchFor } from './model.ts'
import { lastCompactionAt } from './registry.ts'

export type CompactionGroup = { id: string; name: string; done: number; total: number; session?: string }

export type CompactionRole =
  | {
      kind: 'orchestrator'
      run: { id: string; title: string; phase: string }
      groups: readonly CompactionGroup[]
      /** Les autres sessions liées du parcours (pistes confiées par une phase), hors groupes. */
      sessions?: readonly string[]
      transcript?: string
    }
  | { kind: 'group'; run: string; runTitle?: string; group: string; main?: string }

/**
 * Le rôle de la discussion qui se compacte : session de groupe quand elle travaille pour un
 * parcours (`delegate` avec un groupe), orchestrateur quand elle porte un parcours actif, sinon
 * aucun (null) : flow-board n'ajoute rien.
 */
export const compactionRoleOf = (board: Board | null | undefined, reg: SessionRegistry | null | undefined): CompactionRole | null => {
  const delegate = board?.delegate
  if (delegate) {
    if (delegate.group === undefined) return null
    const runTitle = board?.runs.find(r => r.id === delegate.run)?.title ?? delegate.title
    return { kind: 'group', run: delegate.run, group: delegate.group, ...(runTitle ? { runTitle } : {}), ...(delegate.main ? { main: delegate.main } : {}) }
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
  if (role.kind === 'group') {
    const run = role.runTitle ? `"${role.runTitle}" (id ${role.run})` : role.run
    return [
      `Compaction instructions from flow-board: this discussion is a linked session working on group ${role.group} of the run ${run}. The summary must keep:`,
      '- the work plan or spec path, the current task (N of M), a summary of the progress, what is done, left or blocked, the files changed, the results of the checks, the last error, the branch and the worktree;',
      '- the ticket in progress and its review step (Standards and Spec axes, bug pass, snapshot ref refs/worktree/flow-board/<ticket>), and the commit hash of each ticket done;',
      role.main ? `- the main discussion to report to: ${role.main};` : '- the reference of the main discussion to report to, as the brief gives it;',
      '- the paths of the brief and of DECISIONS.md.',
    ].join('\n')
  }
  const lines = [
    'Compaction instructions from flow-board: this discussion is the orchestrator of a run. Keep pointers rather than content: the dashboard and the files hold the state.',
    `- Run: "${role.run.title}" (id ${role.run.id}), phase ${role.run.phase}.`,
  ]
  if (role.groups.length > 0) {
    const groups = role.groups.map(g => `${g.id} "${g.name}": ${g.done}/${g.total} tickets done${g.session ? `, linked session ${g.session}` : ''}`)
    lines.push(`- Groups: ${groups.join('; ')}.`)
  }
  if (role.sessions && role.sessions.length > 0) lines.push(`- Other linked sessions: ${role.sessions.join(', ')}.`)
  lines.push(
    '- Keep the paths of DECISIONS.md, of the spec and of the work plans (travail/tasks/…), and the questions still open with the user, word for word.',
    '- After the compaction, reread the state of the run with the flow tool (mcp__flow-board__flow) before acting.',
    `- Keep this line as is: "This discussion was compacted: for the retro, reread its transcript ${role.transcript ?? `(${TRANSCRIPT_HINT})`}."`,
  )
  return lines.join('\n')
}

/** Le texte tapé après `/compact` (ou celui d'un plugin) en tête, les consignes de flow-board après. */
export const withCompactionInstructions = (given: string | undefined, instructions: string): string =>
  given !== undefined && given.trim() !== '' ? `${given}\n\n${instructions}` : instructions

/**
 * `/compact` se propose (en gris, et dans la carte « Ensuite ») : discussion principale, parcours
 * dont la phase Tickets est finie et dont la suite est de lancer des groupes, aucun groupe lancé,
 * aucune compaction depuis la fin des tickets. La question qui attend se juge à part.
 */
export const suggestsCompaction = (board: Board | null | undefined, reg: SessionRegistry | null | undefined): boolean => {
  if (board?.delegate) return false
  const run = activeRun(board)
  if (!run) return false
  const ticketsDoneAt = run.phases.find(p => p.skill === 'to-tickets' && p.status === 'done')?.finishedAt
  if (ticketsDoneAt === undefined) return false
  const rec = nextLaunchFor(run)
  if (rec === null || (rec.kind !== 'group' && rec.kind !== 'parallel')) return false
  // Un groupe lancé, en cours ou rendu ; les pistes d'une phase (avant les tickets) ne comptent pas.
  if ((run.groups ?? []).some(g => (g.linked ?? g.delegated) !== undefined)) return false
  const compactedAt = lastCompactionAt(reg)
  return compactedAt === null || compactedAt < ticketsDoneAt
}

/** Le toast du bouton « ⇣ Compacter d'abord ». */
export const COMPACT_FIRST_TOAST = '/compact est dans le prompt : flow-board ajoute ses consignes de compaction, ajoute les tiennes si tu veux, puis Entrée'

/**
 * Un transcript peut continuer un autre fichier, qui commence à sa compaction : la règle pour
 * remonter au fichier d'origine, écrite une fois pour la consigne de `/retro` et pour la demande du
 * bouton Rétro (les lecteurs des sessions liées).
 */
export const ORIGIN_FILE_RULE =
  'If the transcript starts with a compaction (no conversation message before its first "compact_boundary" entry, only settings entries such as title, mode or permissions), it continues another file: look in the other .jsonl files of the same project folder (not this one, which copies that entry too) for the entry whose "uuid" is the "logicalParentUuid" of that boundary, read that file up to that entry, and apply the same rule again if that file too starts with a compaction.'

/**
 * La consigne ajoutée à `/retro` : un sous-agent en lecture seule relit le transcript jusqu'à la
 * dernière compaction ; la discussion fait la suite, puis fusionne. Affirmative quand le mod a vu
 * une compaction (`isSeen`) ; sinon une vérification par grep d'abord, car une discussion reprise
 * dans un nouveau fichier après une compaction n'a pas de repère ici.
 */
export const retroTranscriptNote = (transcript: string | undefined, session: string | undefined, isSeen: boolean): string => {
  const where = transcript ?? `~/.claude/projects/<project folder>/${session ?? '<session id>'}.jsonl`
  const reading = `have a read-only subagent (general-purpose, not Haiku) read the transcript ${where} from its start to its last "compact_boundary" entry and do the retro of that part along the steps and categories of this skill, which you pass to it as you read them here; do the part after that entry yourself, from your context, then merge both.`
  const head = isSeen
    ? `Transcript (flow-board): this discussion was compacted, so what came before its last compaction is no longer in your context. So ${reading}`
    : `Transcript (flow-board): first check whether this discussion was compacted, here or before it was resumed, by counting the real compaction entries of its transcript (a mere mention of the word, such as this text, does not count): grep -c '"subtype":"compact_boundary"' "${where}". If it does hold such an entry, what came before the last one is no longer in your context: ${reading}`
  return ['', '', '---', `${head} ${ORIGIN_FILE_RULE}`].join('\n')
}
