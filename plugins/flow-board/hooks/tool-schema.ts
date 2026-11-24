// La description et le schéma de l'outil `flow` que le mod enregistre (`$.tool.register`), sortis de
// `register.tsx`, que le moteur ne lit plus au-delà de 1 Mio. Module pur : des textes et un schéma JSON.

import { JUDGMENT_FIELD, SECURITY_AREAS, SENSITIVE_AREAS } from './catalog.ts'
import { GROUP_ID_FORM, POSTPONED_STATE } from './closing.ts'
import { DISCUSSION_STATES } from './coordination.ts'
import { UNMARKED_ANSWERS } from './discussions.ts'
import { CARD_ENTRIES_MAX, LAUNCH_STARTS } from './launch.ts'
import { OPPOSITION_PREFIX, RELAUNCH_PREFIX, STALE_PREFIX, WAITING_MAX } from './model.ts'

export const TOOL_DESCRIPTION =
  'Live dashboard of the mattpocock-skills workflow (flow-board): silent bookkeeping, batched with your other tool calls. ' +
  'A loading skill ends with the step ids to report here; subagents, tests, commits, issues, PRs and workflow files are tracked on their own. ' +
  'A ticket waiting only for other tickets stays "todo" with "blockedBy"; "blocked" is for one waiting on something outside the lot (a decision of the user, an access, someone else\'s work), with "why". ' +
  'Tracker tasks created outside /to-tickets show by themselves under "found on the way": send one in "tickets" only when the lot depends on it; a ticket added to a lot with groups goes with "groups" again. ' +
  'Report at once in "decided" each choice the user neither asked for nor approved (not the routine steps of a skill, nor what you ask the user), in "setAside" each thing noted for later or another mission, and in "review" the findings of each code review. ' +
  'The reviews of a ticket and of a group follow the steps the skill text lists; with the review of a finished group, judge in "security" whether a security review is worth it, and if so launch it yourself (a read-only reviewer subagent on the group\'s diff, never /security-review), then send its findings; the user decides on their fixes. ' +
  'After /reload-plugins nothing needs sending again. ' +
  'A group delegated to a worker stays in this mission: when its session ends, check its work, send its tickets\' statuses in "set" with {"returned": ["<group id>"]}, and resend with "sensitive": true each ticket its report reclassified (a worker cannot send it). ' +
  'Once a returned group (or a retro\'s improvements worker) is closed, follow the answer\'s "Close now" procedure in the same move, then report in "closed". ' +
  '"open" (a new mission here, no skill; the rest of the call goes to it) and "fix" (title, phase, step of the active one) only at the user\'s request or to repair your own mistake; never open a mission on your own: with nothing active, the answer names the missions to resume, so ask the user; "remove" wrong tickets in a call before "open". ' +
  'A question that holds back part of the mission goes in "waiting"; resend it with "answered": true once answered.'

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: "Your title for the whole work, 3 to 6 words, in the user's language, never their message; only the first one sent is kept (fix.title changes it); the discussion where the mission was born takes it only if flow-board never named it (the answer says)" },
    step: { type: 'string', description: 'Id of the step of the current skill that starts now' },
    items: {
      type: 'array',
      description: 'Full list of the items the current skill tracks (hypotheses, candidates, seams, decisions, variants)',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: `For the tracks of a retro: ${GROUP_ID_FORM}. A new id out of that form gets one derived from it, which the answer names: send the track under it from then on`,
          },
          label: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'doing', 'done', 'dropped'] },
        },
        required: ['id', 'label'],
      },
    },
    tickets: {
      type: 'array',
      description: 'Tickets to add or update (id = tracker id, name = short title); unlisted ones are kept; to take some off, "remove"',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
          blockedBy: { type: 'array', items: { type: 'string' }, description: 'Ids of the tickets that must be done before this one' },
          why: { type: 'string', description: "With status blocked: what it waits for outside the lot, short, in the user's language" },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: "Repo paths the ticket touches, shared files included, added to its group's files; files, not a folder, unless the ticket creates files in it",
          },
          sensitive: { type: 'boolean', description: `Its line "Zone sensible": true when it touches a sensitive area (${SENSITIVE_AREAS})` },
          logic: { type: 'boolean', description: 'Its line "Logique": false for a visual asset or a document' },
          judgment: { type: 'boolean', description: JUDGMENT_FIELD },
        },
        required: ['id', 'name'],
      },
    },
    review: {
      type: 'object',
      description: 'After each review: findings per axis, fixed; bug pass in "bugs", content/form reading in "form" (never "spec"); its "ticket" or "group"',
      properties: {
        standards: { type: 'number' },
        spec: { type: 'number' },
        bugs: { type: 'number', description: 'All findings of a bug pass, tracks included; one send per pass; group review: standards/spec' },
        form: { type: 'number', description: 'From a worker after its group is back: not counted' },
        ticket: { type: 'string' },
        group: { type: 'string' },
        fixed: { type: 'number', description: 'Fixed by a commit, not just noted or documented' },
      },
    },
    security: {
      type: 'object',
      description:
        `Security review of a finished group (of the mission without groups): {"group", "advised", "why"}, your judgment, in the same message as the group review (without groups: once the mission's review is done); {"group", "findings", "fixed"} after the reviewer subagent; {"group", "dismissed"} once the user confirms leaving kept findings unfixed. Without groups, during the Implementation, the lot\'s advice is dated: the flow-board instructions of the lot review say when it counts`,
      properties: {
        group: { type: 'string', description: 'Group id; omitted = the last finished group, or the mission without groups' },
        advised: { type: 'boolean', description: `true when the changes touch an area of the security method's list (even if the security review is turned off for the project): ${SECURITY_AREAS}` },
        why: { type: 'string', description: "Why, short, in the user's language" },
        findings: { type: 'number', description: 'Kept findings (confidence 8/10 or more, high or medium severity), not the "to watch" list' },
        fixed: { type: 'number', description: 'How many of them were fixed' },
        dismissed: { type: 'number', description: 'The total of kept findings the user confirmed to leave unfixed; a send that changes "findings" without it resets it to 0, so resend it as the user decides. Only the manager\'s send settles the security; a worker\'s is a proposal' },
      },
    },
    closed: {
      type: 'array',
      description: 'Manager only, after the "Close now" procedure (or « ↻ Relancer la fermeture »): the result for each returned group; "closed" never goes back',
      items: {
        type: 'object',
        properties: {
          group: { type: 'string', description: 'Group id (A, B...)' },
          items: { type: 'string', description: 'Instead of "group": the phase skill whose items worker (a retro\'s improvements) was closed' },
          state: { type: 'string', enum: ['closed', 'app', 'stopped'], description: 'closed: session and worktree closed; app: user archives it in the app; stopped: closing stopped (why); only stopped for a bad id or noted worktree (form/clash)' },
          why: { type: 'string', description: "For app and stopped: the gesture or the reason, short, in the user's language" },
          sessionId: { type: 'string', description: 'For closed, when known: the full sessionId (script « session : » line, or claude agents --json) or the local_… id of an app session; else refused' },
          branch: { type: 'string', description: 'For closed, when known: the kept branch; letters, digits, ., _, / and - only, no leading -; else refused' },
          worktree: { type: 'string', description: 'For closed, when known: the removed worktree, <repository>/.claude/worktrees/<name>, absolute, the name in ASCII [A-Za-z0-9._-]; else refused' },
        },
        required: ['state'],
      },
    },
    decided: {
      type: 'array',
      description: `Choices made without the user's ask or approval, sent once. Never one in a sensitive area (${SENSITIVE_AREAS}): ask the user; except in auto mode, per its auto block, "what" starting « Zone sensible : »; ticked autonomy box: "what" is « [Zone sensible : ]Réglage : <box> : »`,
      items: {
        type: 'object',
        properties: {
          what: { type: 'string', description: "The choice, short, in the user's language" },
          why: { type: 'string', description: "Why, short, in the user's language" },
          origin: {
            type: 'string',
            enum: ['recommendation', 'skipped-validation', 'linked-session'],
            description: 'In auto mode: recommendation (your recommended answer, taken without the user), skipped-validation (framing agreement, triage partition, spec, ticket split, plan, Asana writes; the validated text\'s path or link in "what"), linked-session (a worker\'s choice); else omit',
          },
        },
        required: ['what'],
      },
    },
    withdrawn: {
      type: 'array',
      description: 'Declared choices no longer valid, with reason and any replacement; only those in force show',
      items: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'The choice exactly as declared' },
          why: { type: 'string', description: "Why it no longer holds, short, in the user's language" },
          replacedBy: { type: 'string', description: "The choice that replaces it, short, in the user's language" },
        },
        required: ['what', 'why'],
      },
    },
    remove: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ticket ids to take off the dashboard (sent by mistake, out of scope), groups, queue and blockedBy included',
    },
    set: {
      type: 'array',
      description: 'Status changes of tickets already listed (in the lot or found on the way)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
          why: { type: 'string', description: "With status blocked: what it waits for outside the lot, short, in the user's language" },
        },
        required: ['id', 'status'],
      },
    },
    externals: {
      type: 'array',
      description: 'Tasks outside the lot that tickets depend on (ids in their blockedBy); updated field by field, lifted by "status": "done", never removed',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Asana task GID, or a local id (another mission\'s session on the same files)' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['decision', 'task'], description: 'decision: a choice someone must make; task: work outside the lot' },
          status: { type: 'string', enum: ['todo', 'done'] },
          // Sans description : le budget des descriptions de l'outil est plein (outil-flow-textes.test.ts) ; la règle est dans
          // la consigne du découpage (`coachingNote`), et un envoi hors forme se fait dire la forme attendue (`noteTicket`).
          ticket: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
    groups: {
      type: 'array',
      description:
        'Execution plan, the full list (it replaces the previous one; every ticket in exactly one group): tickets grouped by shared context (same files or modules, or a dependency chain), one worker per group, never this discussion; /to-tickets gives the grouping rules. A group id has ' + GROUP_ID_FORM + '. A group already sent to a worker is never dropped (omitted, it stays last, even empty) and keeps its tickets while in flight or returned and not closed. Never a single group: a one-group plan is ignored (do the lot here with /implement); except in a retro mission, where it goes to a worker, and where, while the retro phase is current, a refused plan records nothing of the call',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short id (A, B, C…) in run order: a group that waits for another comes after it' },
          name: { type: 'string', description: "Short theme, in the user's language" },
          tickets: { type: 'array', items: { type: 'string' }, description: 'Ticket ids, in execution order' },
          why: { type: 'string', description: "The shared context, one short line in the user's language" },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Repo paths beyond its tickets\' files; groups sharing one never run in parallel; a folder covers its files: name files unless the group creates some there',
          },
          resources: {
            type: 'array',
            items: { type: 'string' },
            description: 'What it cannot share with a group working at the same time, same name in every group (an app driven on screen, a single database, device or account); groups sharing one never run in parallel',
          },
        },
        required: ['id', 'name', 'tickets'],
      },
    },
    reviewed: {
      type: 'array',
      items: { type: 'string' },
      description: 'Finished groups whose /code-review ran out of the dashboard\'s sight (in their worker: with "returned" when its report says so, or once it reports the review asked after the return)',
    },
    returned: {
      type: 'array',
      items: { type: 'string' },
      description: 'Groups whose worker ended, once you checked its work, with its tickets\' statuses in "set" in the same call; one stopped short comes back with its unfinished tickets',
    },
    delegate: {
      type: 'string',
      description:
        'Only when a worker\'s brief gives it, sent first with "group", "main": the id of the mission this discussion works for. Nothing is recorded on it from here; your progress reaches its dashboard on its own. Afterwards only "set" (a status no tracker or ticket file shows), "decided", "withdrawn", "review", "security", "report" or "reportPath", and "note" are accepted; your brief and procedure say when to send each',
    },
    group: {
      type: 'string',
      description: 'With "delegate": your group id, from the brief; manager: with "reportPath"',
    },
    model: {
      type: 'string',
      description: 'With "delegate" if the brief says Fable worker: "fable"; first call only',
    },
    report: {
      type: 'string',
      description: 'A worker\'s whole final report, kept in its relay file, which the manager rereads (also sent by SendMessage). In the manager, in « Compte rendu » only: the whole report the COO shows for the user to validate; resend it whole after any change',
    },
    reportPath: {
      type: 'string',
      description: 'A worker\'s main thread, instead of "report": absolute path of its .md or .txt file under your worktree or CLAUDE_JOB_DIR, 200 000 characters at most; other paths refused; with "report", neither. Manager: with "group", from its noted worktree',
    },
    main: {
      type: 'string',
      description: 'With "delegate": the manager\'s "[ref]" (or "<name> [ref]") from the brief; a restart gives a newer [ref]. With "resume", in the manager: your own [ref] of the moment (ListAgents), which the workers read',
    },
    resume: {
      type: 'string',
      description: 'Id of a mission of this project to take over here first; only when a brief or the user asks (a bug diagnosis worker sends it first, then the discussion that opened it)',
    },
    open: {
      type: 'object',
      description: "Only at the user's request: a new mission here, without a skill, pausing the active one; the rest of the call goes to it",
      properties: {
        title: { type: 'string', description: "Your title, 3 to 6 words, in the user's language, never their message" },
        entry: { type: 'string', description: 'Starting skill that shapes its phases (implement, to-tickets, grill-with-docs, diagnosing-bugs…); default implement' },
      },
      required: ['title'],
    },
    fix: {
      type: 'object',
      description: "Correct the active mission (the user's request or your mistake): its title, current phase (going back resets later phases), step; tickets and groups go through \"tickets\", \"set\", \"remove\", \"groups\"",
      properties: {
        title: { type: 'string', description: 'New title of the mission only; this discussion keeps its name' },
        phase: { type: 'string', description: 'Skill id of a phase to make current (to-tickets, implement…)' },
        step: { type: 'string', description: 'Step id of the current (or fixed) phase to make current; later steps become pending' },
      },
    },
    waiting: {
      type: 'array',
      description:
        'Questions blocking part of the mission (in auto, each decision left to the user): "id", one of "phase", "group", "ticket" it blocks, "text" (dashboard only). Before asking, reread DECISIONS.md: a settled question is not asked again; an answered id never reopens (new question, new id). Partial answer (« b et c », no label): apply it, ask only the rest under a new id (its question, then the quote), never the whole question. Send {"id", "answered": true} once answered; not the mod\'s « ' + STALE_PREFIX + '… », nor « ' + RELAUNCH_PREFIX + '… » while its group awaits relaunch, nor « ' + OPPOSITION_PREFIX + '… » (answered at COO). At most ' +
        WAITING_MAX +
        ' open. Workers: message the manager',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Your short id (Q1…), the same to withdraw it' },
          phase: { type: 'string', description: 'Skill id of the blocked phase' },
          group: { type: 'string', description: 'Id of the blocked group' },
          ticket: { type: 'string', description: 'Id of the blocked ticket' },
          text: { type: 'string', description: "The question, short, in the user's language" },
          answered: { type: 'boolean', description: 'true once answered (a user\'s answer: once in DECISIONS.md): it leaves the list' },
          gesture: { type: 'string', enum: ['spend', 'external', 'flaw'], description: 'A user\'s click in the COO\'s dashboard, applied here: allow or refuse a spending ("spend") or an external action ("external"), leave a kept security finding unfixed or fix it ("flaw", with "dismissed")' },
          dismissed: { type: 'number', description: 'With "flaw": total kept findings left unfixed once agreed (its group\'s "security.dismissed")' },
        },
        required: ['id'],
      },
    },
    delivery: {
      type: 'object',
      description:
        'COO only, alone in its call, during a delivery the user started with « ▶ Livrer »: the outcome of the step that ran ("detail": what it did, or why it failed); the next step runs only on success; never run a delivery step yourself',
      properties: {
        step: { type: 'string', enum: ['version', 'push', 'pr', 'project'] },
        ok: { type: 'boolean' },
        detail: { type: 'string' },
      },
      required: ['step', 'ok'],
    },
    coordinate: {
      type: 'object',
      description:
        'COO only, alone in its call: its instructions to the missions, written to the coordination file, each key as the COO statement asks. "order": alone, the ready card ids by priority. "close": close a mission, never archived nor marked delivered. "cutAuto": switch a mission\'s auto off (a pause too), never on; tell the user',
      properties: {
        close: {
          type: 'array',
          items: { type: 'object', properties: { mission: { type: 'string' } }, required: ['mission'] },
        },
        cutAuto: { type: 'array', items: { type: 'object', properties: { mission: { type: 'string' } }, required: ['mission'] } },
        instruct: { type: 'array', items: { type: 'object', properties: { mission: { type: 'string' }, file: { type: 'string' }, series: { type: 'number' }, origin: { type: 'string', enum: ['user', 'coo'] } }, required: ['mission', 'file', 'series', 'origin'] } },
        nightOn: { type: 'boolean' },
        toClose: { type: 'array', items: { type: 'string' } },
        discussionsClosed: { type: 'array', items: { type: 'object', properties: { session: { type: 'string' }, state: { type: 'string', enum: [...DISCUSSION_STATES, POSTPONED_STATE] }, why: { type: 'string' } }, required: ['session', 'state'] } },
        order: { type: 'array', items: { type: 'string' } },
        unmarked: { type: 'string', enum: [...UNMARKED_ANSWERS] },
        night: { type: 'array', items: { type: 'object', properties: { mission: { type: 'string' }, watch: { type: 'string' }, act: { type: 'string' }, group: { type: 'string' }, running: { type: 'boolean' } }, required: ['mission', 'watch', 'act'] } },
        gleaned: { type: 'array', items: { type: 'object', properties: { mission: { type: 'string' }, added: { type: 'array', items: { type: 'string' } }, attached: { type: 'array', items: { type: 'string' } }, postponed: { type: 'boolean' } }, required: ['mission', 'added', 'attached'] }, description: 'Gleaned closed mission: entry ids added and still attached; "postponed": nothing noted' },
        gleanedExisting: { type: 'boolean', description: 'true once the one-time gleaning of the journal and reports is done, after showing the user' },
        titles: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] } },
        taken: {
          type: 'array',
          description: 'Retro pistes another mission already took (a clear overlap, or the user\'s answer on a partial one): the retro leaves each out of its cut',
          items: {
            type: 'object',
            properties: {
              mission: { type: 'string', description: 'The id of the retro mission' },
              item: { type: 'string', description: 'The id of its piste' },
              by: { type: 'object', properties: { mission: { type: 'string' }, ticket: { type: 'string' } }, required: ['mission', 'ticket'], description: 'The mission that took it, and its ticket' },
            },
            required: ['mission', 'item', 'by'],
          },
        },
        answer: {
          type: 'array',
          description: "The user's written answer to a blocking question of a mission (an experience choice, a sensitive area, an invariant or a contradiction, a deletion or an exposure), once the question and their exact sentence are a new committed series of its DECISIONS.md: the mission applies it",
          items: {
            type: 'object',
            properties: {
              mission: { type: 'string', description: 'The id of the mission' },
              question: { type: 'string', description: 'The id of its blocking question' },
              seen: { type: 'string', description: 'The text print of the question the user read, from the COO statement' },
              file: { type: 'string', description: 'That DECISIONS.md from the project root: an existing file under travail/, no « .. »' },
              series: { type: 'number', description: 'The number of your series' },
            },
            required: ['mission', 'question', 'seen', 'file', 'series'],
          },
        },
        redo: {
          type: 'array',
          description: "« ✎ À reprendre » on a mission's report, once the user's exact sentence is a new committed series of its DECISIONS.md: its manager rewrites the report",
          items: { type: 'object', properties: { mission: { type: 'string' }, file: { type: 'string' }, series: { type: 'number' } }, required: ['mission', 'file', 'series'] },
        },
        contradiction: {
          type: 'array',
          description: 'Two opposed decisions of two missions (or in doubt), from the COO statement: the mission that decided second gets a blocking question',
          items: {
            type: 'object',
            properties: {
              first: { type: 'object', properties: { mission: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' } }, required: ['mission', 'ref', 'text'] },
              second: { type: 'object', properties: { mission: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' } }, required: ['mission', 'ref', 'text'] },
              subject: { type: 'string' },
            },
            required: ['first', 'second', 'subject'],
          },
        },
        compatible: {
          type: 'array',
          description: 'Two missions deciding the same subject compatibly: one line in the Coordination view',
          items: { type: 'object', properties: { missions: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' } }, required: ['missions', 'subject'] },
        },
        decisionsSeen: { type: 'boolean', description: 'true once the new decisions of your last statement are judged (oppositions and compatible subjects recorded)' },
      },
    },
    card: {
      type: 'object',
      description:
        'COO only, alone in its call: a launch card for a new mission, which the user launches with one click (never without it). Start from ask-matt (path in the COO statement). Mode: "auto" by default; "manual" for a judgement task, a change of rules loaded in every session (config/rules/, a CLAUDE.md), or when the user wants to follow the framing. Effort: "high"; for a start where the manager does a worker\'s work (/implement of ready tickets, /tdd, /code-review), the level of « Effort d’un worker de groupe », section 11 in reference/effort-workers.md of flow-board, never xhigh there; "xhigh" only proposed, in manual. Folder: travail/<subject>/, letters, digits and dashes; ask the user when none fits. The same folder again updates the card, unless launching or launched. Texts in the user\'s language',
      properties: {
        title: { type: 'string', description: "The mission's title, 3 to 6 words" },
        idea: { type: 'string', description: 'Id of the roadmap idea it launches, if any' },
        start: { type: 'string', enum: [...LAUNCH_STARTS], description: 'The recommended start, from ask-matt' },
        askMatt: { type: 'string', description: 'The ask-matt line justifying the start, with its line number' },
        alts: { type: 'array', items: { type: 'string', enum: [...LAUNCH_STARTS] }, description: 'Up to 4 other starts' },
        mode: { type: 'string', enum: ['auto', 'manual'] },
        modeWhy: { type: 'string', description: 'Why, one short line' },
        effort: { type: 'string', enum: ['medium', 'high', 'xhigh'] },
        effortWhy: { type: 'string', description: 'Why, one short line' },
        folder: { type: 'string', description: 'Subject of the folder travail/<folder>/' },
        goal: { type: 'string', description: 'What the mission aims at, 1-3 short lines, not the title' },
        entries: { type: 'array', items: { type: 'string' }, description: `Open roadmap ids it covers (I<n>, R<n>), ${CARD_ENTRIES_MAX} max; omit keeps, [] clears` },
      },
      required: ['title', 'start', 'askMatt', 'mode', 'effort', 'folder', 'goal'],
    },
    launch: {
      type: 'string',
      description:
        'Only when this discussion\'s first message gives it (a mission launched by the COO): its launch id, at your first flow call once the skill opened the mission; checked, consumed once, and the answer says what it found',
    },
    setAside: {
      type: 'array',
      description:
        'Manager: each thing set aside for later or another mission, never work this mission owes (report duties too); copied into « À reprendre », where only the user decides its fate. Check the roadmap and « À reprendre » first: if one holds it, start with its id (« R49: … ») and say what it adds',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'As written; head « R49: » (capital, 1-4 digits, colon) files it as R49\'s complement while R49 open' },
          source: { type: 'string', description: 'Its origin' },
        },
        required: ['text'],
      },
    },
    pistes: {
      type: 'array',
      // Sans description : le budget de `outil-flow-textes.test.ts` est plein ; le relevé du COO et la consigne de la rétro donnent son emploi.
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['add', 'edit', 'comment', 'drop'] },
          piste: { type: 'string' },
          text: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['op', 'piste'],
      },
    },
    note: { type: 'string', description: 'One short line worth keeping in the activity log (a decision, a finding)' },
    complete: { type: 'boolean', description: 'true when the work of the current skill is finished' },
  },
}
