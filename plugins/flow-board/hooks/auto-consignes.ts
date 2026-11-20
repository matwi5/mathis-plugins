// Les consignes du mode auto : les six catégories qui restent à la personne, la zone sensible, l'advisor, la
// note de chaque phase (`autoNote`, `AUTO_PHASE_NOTES`), le cadrage et le tri d'une mission lancée par le COO,
// et le message d'allumage (`autoOnNotice`, `autoBriefText`). Sortis de `register.tsx`, que le moteur ne lit
// plus au-delà de 1 048 576 octets, par `scripts/deplace.py` (octets identiques). Module pur : ni le moteur
// (`$`), ni le stockage ; il ne lit la mission que par ses arguments.

import type { Run } from '../types'
import { SENSITIVE_AREAS, SKILLS } from './catalog.ts'
import { OPPOSITION_PREFIX, RELAUNCH_PREFIX, STALE_PREFIX, autoQuestionsNotice } from './model.ts'
import { currentPhase } from './basics.ts'
import { liveLaunchOf } from './launch.ts'

/** Les six catégories de décisions qui restent à la personne en auto : jamais un choix déclaré. */
const AUTO_CATEGORIES_EN: readonly string[] = [
  "an experience choice: what the user sees and does (layout, mockup, labels, buttons, notifications), or any question whose options are technically equal and differ only by the user's preference",
  'setting or weakening an invariant, or a design change that contradicts DECISIONS.md or a decision already taken with the user',
  "a deletion with no way back, or an exposure of the user's data outside this machine (a publication, for example)",
  'leaving a security finding unfixed',
  "the Fable path for a worker: never take it yourself; suggest it only for a bug Opus did not solve; xhigh comes from a ticket's « Jugement » line, declared at the split",
  'a spending or an external action outside the mission (installing a heavy dependency, writing to a third-party service)',
]

/**
 * Une question en zone sensible tranchée sans la personne, en auto : à la condition fixée par la
 * personne, marquée dans le texte du choix pour que le compte rendu la range à part.
 */
const AUTO_SENSITIVE = `- A question in a sensitive area (${SENSITIVE_AREAS}) is settled by you when its recommended option respects the invariant already validated (when there is one) and is the most prudent one (it loses nothing, exposes nothing, deletes nothing without a way back): code it and declare it as a recommendation taken, its "what" beginning with « Zone sensible : » ({"decided": [{"what": "Zone sensible : <the choice>", "why": "...", "origin": "recommendation"}]}), so that the report lists it apart for the user to reread; otherwise it stays a blocking question. A breach of the invariant that the high pass after the bug pass's fixes still finds, fixed in the most prudent way, is written as a test and goes out as one line of information, declared as a recommendation taken beginning with « Zone sensible : », not as a question. In auto mode, this wins over any line above that says a sensitive choice is never declared or is settled with the user.`

/**
 * L'advisor en auto : avant de coder une décision prise seul hors cadrage, une fois par décision, en plus des
 * moments de la règle « Consulter l'advisor ». Un worker Fable ne le consulte pas (l'advisor tourne sur son modèle).
 */
const AUTO_ADVISOR =
  "- Before coding a decision you take alone outside the framing (a design change, a question in a sensitive area settled by you), consult the advisor (the advisor tool, when you have it), once per decision; without it, reread your decision yourself (the options, what each one commits to) before committing to it. This adds to the moments of the rule « Consulter l'advisor »."

/** Ce que Claude fait des failles et des constats sur du code antérieur, en implémentation et aux revues. */
const AUTO_FINDINGS =
  '- Findings in auto mode: when a security review comes back, fix every kept finding without asking the user (apply, test, commit, then send "fixed"); leaving one unfixed is the user\'s decision, a blocking question on its group (or on this phase without groups). Findings that reviews kept apart on code older than the lot: do not propose a « durcissement » group; list them for the report.'

/**
 * Avant une série tranchée seule au cadrage, les invariants qui nomment la donnée touchée : une série
 * en auto avait tranché seule deux points qu'un invariant déjà validé réglait, défaits ensuite par l'advisor.
 */
const AUTO_INVARIANTS_FIRST =
  'Before writing a series you settle yourself, search the decision files of the project (every DECISIONS.md, or the files and the search tool its CLAUDE.md names) for the invariants that name the data each question touches, and quote them in the series (the file and the series); you never weaken nor rewrite an invariant you find: a recommendation that would do so stays a blocking question.'

/** Les blocs propres à une phase, par skill ; la revue, la passe et la sécurité suivent l'implémentation. */
const AUTO_PHASE_NOTES: Record<string, string> = {
  'to-spec':
    '- Spec in auto mode: the seams are not asked: settle them by your recommended answer, write them in the decision file as « acceptée en auto (reco) » and declare them ("origin": "recommendation"); the validation of the spec is not asked either: declare it ("origin": "skipped-validation", with the path or link of the spec), then publish it; the tracker writes of the mission (the spec published) are made without asking again. A question of a sensitive area that does not meet the condition above to be settled by you, and setting or weakening an invariant, stay blocking questions on this phase ("phase": "to-spec"). ' + AUTO_INVARIANTS_FIRST,
  'to-tickets':
    '- Ticket split in auto mode: the breakdown is not approved by a button question: declare it ("origin": "skipped-validation", with the path of the tickets or the tracker link), then publish; the tracker writes of the mission (the tickets created, their statuses) are made without asking again, declared once ("origin": "skipped-validation", with their list). The « Jugement » lines are not validated either: declare the judgement tickets in a single choice, its "what" worded « Tickets de jugement, en xhigh le temps du ticket : <id> (<critère>), … » (<critère> being « jugement sur un existant » or « objectif ouvert »), "origin": "recommendation", or, when that choice would exceed 300 characters (a choice is cut there), in several choices with the same wording, each under 300 characters and naming other tickets; none when no ticket says « Jugement : oui ». Setting or weakening the invariant of a sensitive ticket (except the invariant of a ticket that is only sensitive, with no shared data nor deletion: you write it and declare it with the breakdown, without a question), and a sensitive question that does not meet the condition above to be settled by you, stay blocking questions on this phase ("phase": "to-tickets").',
  implement: `- Implementation in auto mode: flow-board itself sends, at the end of a turn, the request to launch the next wave of groups (once every group of the current wave is closed), the review of a group that came back without one and its advised security review: do not ask the user to press the dashboard buttons. Launch the workers at the effort of the rule (medium; high for a group that touches several code modules: documentation and travail/ or docs/ do not count), never Fable; xhigh comes from the « Jugement » line of a ticket, which the session's mod applies while that ticket is in progress, so a group that carries one is launched at the effort of the rule too, with no effort question. A group that came back with a ticket set aside because it stalls after three approaches (its report names it, « bute après trois approches »; section 11 of the procedure, « Ticket qui bute », in effort-workers.md): in the same flow call as its return, set that ticket back to todo and ask a blocking question on that group, worded « Le ticket <id> bute après trois approches, la dernière guidée par l'advisor. Pour le relancer : « ↗ Fable » (recommandé) ou « ↗ xhigh » sur le groupe <G>. » (only « ↗ xhigh » for a ticket in an area of the security review): {"returned": ["<G>"], "set": [{"id": "<id>", "status": "todo"}], "waiting": [{"id": "bute-<id>", "group": "<G>", "text": "<that sentence>"}]}; the auto mode never launches a group a question blocks and asks no relaunch question of its own, the other groups go on, and the user's click on « ↗ Fable » or « ↗ xhigh » is the answer: withdraw the question when you launch the group. If the ticket stalls again after that relaunch, no further relaunch: a blocking question on the ticket, to replan with the user, under a new id (an answered id never reopens): {"waiting": [{"id": "replanifier-<id>", "ticket": "<id>", "text": "<short>"}]}. A group that came back with failed checks: leave its tickets concerned not done ({"set": [{"id": "<ticket>", "status": "todo"}]}).\n${AUTO_FINDINGS}`,
  'final-review': AUTO_FINDINGS,
  'code-review': AUTO_FINDINGS,
  'branch-review': AUTO_FINDINGS,
  'security-review': AUTO_FINDINGS,
  'compte-rendu':
    '- Report in auto mode: the auto mode stops once the report is written ({"step": "validate"}): it never validates it; validating it, /project:version and /project:push stay with the user. In the report, keep « Décidé sans toi » grouped by origin, the sensitive choices settled in auto (their text beginning with « Zone sensible : ») first and apart, and list the findings on code older than the lot that the reviews kept apart in its « Code antérieur au lot » section, for the user to decide on a « durcissement » group.',
}

/**
 * Le bloc de l'Implémentation en auto d'un lot sans groupes : Claude lance la revue du lot lui-même (aucune pour un
 * lot d'un seul ticket : son avis de sécurité seul) ;
 * flow-board la relance, puis sa sécurité conseillée, quand elles n'ont pas été lancées ; le compte
 * rendu ne part qu'après le `{"complete": true}` du lot relu et tranché, ou dispensé.
 */
const AUTO_LOT_IMPLEMENT = `- Implementation in auto mode, without groups: launch the lot review yourself, as the /implement instructions say (section 4 of the procedure, in procedure-groupe-fin.md, on <lot base>..HEAD, <lot base> being the commit before the lot's first ticket), with its security advice once the review has loaded, never before it; if it has not been launched (an interrupted discussion), flow-board itself sends it at the end of a turn, then the lot's advised security review when it was not launched: do not ask the user to press the dashboard buttons. A lot of a single ticket, attached ones included, has no lot review: give its security advice, unless dispensed, once that ticket is done; when it is missing (an interrupted discussion), flow-board asks for it at the end of a turn. Neither leaves while a background task runs or a question blocks this phase. Once every ticket is done, the lot reviewed and its security settled, or the lot dispensed, send {"complete": true}: the auto mode sends the report only after it. Leaving a security finding unfixed is the user's decision, a blocking question on this phase ("phase": "implement"): it holds back the lot's sends and the report. A ticket that stalls after three approaches (section 3 of the procedure, « Ticket qui bute », in procedure-groupe-cas.md): stop on it and ask a blocking question on that ticket ({"waiting": [{"id": "bute-<id>", "ticket": "<id>", "text": "<short>"}]}) that reminds the user of « 🐞 Bug · worker » (Opus high, then xhigh).\n${AUTO_FINDINGS}`

/** Le bloc du cadrage (un grilling) : un seul tour d'intention avec la personne, puis les recos prises. */
const AUTO_FRAMING_REST =
  'Then settle each other question yourself with your recommended answer: write it in the decision file (DECISIONS.md, or the one the project\'s CLAUDE.md names) as « acceptée en auto (reco) », the question and the answer word for word, and declare it ("origin": "recommendation"); a question of the six kinds above, or a sensitive one that does not meet the condition above to be settled by you, stays a blocking question. ' + AUTO_INVARIANTS_FIRST + ' The final agreement is not asked: declare it ("origin": "skipped-validation", with the path of the decision file), then {"complete": true}.'

const AUTO_FRAMING = `- Framing in auto mode: one round only with the user, on intent (the goal, the scope, what is out of scope), asked in one go in your message; wait for those answers (they are not blocking questions). ${AUTO_FRAMING_REST}`

/**
 * Le cadrage en auto d'une mission lancée par le COO : le COO a recueilli le tour d'intention dans
 * `travail/<dossier>/demande.md` (le dossier relu du rattachement, en forme) ; le manager saute ce tour
 * quand le fichier existe, et ne le réécrit jamais. Null pour une autre mission.
 */
const launchedFraming = (run: Run): string | null => {
  const intent = launchedIntent(run)
  return intent === null ? null : `- Framing in auto mode, for a mission launched by the COO: ${intent} When it exists, skip the intent round: its answers are the user's intent, you never rewrite it, and from then on the decision file of the mission is the reference. When it does not exist, ask the intent round, one round only, in one go in your message, and wait for those answers (they are not blocking questions). ${AUTO_FRAMING_REST}`
}

/**
 * Le tour d'intention qu'a recueilli le COO pour une mission qu'il a lancée en auto, dans `travail/<dossier>/demande.md`
 * (le dossier relu du rattachement, en forme) : la phrase commune au cadrage et au tri. Null pour une autre mission.
 */
const launchedIntent = (run: Run): string | null => {
  const card = liveLaunchOf(run)
  // Seulement une mission lancée en auto : le COO ne recueille ce tour que pour elle.
  if (!card || card.mode !== 'auto') return null
  return `the COO gathered the intent round (the goal, the scope, what is out of scope) with the user in travail/${card.folder}/demande.md. Read that file first.`
}

/**
 * Le tri en auto d'une mission lancée par le COO : il lit d'abord `demande.md`, comme un cadrage ; sans ce fichier,
 * il part des entrées que nomme le premier message, sans tour d'intention. Null pour une autre mission.
 */
const launchedTriage = (run: Run): string | null => {
  const intent = launchedIntent(run)
  return intent === null ? null : `- Triage in auto mode, for a mission launched by the COO: ${intent} When it exists, its answers are the user's intent: you never rewrite it, and from then on the decision file of the mission is the reference. When it does not exist, go on from the entries the first message names, without an intent round.`
}

/**
 * Le bloc du tri en auto : pas d'attente après la recommandation ; le partage déclaré comme une validation sautée ;
 * les lignes « corrige » partent au découpage ; « écarte » et « renvoie » ne changent rien avant l'accord de la
 * personne, ni code ni entrée existante, une sous-ligne renvoyée se déclarant tout de suite mise de côté (le COO la copie en entrée
 * neuve « à décider ») ; une ligne « question » attend sur la phase Compte rendu, qui ne retient ni le découpage ni les
 * groupes (`blockingQuestions` de model.ts).
 */
const AUTO_TRIAGE =
  '- Triage in auto mode: do not wait after your recommendation. Once every entry is verified and tri.md is written, declare the partition as a skipped validation ({"decided": [{"what": "Partage du tri : <the path of tri.md>", "origin": "skipped-validation"}]}), then {"complete": true}: flow-board itself sends /to-tickets, which starts from the « corrige » rows. Nothing the triage drops or sends back changes before the user\'s agreement: an « écarte » row or an entry in state « renvoie » changes neither code nor roadmap. Only a sub-line in state « renvoie » is declared set aside right away, once tri.md is written ({"setAside": [{"text": "<the id of the entry it comes from>: <the sub-line>", "source": "tri.md"}]}): the roadmap\'s owner (the COO) copies it as a new entry « à décider », where only the user decides; no existing entry changes state. A « question » row is a blocking question on the Report phase ({"waiting": [{"id": "<short id>", "phase": "compte-rendu", "text": "<short>"}]}): it holds back only the report, never the ticket split nor the groups. Once the user has answered: write the answer in the decision file, the question and the answer word for word; update tri.md; when the answer gives a fix while the triage is still under way, its row becomes « corrige » in tri.md and no ticket is sent (the Tickets phase splits it: a ticket sent during the triage would skip that phase); when it comes later, add a ticket to the lot ({"tickets": […]}): in a mission with groups, with its group (the whole plan again in {"groups": […]}); without groups (a plan of one group is ignored), do that ticket in this discussion, with the steps of a ticket of the lot (its checks, its review, its commit: the procedure /implement gives), before withdrawing the question; then withdraw the question ({"waiting": [{"id": "<id>", "answered": true}]}).'

/** La consigne du mode auto pour le skill `id` d'une mission en auto : le bloc commun, puis celui de sa phase. */
export const autoNote = (id: string, run: Run): string[] => {
  // Le texte fixé de la notification, son titre neutralisé par `autoQuestionsNotice` (le site admis de
  // `register.tsx`, d'où la fonction est sortie, ne se déplace pas : une liste d'admis n'augmente jamais).
  const notice = autoQuestionsNotice(run.title, 'N')
  const lines = [
    '- Auto mode is on for this mission (« ⚡ Auto »): the user\'s click (« Confirmer » here, or « Lancer en auto » on the COO\'s launch card) is their agreement, for this mission only, to its button validations (framing agreement, triage partition, spec, ticket split, work plan) and to the tracker writes it plans (the tickets created, their statuses). Do not ask for what it settles: flow-board itself sends the next step at the end of a turn, once this one is complete and nothing waits. If the auto mode is cut or paused while you work, the answer of the flow tool says so: from then on, the usual rules apply again (button validations, the user\'s agreement before a tracker write).',
    '- Each recommendation you take without the user is a declared choice: {"decided": [{"what": "...", "why": "...", "origin": "recommendation"}]} (« reco prise »). Each validation the auto mode skips is declared instead of a button question: {"decided": [{"what": "<what was validated, with the path or link of the validated text>", "origin": "skipped-validation"}]} (« validation sautée »).',
    AUTO_SENSITIVE,
    AUTO_ADVISOR,
    `- Six kinds of decisions stay with the user even in auto mode, always as blocking questions, never as declared choices: ${AUTO_CATEGORIES_EN.map((c, i) => `${i + 1}) ${c}`).join('; ')}. Ask it in your message (options, the recommended one first) and declare it: {"waiting": [{"id": "<short id>", "phase": "<skill id>" | "group": "<group id>" | "ticket": "<ticket id>", "text": "<the question, shown on the dashboard only>"}]}; for kinds 4) and 6), add the gesture the user can make with a click in the COO's dashboard, applied here by flow-board: "gesture": "spend" or "external" (the user allows or refuses it), or "gesture": "flaw" with "dismissed": <the total of kept findings left unfixed once the user agrees>, on its group (or on this phase without groups). Only what it blocks waits: go on with the rest. Once the user has answered, withdraw it: {"waiting": [{"id": "<id>", "answered": true}]}. A question whose id starts with « ${STALE_PREFIX} » is the mod's (« envoi resté sans suite »): never withdraw it; the user answers it with « ↻ Renvoyer » on the dashboard, or by launching the step. A question whose id starts with « ${RELAUNCH_PREFIX} » is the mod's too (a group back too many times from its worker): while the group still has open tickets in the plan and is not sent again, the flow tool refuses its withdrawal; the user relaunches the group (« ↗ Worker »), or answers otherwise (its open tickets set done, or removed from the lot with "remove"): then withdraw it. A question whose id starts with « ${OPPOSITION_PREFIX} » is the mod's too (opposed decisions of two missions, raised by the COO): never ask it here, where an answer does not lift it, and never withdraw it; tell the user to answer it in the COO's discussion, which applies the answer, and the dashboard withdraws it itself.`,
    `- Each time you declare blocking questions, also send one PushNotification (a deferred tool: load it with ToolSearch, select:PushNotification) with exactly this text and nothing else, neither the question nor any code: « ${notice} », N being the open questions of the mission once yours are declared (the answer of the flow tool says « waiting: N question(s) »).`,
  ]
  if (SKILLS[id]?.isGrilling) lines.push(launchedFraming(run) ?? AUTO_FRAMING)
  if (id === 'triage') lines.push(...[launchedTriage(run), AUTO_TRIAGE].filter((l): l is string => l !== null))
  const own =id === 'implement' && (run.groups ?? []).length === 0 ? AUTO_LOT_IMPLEMENT : AUTO_PHASE_NOTES[id]
  if (own) lines.push(own)
  return lines
}

/**
 * Ce que Claude fait de la consigne reçue en cours de phase, avant que flow-board envoie la suite. Les
 * questions d'intention d'un cadrage restent à la personne, comme le dit le bloc du cadrage en auto.
 */
const AUTO_BRIEF_CORE =
  'Before flow-board sends the next step, reread your last message to the user: each question still open (not one the user already answered, nor one whose answer the COO relayed: apply that answer, and if it settles only part of the question, declare only the rest, under a new id, its question first, then the quote of the answer) that is of the six kinds below is a blocking question, to declare in "waiting", like a question in a sensitive area that does not meet the condition of the auto mode block to be settled by you; settle each other open question with your recommended answer, declared ("origin": "recommendation"), except the intent questions of a framing (the goal, the scope, what is out of scope), which wait for the user\'s answer; send to the dashboard the work the user already agreed to that it does not show yet (tickets, groups).'

/** Donnée en plein tour, par la réponse de l'outil : Claude déclare, puis poursuit la phase. */
export const AUTO_BRIEF_IN_TURN = `${AUTO_BRIEF_CORE} Then go on with the current phase: never launch the next step yourself, flow-board sends it at the end of a turn once the phase is complete and nothing waits.`

/** Donnée au repos, par le message du mod : Claude déclare, puis rend la main, sauf s'il reste à faire dans la phase. */
const AUTO_BRIEF_AT_REST = `${AUTO_BRIEF_CORE} Then end your turn, unless the current phase still has work for you, which you go on with: never launch the next step yourself, flow-board sends it at the end of a turn once the phase is complete and nothing waits.`

/**
 * La consigne d'un allumage pour la phase en cours de `run` : l'avis de la réponse de l'outil comme le
 * message du mod. Elle part aussi après `/reload-plugins` ou un redémarrage, sans nouvel allumage : le
 * texte ne dit pas que la personne vient de cliquer. L'id de la phase vient du fichier partagé : il
 * n'entre dans le texte que s'il est celui d'un skill connu.
 */
const autoBriefLines = (run: Run, brief: string): string[] => {
  const readSkill = currentPhase(run).skill
  // Une clé héritée (`constructor`) ne fait entrer aucun texte : seul l'id d'un skill connu sert.
  const skill = Object.hasOwn(SKILLS, readSkill) ? readSkill : ''
  const phase = skill !== '' ? ` (${skill})` : ''
  return [`Auto mode is ON for this mission now, and you have not received its instructions yet: it was lit, or flow-board was reloaded, while the current phase${phase} was under way. ${brief}`, ...autoNote(skill, run)]
}

/** L'avis « auto allumé » d'une réponse de l'outil, donné en cours de phase. */
export const autoOnNotice = (run: Run): string => ['', '', '---', ...autoBriefLines(run, AUTO_BRIEF_IN_TURN)].join('\n')

/** Le début fixe du message de consigne que le mod envoie à Claude au repos. */
export const AUTO_BRIEF_HEAD = '⚡ flow-board: the auto mode instructions for this mission, before it sends anything.'

/** Le message que le mod envoie à Claude au repos : la même consigne, annoncée comme venant de flow-board. */
export const autoBriefText = (run: Run): string => [AUTO_BRIEF_HEAD, ...autoBriefLines(run, AUTO_BRIEF_AT_REST)].join('\n')
