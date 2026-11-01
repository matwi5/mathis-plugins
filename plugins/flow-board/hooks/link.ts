// Le cycle de vie du lien d'un groupe ou de pistes : l'envoi à une session liée, la session relevée,
// l'annulation, la relance de fermeture, le retour, les envois précédents, la fermeture notée et la
// fusion de deux copies du tableau de bord, et les champs qu'un groupe garde quand son plan est réécrit
// (`KEPT_GROUP_FIELDS`). Les écritures et les recopies des champs du lien passent par ce module ; le
// modèle lit encore le lien, des groupes comme des pistes, pour les décisions qu'il garde (quels groupes
// partent, si un groupe rendu ou une session de pistes est close et à fermer, les refus d'une
// fermeture, le texte de fermeture), et l'appelle pour écrire. À ne pas confondre avec linked.ts, qui
// reconnaît les sessions liées de l'onglet Agents. Fonctions pures, sans entrée ni sortie : une
// fonction qui change un parcours, une phase ou un groupe reçus (`sendGroups`, `returnGroups`,
// `openLinkedWork`) attend un clone, jamais le tableau de bord enregistré. Il n'importe que basics, relay et des modules sans lien avec le modèle, jamais le
// modèle (un test le vérifie).

import type { Board, ClosedLink, Closing, FlowItem, FlowPhase, GroupLink, LinkedWork, Run, SecurityCheck, TicketGroup } from '../types'
import { SKILLS } from './catalog.ts'
import { activeRun, clip, clone, currentPhase, hasGroupReview, hasUnreadableCounts, isoMinute, isTime, log, noFx, type Outcome, reviewTimeOf, sentGroupOf, setStep, shownGroupId, str, bugsText } from './basics.ts'
import { ownPart } from './linked.ts'
import { branchFate, type CloseTarget, isSafeBranch, isSessionId, isWorktreePath, neutralRelayed, readClosing, sendNumber } from './closing.ts'
import { isRelay, keepDecisions, relayedDecisions, relayForGroup, UNREADABLE_COUNT } from './relay.ts'
import { maxOf } from './timeline.ts'

/**
 * Les ids confiés à la session liée d'une phase, pour chaque lecteur de la liste : relue d'un fichier
 * partagé, une liste hors forme n'en confie aucun (`upgradeRun` la lit au chargement de chaque parcours).
 */
export const confidedIds = (link: LinkedWork | null | undefined): string[] => {
  const ids: unknown = link !== null && typeof link === 'object' ? link.items : undefined
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

/** Les éléments confiés à une session liée et pas encore rendus (ni faits ni écartés). */
export const linkedInFlight = (phase: FlowPhase): FlowItem[] => {
  const ids = confidedIds(phase.linked)
  return phase.items.filter(i => ids.includes(i.id) && i.status !== 'done' && i.status !== 'dropped')
}

/**
 * La phase attend la session liée de ses éléments : envoyés et pas rendus, ou rendus et sa session
 * pas encore fermée. Un lien relu qui n'est pas un objet n'est pas une session, comme pour `pickableItems`.
 */
export const holdsItemsSession = (phase: FlowPhase): boolean => {
  const link = phase.linked
  if (link === null || typeof link !== 'object') return false
  return linkedInFlight(phase).length > 0 || (link.session !== undefined && link.closing?.state !== 'closed')
}

/**
 * Les éléments que le panneau peut encore faire découper : ni faits, ni écartés. Aucun tant que la
 * phase attend la session liée d'un ancien envoi (lancée ou non) : l'appel du découpage serait refusé.
 */
export const pickableItems = (phase: FlowPhase): FlowItem[] =>
  holdsItemsSession(phase) ? [] : phase.items.filter(i => i.status !== 'done' && i.status !== 'dropped')

/**
 * Les éléments passent « en cours » et l'étape de la phase prévue pour une session liée s'ouvre :
 * au lancement de la session, pas à l'envoi de la demande.
 */
const openLinkedWork = (phase: FlowPhase, ids: readonly string[], now: number) => {
  const stepId = SKILLS[phase.skill]?.items?.linkedStep
  if (!stepId) return
  // Un parcours ouvert avant que l'étape existe la reçoit à la fin de ses étapes.
  if (!phase.steps.some(s => s.id === stepId)) phase.steps = [...phase.steps, { id: stepId, status: 'pending' }]
  setStep(phase, stepId, now, true)
  if (phase.status === 'done') {
    phase.status = 'active'
    phase.finishedAt = undefined
  }
  phase.items = phase.items.map(i => (ids.includes(i.id) && i.status === 'todo' ? { ...i, status: 'doing' as const } : i))
}

/**
 * Les sessions filles d'un parcours : une par groupe confié ou rendu, une par envoi de pistes
 * encore suivi, et les ids relevés à leur lancement. Une session de diagnostic de bug n'y laisse
 * pas de trace : seul son titre la relie au parcours.
 */
export const linkedSessionsOf = (run: Run): { count: number; ids: string[] } => {
  const links = [...(run.groups ?? []).map(g => g.linked ?? g.delegated), ...run.phases.map(p => p.linked)].filter(
    (l): l is NonNullable<typeof l> => l !== undefined,
  )
  const ids = [...new Set(links.map(l => l.session).filter((id): id is string => id !== undefined && id !== ''))]
  return { count: links.length, ids }
}

/**
 * La session liée est lancée : son id, relevé dans la réponse de start_session ou dans la sortie
 * de `claude --bg`, est gardé, et les éléments passent « en cours ». Une session dont le titre
 * nomme un groupe ou un bug (« … > Groupe A · », « … > Bug · ») n'est pas celle des éléments.
 */
export const linkSession = (board: Board, session: string, now: number, title = ''): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  const phase0 = currentPhase(run0)
  if (!phase0.linked || phase0.linked.session !== undefined || linkedInFlight(phase0).length === 0) return null
  // Après le dernier séparateur (« > », ou un ancien) ; une page de code peut déformer « · » en « Â· ».
  const own = ownPart(title)
  if (/^\s*(?:groupe\s+\S+|bug)\s*(?:Â)?·/i.test(own)) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const { missedAt: _, ...linked } = phase.linked!
  phase.linked = { ...linked, session }
  run.linkedAt ??= now
  const ids = linkedInFlight(phase).map(i => i.id)
  openLinkedWork(phase, ids, now)
  const label = SKILLS[phase.skill]?.items?.label.toLowerCase() ?? 'éléments'
  log(run, now, '↗', `Session liée lancée : ${ids.length} ${label} en cours`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Un tour de la discussion commencé après l'envoi (`turnAt`) s'est fini sans lancer de session :
 * Claude a pu poser une question d'abord, ou ne pas la lancer du tout. Le panneau le montre au lieu
 * de laisser croire la demande en route ; le lancement, même plus tard, efface la marque.
 */
export const noteUnlaunched = (board: Board, turnAt: number, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  const phase0 = currentPhase(run0)
  const linked0 = phase0.linked
  if (!linked0 || linked0.session !== undefined || linked0.missedAt !== undefined || turnAt < linked0.at) return null
  const count = linkedInFlight(phase0).length
  if (count === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  phase.linked = { ...phase.linked!, missedAt: now }
  const label = SKILLS[phase.skill]?.items?.label.toLowerCase() ?? 'éléments'
  log(run, now, '!', `Aucune session liée lancée pour ${count} ${label} : Claude a rendu la main sans la lancer`, 'warn')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** La personne redemande le lancement d'une session pour les éléments restés sans session. */
export const retryLinked = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  const phase0 = currentPhase(run0)
  if (!phase0.linked || phase0.linked.session !== undefined || linkedInFlight(phase0).length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const { missedAt: _, ...linked } = phase.linked!
  phase.linked = { ...linked, at: now }
  log(run, now, '↗', 'Session liée redemandée : la demande est dans le prompt', 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Annule un envoi resté sans session : les éléments confiés redeviennent à faire, au choix de la
 * personne. Un envoi d'avant la 0.51.0 avait déjà ouvert l'étape prévue : la phase revient à celle d'avant.
 */
export const cancelLinked = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const phase0 = currentPhase(run0)
  if (!phase0.linked || phase0.linked.session !== undefined) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const back = linkedInFlight(phase).map(i => i.id)
  phase.items = phase.items.map(i => (back.includes(i.id) ? { ...i, status: 'todo' as const } : i))
  phase.linked = undefined
  const stepId = SKILLS[phase.skill]?.items?.linkedStep
  const at = phase.steps.findIndex(s => s.id === stepId)
  if (at > 0 && phase.steps[at]!.status === 'active') setStep(phase, phase.steps[at - 1]!.id, now)
  log(run, now, '↺', 'Envoi à la session liée annulé', 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Le lien des pistes avec les pistes qui lui restent confiées. */
export const withItems = (link: LinkedWork, items: string[]): LinkedWork => ({ ...link, items })

/** Un lien que la discussion vient de toucher : une fermeture arrêtée redevient à faire. */
export const touchedLink = <L extends GroupLink | LinkedWork>(link: L, now: number): L => ({ ...link, touchedAt: now })

/** Un lien dont la fermeture est relancée (« ↻ Relancer la fermeture »). */
export const withCloseAsked = <L extends GroupLink | LinkedWork>(link: L, now: number): L => ({ ...link, closeAskedAt: now })

/** Un lien avec sa fermeture notée. */
export const withClosing = <L extends GroupLink | LinkedWork>(link: L, closing: Closing): L => ({ ...link, closing })

/** Un lien rendu dont la session précédente de rang `at` (dans `list`, ses envois précédents) a sa fermeture notée. */
export const withEarlierClosing = (link: GroupLink, list: readonly ClosedLink[], at: number, closing: Closing): GroupLink => ({
  ...link,
  earlier: list.map((x, i) => (i === at ? { ...x, closing } : x)),
})

/** Le lien rendu qu'une réparation reconstruit du journal : son seul moment de retour. */
export const returnedLink = (at: number): GroupLink => ({ at })

/**
 * L'envoi des groupes choisis, chacun à une session liée : son numéro d'envoi et son lien en cours ;
 * un groupe déjà relu perd sa revue et son avis de sécurité, que le journal cite, et garde la marque
 * de la remise à zéro (`isReset`) jusqu'au retour d'un envoi. Change le parcours reçu : un clone.
 */
export const sendGroups = (run: Run, picked: readonly string[], now: number): void => {
  const resets: string[] = []
  run.groups = (run.groups ?? []).map(g => {
    if (!picked.includes(g.id)) return g
    // Un envoi suivant du groupe a son numéro : son worktree ne bute pas sur la branche gardée d'un précédent.
    const seq = groupSendSeq(g)
    const sent: TicketGroup = { ...g, sends: seq, linked: { at: now, ...(seq > 1 ? { seq } : {}) } }
    // Tout envoi d'un groupe déjà relu, ici ou par un envoi précédent (même un lien rendu relu d'un autre
    // type) : sa revue et son avis de sécurité ne valent pas pour ce nouvel envoi, qui demande les siens.
    if (g.reviewedAt === undefined && g.security === undefined) return sent
    const back = g.delegated !== null && typeof g.delegated === 'object' ? g.delegated : undefined
    // La revue et l'avis de sécurité d'avant (faits ici, ou ceux de l'envoi rendu) quittent le groupe, et le
    // journal les cite.
    const { reviewedAt, security, ...rest } = sent
    const before = g.delegated === undefined ? 'faites ici' : `de l'envoi ${sendNumber(back?.seq) ?? 1}`
    resets.push(`Envoi ${seq} du groupe ${g.id} : la revue (${reviewTimeOf({ reviewedAt }) !== undefined ? `${isoMinute(reviewTimeOf({ reviewedAt })!)} UTC` : 'aucune'}) et la sécurité (${previousSecurityText(security)}) ${before} ne comptent plus`)
    // Le groupe le dit jusqu'au retour d'un envoi : une revue ou un avis qui arrivent pendant un envoi sont refusés,
    // même après une annulation ou un renvoi de vague (la revue d'ici lancée avant peut finir pendant le suivant).
    return { ...rest, isReset: true }
  })
  for (const line of resets) log(run, now, '↺', line, 'info')
  log(run, now, '↗', `${picked.length > 1 ? `Groupes ${picked.join(', ')} confiés` : `Groupe ${picked[0]} confié`} à ${picked.length > 1 ? 'des sessions liées' : 'une session liée'}`, 'info')
}

/**
 * La raison d'une fermeture, relue du fichier de parcours (une fusion ou une reprise l'apporte), dans la
 * réponse de l'outil, juste avant la procédure de fermeture : bornée à 200 caractères, neutralisée comme
 * un texte relayé et citée en JSON ; rien quand ce n'est pas un texte.
 */
export const closingWhy = (why: unknown): string => {
  const reason = closingReason(why)
  // Bornée encore après la neutralisation, qui peut l'allonger (forme normalisée, invisibles montrés).
  return reason !== '' ? ` — ${JSON.stringify(clip(neutralRelayed(reason), 200))}` : ''
}

/**
 * La raison d'une fermeture, bornée : une ligne (blancs fondus), 200 caractères au plus ; vide quand ce n'est
 * pas un texte. Le lecteur partagé qui la borne : l'entrée de l'outil, la réponse de l'outil (qui la coupe
 * encore après sa neutralisation) et le panneau l'appellent, la valeur relue du fichier pouvant venir d'une
 * autre discussion.
 */
export const closingReason = (why: unknown): string => clip(str(why), 200)

/**
 * Un groupe en vol dont la revue d'avant ne vaut pas pour l'envoi : confié de nouveau (un envoi précédent
 * rendu), ou remis à zéro à un envoi pas encore revenu (`isReset` du groupe, relu strictement). Une revue ou
 * un avis qui arrivent maintenant peuvent être ceux d'avant l'envoi : ils viennent avec son retour.
 */
export const isResentInFlight = (g: TicketGroup | null | undefined): boolean =>
  g !== null && g !== undefined && g.linked !== undefined && (g.delegated !== undefined || (g as { isReset?: unknown }).isReset === true)

/** Pourquoi la revue ou l'avis d'un groupe en vol attendent son retour, pour la réponse de l'outil. */
export const inFlightWhy = (g: TicketGroup): string =>
  g.delegated !== undefined
    ? `is in a linked session again (send ${sendNumber(g.linked?.seq) ?? 1}), not returned yet`
    : `is in a linked session (send ${sendNumber(g.linked?.seq) ?? 1}), its review and security advice reset at a send not returned yet`

/** L'avis de sécurité d'un envoi précédent, en mots pour le journal : l'avis, et les comptes s'il y en a. */
export const previousSecurityText = (sec: SecurityCheck | undefined): string => {
  if (!sec || typeof sec !== 'object') return 'aucun avis'
  const advice = sec.isAdvised === true ? 'conseillée' : sec.isAdvised === false ? 'jugée inutile' : 'sans avis'
  const counts = sec.findings !== undefined && !hasUnreadableCounts(sec) ? `, ${sec.findings} faille(s), ${sec.fixed ?? 0} corrigée(s)${(sec.dismissed ?? 0) > 0 ? `, ${sec.dismissed} laissée(s)` : ''}` : ''
  return `${advice}${sec.ranAt !== undefined ? ', lancée' : ''}${counts}`
}

/**
 * Une session liée est lancée : son id va au groupe que son titre nomme (« <parcours> > Groupe A · … »),
 * sinon au seul groupe confié qui n'a pas encore de session. Rien quand on ne sait pas lequel. Seule
 * compte la partie après le dernier séparateur : le titre du parcours, en tête, peut lui-même dire
 * « groupe … ».
 */
export const linkGroupSession = (board: Board, title: string, session: string, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const pending = (run0.groups ?? []).filter(g => g.linked !== undefined && g.linked.session === undefined)
  if (pending.length === 0) return null
  // Après le dernier séparateur : le titre du parcours, devant, ne nomme pas le groupe de la session.
  const own = ownPart(title)
  const named = [...own.matchAll(/\bgroupe\s+([^\s·:,()]+)/gi)].map(m => m[1]!.toLowerCase())
  const target =
    named.length > 0
      ? [...named].reverse().map(n => pending.find(g => g.id.toLowerCase() === n)).find(g => g !== undefined)
      : pending.length === 1
        ? pending[0]
        : undefined
  if (!target) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === target.id ? { ...g, linked: { ...g.linked!, session } } : g))
  run.linkedAt ??= now
  log(run, now, '↗', `Session liée lancée pour le groupe ${target.id}`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** « ↻ Relancer la fermeture » de la session des éléments de la phase en cours, arrêtée. */
export const askCloseLinkedItems = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  const link = run0 ? currentPhase(run0).linked : undefined
  if (!link?.session || link.closing?.state !== 'stopped' || (link.closeAskedAt ?? 0) > link.closing.at) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  phase.linked = { ...phase.linked!, closeAskedAt: now }
  log(run, now, '↻', 'Fermeture de la session liée des éléments relancée', 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Annule l'envoi d'un groupe à une session liée qui n'a pas été lancée : il redevient à lancer. */
export const cancelLinkedGroup = (board: Board, id: string, now: number): Outcome => {
  const run0 = activeRun(board)
  const was = run0?.groups?.find(g => g.id === id)
  if (!run0 || !was?.linked || was.linked.session !== undefined) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === id ? withoutLink(g) : g))
  log(run, now, '↺', `Envoi du groupe ${id} à une session liée annulé`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

export const withoutLink = (group: TicketGroup): TicketGroup => {
  const { linked: _, ...rest } = group
  return rest
}

/**
 * Les ids reçus dans `returned` : les groupes que leurs sessions liées ont rendus. Une revue
 * (`/code-review`, `/security-review`) que la session a relayée vaut celle du groupe.
 */
export const returnGroups = (run: Run, value: unknown, now: number, stored?: unknown): { back: string[]; unknown: string[] } => {
  const relay = isRelay(stored, run.id) ? stored : null
  const ids = (Array.isArray(value) ? value : []).filter(x => String(x).trim() !== '')
  const back: string[] = []
  const unknown: string[] = []
  for (const id of ids) {
    const g = sentGroupOf(run, id)
    if (!g?.linked) {
      unknown.push(shownGroupId(id))
      continue
    }
    back.push(g.id)
  }
  if (back.length > 0) {
    // Avant de défaire le lien : le relais d'un groupe ne se lit que tant qu'il est confié.
    const decided = relayedDecisions({ ...run, groups: run.groups!.filter(g => back.includes(g.id)) }, relay, run.groups)
    keepDecisions(run, decided)
    for (const d of decided) log(run, now, '⚑', `Décidé sans toi (groupe ${d.relayedFrom}) : ${d.what}`, 'warn')
    const reviewedThere: string[] = []
    const impl = run.phases.find(p => p.skill === 'implement')
    run.groups = run.groups!.map(g => {
      if (!back.includes(g.id)) return g
      const relayed = relayForGroup(relay, g, run.groups)
      // Une date de revue hors forme, d'ici ou relayée, ne compte pas (`isGroupReviewed`).
      const relayedReview = relayed ? reviewTimeOf(relayed) : undefined
      if (!hasGroupReview(g) && relayedReview !== undefined) reviewedThere.push(g.id)
      const reviewedAt = reviewTimeOf(g) ?? relayedReview ?? g.reviewedAt
      const ranAt = g.security?.ranAt ?? relayed?.securedAt
      // Les constats relayés comptent dans la phase d'implémentation, une fois (le groupe n'est rendu qu'une fois).
      if (relayed?.reviews && impl) {
        const s = impl.stats
        s.reviews = (s.reviews ?? 0) + relayed.reviews.count
        s.standards = Math.max(0, s.standards) + relayed.reviews.standards
        s.spec = Math.max(0, s.spec) + relayed.reviews.spec
        s.fixed = (s.fixed ?? 0) + relayed.reviews.fixed
        // Ses bogues, comme dans la discussion du parcours : cités, et comptés dans l'alerte « constats > corrigés ».
        const { standards, spec, fixed, bugs } = relayed.reviews
        log(run, now, '◈', `Revues du groupe ${g.id} (session liée) : ${standards} Standards · ${spec} Spec${bugsText(bugs)} · ${fixed} corrigé(s)`, standards + spec + (bugs ?? 0) > fixed ? 'warn' : 'info')
      }
      // La revue de sécurité relayée vaut celle que la discussion n'a pas encore reçue (un envoi d'ici
      // l'emporte) ; ses failles laissées ne sont qu'une proposition : seul un envoi d'ici tranche.
      const sec = relayed?.security
      const security: SecurityCheck | undefined =
        sec && g.security?.findings === undefined
          ? {
              ...(sec.advised !== undefined ? { isAdvised: sec.advised } : {}),
              ...(sec.why !== undefined ? { why: sec.why } : {}),
              ...(sec.findings !== undefined ? { findings: sec.findings, fixed: sec.fixed ?? 0 } : sec.fixed === UNREADABLE_COUNT ? { findings: UNREADABLE_COUNT } : {}),
              ...g.security,
              ...(sec.dismissed !== undefined ? { proposedDismissed: sec.dismissed } : {}),
              ...(ranAt !== undefined ? { ranAt } : {}),
            }
          : sec?.dismissed !== undefined
            ? { ...g.security, proposedDismissed: sec.dismissed, ...(ranAt !== undefined ? { ranAt } : {}) }
            : ranAt !== undefined
              ? { ...g.security, ranAt }
              : g.security
      // Le retour d'un envoi efface la marque de la remise à zéro : la revue et l'avis de cet envoi arrivent avec lui.
      const { isReset: _reset, ...kept } = g
      const sentLink = g.linked!
      return withoutLink({
        ...kept,
        // Confié de nouveau puis rendu : une autre session, à fermer à son tour ; la précédente reste
        // notée (`earlier`) : fermée, elle ne redevient jamais à fermer ; sinon, elle reste à fermer.
        delegated: g.delegated
          ? {
              ...sentLink,
              earlier: [
                ...earlierOf(g.delegated),
                {
                  at: g.delegated.at,
                  ...(g.delegated.session ? { session: g.delegated.session } : {}),
                  ...(g.delegated.seq !== undefined ? { seq: g.delegated.seq } : {}),
                  ...(g.delegated.closing ? { closing: g.delegated.closing } : {}),
                },
              ].filter((x, i, all) => x.closing?.state !== 'closed' || all.length - i <= EARLIER_MAX),
            }
          : sentLink,
        ...(reviewedAt !== undefined ? { reviewedAt } : {}),
        ...(security !== undefined ? { security } : {}),
      })
    })
    if (reviewedThere.length > 0) log(run, now, '◆', `Revue du groupe faite dans sa session liée : ${reviewedThere.join(', ')}`, 'accent')
    log(run, now, '↩', `${back.length > 1 ? `Groupes ${back.join(', ')} rendus` : `Groupe ${back[0]} rendu`} par ${back.length > 1 ? 'leurs sessions liées' : 'sa session liée'}`, 'ok')
  }
  return { back, unknown }
}

export const CLOSE_STATES: readonly Closing['state'][] = ['closed', 'app', 'stopped']

/** Les sessions précédentes gardées sur le lien rendu d'un groupe, au plus. */
const EARLIER_MAX = 10

/**
 * Le numéro d'envoi d'un groupe : celui de son envoi en cours, sinon celui que prendrait le suivant
 * (1 pour un groupe jamais confié ; un envoi sans numéro est le premier).
 */
export const groupSendSeq = (g: TicketGroup): number => {
  if (g.linked) return sendNumber(g.linked.seq) ?? 1
  // Le compteur du groupe ne recule pas (un envoi annulé garde son numéro) ; l'historique, pour un groupe d'avant lui.
  const sent = [...(g.delegated ? [g.delegated] : []), ...earlierOf(g.delegated)]
  const counted = sendNumber(g.sends) ?? 0
  return maxOf([counted, ...sent.map(l => sendNumber(l.seq) ?? 1)]) + 1
}

/**
 * Un groupe déjà confié à une session liée : en cours (`linked`), rendu (`delegated`), fermé ou non,
 * ou dont l'envoi a été annulé (`sends` gardé : sa session a pu créer son worktree et sa branche).
 */
export const isSentGroup = (g: TicketGroup): boolean => g.linked !== undefined || g.delegated !== undefined || g.sends !== undefined

/**
 * Un groupe que garde chaque chemin qui élague le plan (renvoi des groupes, retrait de tickets) : il
 * a des tickets, ou il a été confié à une session liée, même vide (son lien, sa fermeture et son
 * compteur d'envois ne se perdent jamais).
 */
export const isKeptGroup = (g: TicketGroup): boolean => g.tickets.length > 0 || isSentGroup(g)

/** Un groupe qui garde ses tickets contre un plan renvoyé : en cours, ou rendu sans être fermé. */
export const isHoldingGroup = (g: TicketGroup): boolean => g.linked !== undefined || (g.delegated !== undefined && !isClosedLink(g.delegated))

/** Un lien rendu dont chaque session, la sienne et les précédentes, est fermée. */
export const isClosedLink = (link: GroupLink | undefined): boolean =>
  link !== undefined && link !== null && typeof link === 'object' && link.closing?.state === 'closed' && earlierOf(link).every(e => e.closing?.state === 'closed')

/** Les sessions précédentes d'un lien rendu (une seule, en objet, avant qu'elles soient une liste). */
export const earlierOf = (link: GroupLink | undefined): ClosedLink[] => {
  const e = link?.earlier as ClosedLink[] | ClosedLink | undefined
  // Relue du tableau de bord : une entrée d'un autre type n'est pas une session.
  return (Array.isArray(e) ? e : e ? [e] : []).filter(x => x !== null && typeof x === 'object')
}

/** Une fermeture arrêtée redevient à faire quand un appel a touché le groupe depuis, ou sur « ↻ Relancer la fermeture ». */
export const isRetried = (link: GroupLink): boolean => isRetriedSince(link.closing, link.touchedAt, link.closeAskedAt)

/**
 * Une fermeture arrêtée est relancée : un appel l'a touchée, ou la personne l'a demandé, après elle.
 * Des dates relues hors forme ne relancent jamais rien (une date infinie la relancerait sans fin).
 */
export const isRetriedSince = (closing: Closing | undefined, touchedAt: unknown, closeAskedAt: unknown): boolean => {
  if (closing !== undefined && (closing === null || typeof closing !== 'object' || !isTime(closing.at))) return false
  const at = closing?.at ?? 0
  return (isTime(touchedAt) && touchedAt > at) || (isTime(closeAskedAt) && closeAskedAt > at)
}

/**
 * La session des éléments d'une phase (les pistes d'une rétro) est à fermer : lancée, chacun de ses
 * éléments jugé (fait, écarté ou revenu au choix), sans fermeture en cours ou après une relance.
 */
export const isItemsCloseCandidate = (phase: FlowPhase): boolean => {
  const link = phase.linked
  if (!link?.session || linkedInFlight(phase).length > 0) return false
  return link.closing === undefined || (link.closing !== null && typeof link.closing === 'object' && link.closing.state === 'stopped' && isRetriedSince(link.closing, link.touchedAt, link.closeAskedAt))
}

/**
 * Ce qui sert à rouvrir une session fermée entre dans une commande (ticket « Rouvrir ») : chaque
 * champ n'est gardé que s'il a sa forme sûre, la raison d'un refus sans la valeur refusée.
 */
const REOPEN_FIELDS = {
  sessionId: { isValid: (v: string) => isSessionId(v), why: 'not a full session id: the sessionId of claude agents --json (a UUID), or an app id local_…' },
  branch: { isValid: (v: string) => isSafeBranch(v), why: 'not a safe branch name: only letters, digits, ., _, / and -, no leading -' },
  worktree: { isValid: (v: string, root: string) => isWorktreePath(v, root), why: 'not an absolute path <repository>/.claude/worktrees/<name>, the name in ASCII [A-Za-z0-9._-] with no leading . or -' },
} as const

/**
 * Une entrée `closed` lue : son état et ce qui sert à rouvrir la session, à côté de l'état d'avant.
 * Un champ hors forme n'est pas gardé (le précédent reste) et se nomme dans `refused`.
 */
export const closingOf = (e: Record<string, unknown>, state: Closing['state'], was: Closing | undefined, now: number, root: string, refused: string[]): Closing => {
  const reason = closingReason(e.why)
  const why = reason !== '' ? { why: reason } : {}
  const fields: Partial<Pick<Closing, keyof typeof REOPEN_FIELDS>> = {}
  for (const key of Object.keys(REOPEN_FIELDS) as (keyof typeof REOPEN_FIELDS)[]) {
    // Tel qu'envoyé, sans fondre ses blancs intérieurs : un saut de ligne le rend hors forme ; une
    // valeur qui n'est pas une chaîne (true, 123) est refusée, jamais convertie.
    const raw = e[key]
    const value = typeof raw === 'string' ? raw.trim() : raw === undefined || raw === null ? '' : JSON.stringify(raw)
    if (typeof raw === 'string' && value !== '' && REOPEN_FIELDS[key].isValid(value, root)) fields[key] = value
    else {
      if (value !== '') refused.push(`${key} (${REOPEN_FIELDS[key].why})`)
      if (was?.[key] !== undefined) fields[key] = was[key]
    }
  }
  // Une fermeture « closed » renvoyée garde sa marque de suppression tant que sa branche notée ne change pas.
  const isMarked = state === 'closed' && was?.state === 'closed' && was.cleanupAt !== undefined && fields.branch === was.branch
  return { state, at: now, ...why, ...fields, ...(isMarked ? { cleanupAt: was.cleanupAt } : {}) }
}

/** La fermeture que l'autre copie a notée pour le même lien : sur ce lien, ou dans ceux qu'un nouvel envoi y a remplacés. */
const sameLinkClosing = (ours: { at: number; session?: string } | undefined, theirs: (ClosedLink | GroupLink | LinkedWork) | undefined, earlier: readonly ClosedLink[]): Closing | undefined => {
  if (!ours) return undefined
  const isSame = (l: { at: number; session?: string } | undefined) => l !== undefined && l.at === ours.at && l.session === ours.session
  if (isSame(theirs) && theirs!.closing) return theirs!.closing
  return earlier.find(l => isSame(l) && l.closing)?.closing
}

/**
 * Une fermeture plus avancée : présente quand la nôtre manque, « closed » quand la nôtre ne l'est pas,
 * ou marquée par la consigne de suppression des branches quand la nôtre, sur la même branche, ne l'est pas.
 */
const isAhead = (ours: Closing | undefined, theirs: Closing): boolean =>
  !ours ||
  (theirs.state === 'closed' && ours.state !== 'closed') ||
  (theirs.state === 'closed' && ours.state === 'closed' && theirs.cleanupAt !== undefined && ours.cleanupAt === undefined && theirs.branch === ours.branch)

/**
 * La fusion de deux copies d'un même parcours garde la plus récente ; l'état de fermeture d'une
 * session liée (groupe ou pistes), lui, ne recule jamais : celui de l'autre copie revient quand il est plus avancé.
 */
export const keepClosings = (kept: Run, other: Run | undefined): Run => {
  if (!other) return kept
  let changed = false
  const groups = (kept.groups ?? []).map(g => {
    const link = other.groups?.find(x => x.id === g.id)?.delegated
    if (!g.delegated) return g
    // Le même lien seulement (même envoi, même session) : un groupe confié de nouveau a une autre session.
    const theirs = sameLinkClosing(g.delegated, link, earlierOf(link))
    let delegated = theirs && isAhead(g.delegated.closing, theirs) ? { ...g.delegated, closing: theirs } : g.delegated
    // Les sessions précédentes, chacune avec la fermeture la plus avancée des deux copies.
    const mine = earlierOf(g.delegated)
    const mergedEarlier = mine.map(prev => {
      const found = sameLinkClosing(prev, link, earlierOf(link))
      return found && isAhead(prev.closing, found) ? { ...prev, closing: found } : prev
    })
    if (mergedEarlier.some((x, i) => x !== mine[i])) delegated = { ...delegated, earlier: mergedEarlier }
    if (delegated === g.delegated) return g
    changed = true
    return { ...g, delegated }
  })
  const phases = kept.phases.map((p, i) => {
    const same = other.phases[i]?.skill === p.skill ? other.phases[i]! : undefined
    let next = p
    if (same?.linkedEarlier && !p.linkedEarlier) next = { ...next, linkedEarlier: same.linkedEarlier }
    // La même session gardée à côté du lien dans les deux copies : sa fermeture la plus avancée, marque comprise.
    else if (same?.linkedEarlier?.closing && p.linkedEarlier && same.linkedEarlier.at === p.linkedEarlier.at && same.linkedEarlier.session === p.linkedEarlier.session && isAhead(p.linkedEarlier.closing, same.linkedEarlier.closing))
      next = { ...next, linkedEarlier: { ...p.linkedEarlier, closing: same.linkedEarlier.closing } }
    const theirs = sameLinkClosing(p.linked, same?.linked, same?.linkedEarlier ? [same.linkedEarlier] : [])
    if (theirs && p.linked && isAhead(p.linked.closing, theirs)) next = { ...next, linked: { ...p.linked, closing: theirs } }
    if (next !== p) changed = true
    return next
  })
  return changed ? { ...kept, ...(kept.groups ? { groups } : {}), phases } : kept
}

/**
 * La consigne de suppression des branches est partie : chaque fermeture « closed » du parcours dont la
 * branche notée est l'une de celles qu'elle visait, et qu'une consigne écrite maintenant viserait
 * encore, reçoit sa marque (`cleanupAt`) ; une fermeture déjà marquée la garde.
 */
export const markCleanupSent = (board: Board, runId: string, branches: readonly string[], now: number): Outcome => {
  const b = clone(board)
  const run = b.runs.find(r => r.id === runId)
  if (!run) return null
  const sent = new Set(branches)
  let changed = false
  const mark = (target: CloseTarget, seq: unknown, closing: Closing | undefined) => {
    if (!closing || closing.state !== 'closed' || closing.cleanupAt !== undefined || !sent.has(closing.branch ?? '')) return
    const fate = branchFate(run, target, seq, closing)
    if ('branch' in fate && fate.branch === closing.branch) {
      closing.cleanupAt = now
      changed = true
    }
  }
  // Les mêmes gardes que le plan de la consigne : une entrée relue qui n'est pas un objet est ignorée,
  // et une fermeture se lit par le garde du plan lui-même (`readClosing`).
  const isEntry = <T,>(x: T | null | undefined): x is T => x !== null && typeof x === 'object'
  for (const g of (Array.isArray(run.groups) ? run.groups : []).filter(isEntry)) {
    const target = { kind: 'group', id: g.id, name: g.name } as const
    const link = isEntry(g.delegated) ? g.delegated : undefined
    for (const prev of earlierOf(link)) mark(target, prev.seq, readClosing(prev.closing))
    if (link) mark(target, link.seq, readClosing(link.closing))
  }
  for (const phase of (Array.isArray(run.phases) ? run.phases : []).filter(isEntry)) {
    if (!SKILLS[phase.skill]?.items) continue
    const target = { kind: 'items', skill: phase.skill } as const
    if (isEntry(phase.linkedEarlier)) mark(target, phase.linkedEarlier.seq, readClosing(phase.linkedEarlier.closing))
    if (isEntry(phase.linked) && phase.linked.session) mark(target, phase.linked.seq, readClosing(phase.linked.closing))
  }
  if (!changed) return null
  // Lue après l'envoi, l'heure ne fait jamais reculer le parcours face à une écriture faite entre-temps.
  run.updatedAt = Math.max(run.updatedAt, now)
  return { board: b, fx: noFx() }
}

/**
 * Une session liée a été demandée ou lancée par ce parcours (groupe ou éléments d'une phase) : son
 * brief nomme la discussion, dès la demande mise dans le prompt. Une demande en cours se lit sur le
 * groupe ou la phase (« Annuler » la retire) ; une session lancée, sur `linkedAt`, gardé même quand
 * ses éléments reviennent ensuite à faire ; les groupes confiés avant ce champ comptent aussi.
 */
export const hasLaunchedLinked = (run: Run): boolean =>
  run.linkedAt !== undefined || (run.groups ?? []).some(g => g.linked !== undefined || g.delegated !== undefined) || run.phases.some(p => p.linked !== undefined)

/**
 * Ce qu'un groupe garde quand son plan est réécrit : tout ce qui ne vient pas du plan (son lien en
 * cours ou rendu, ses envois, sa revue, son avis de sécurité, sa remise à zéro). Un champ ajouté à un
 * groupe va ici ou dans le plan : un test le vérifie, champ par champ.
 */
export const KEPT_GROUP_FIELDS = ['reviewedAt', 'security', 'linked', 'delegated', 'sends', 'isReset'] as const

/** Les champs gardés d'un groupe enregistré, à poser sur le groupe du nouveau plan : ceux qui existent, et la remise à zéro seulement si elle vaut `true`. */
export const keptGroupFields = (was: TicketGroup | undefined): Partial<TicketGroup> => {
  const kept: Record<string, unknown> = {}
  for (const key of KEPT_GROUP_FIELDS) if (was !== undefined && (key === 'isReset' ? was[key] === true : was[key] !== undefined)) kept[key] = was[key]
  return kept as Partial<TicketGroup>
}
