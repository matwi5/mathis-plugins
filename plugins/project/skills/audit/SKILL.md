---
name: audit
description: Review an existing project against the convention and the current Claude Code recommendations, then migrate it on approval - missing files, legacy docs structure, TODO.md to Asana, CLAUDE.md rewrite, a prompt-audit of instruction files, then a /doctor checkup.
argument-hint: "[report]"
disable-model-invocation: true
allowed-tools: Read(/${CLAUDE_PLUGIN_ROOT}/**) Bash(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py *) Bash(python ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py *) Bash(py -3 ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py *)
---

Bring the project in the current working directory to the convention in `${CLAUDE_PLUGIN_ROOT}/reference/conventions.md`. Read that file first: sections 2, 4 and 6 are the yardstick for every finding.

With the argument `report` ($ARGUMENTS), stop after step 4: produce the report and the migration plan, change nothing.

The standard for this work: no information is lost. Content leaves a file only once it has a new home (DECISIONS.md, CLAUDE.md, a rule, Asana, a spec) or the owner has confirmed it can go.

Before step 1, create a task list (the TodoWrite tool, or TaskCreate and TaskUpdate where those are the task tools) with one entry per numbered step below, titled like the step, in order. Keep it current as you go: a step is in progress when you start it and completed when it ends. A step that does not apply, or that an argument skips, is marked completed and said in the report, never left open or removed.

## 1. Mechanical inventory

Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py .` (on Windows, `python` or `py -3`; quote the path if it contains spaces). It lists missing files, legacy structure, CLAUDE.md size and protocol markers, the journal order in `ETAT_DU_PROJET.md`, and prompt-audit signals (caps emphasis, dated idioms, backticked paths that no longer exist). If Python is unavailable, make the same checks with Glob, Grep and Read.

## 2. Instruction files

Invoke the `claude-api` skill with the subcommand `prompt-audit`, scoped to the project's instruction files (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/`, `.claude/skills/`, `.claude/agents/`, `.claude/commands/`), target model: the model running this session. Keep its report and proposed diff for the plan; it does not edit files unless asked, and this skill applies its hunks only in step 5. If `claude-api` is not available, apply section 4 of the conventions yourself, with its keep list.

## 3. Content review

Read `CLAUDE.md` in full and the other convention files that exist. For each legacy item from step 1, open it and decide where its content goes, using the table in section 6 of the conventions. Things to check that the script cannot:
- facts in `CLAUDE.md` that the repository now contradicts (paths, commands, versions). Trimming what Claude can derive from the code, deduplicating local and checked-in `CLAUDE.md` files and moving guidance to on-demand files is `/doctor`'s job (step 6): don't redo it here;
- rules that contradict each other across files, or contradict the code;
- decisions buried in logs or specs that belong in `DECISIONS.md`;
- recurring pitfalls in bug logs that belong in `CLAUDE.md`, or in the `CLAUDE.md` of the folder they concern;
- the Asana part of the session protocol: project and section GIDs, the « [code] » parent task, the « Statut : » line, sub-tasks read through their parent, the no-connector fallback to the journal. A protocol that still reads or updates `TODO.md` is rewritten;
- no PR template while the project uses pull requests: propose `${CLAUDE_PLUGIN_ROOT}/templates/pull_request_template.md` as `.github/pull_request_template.md`; an existing template stays, unless the owner wants the plugin's;
- `ETAT_DU_PROJET.md`: a journal in oldest-first order is reversed, a missing « État » section is written from the latest entries.

## 4. Report and migration plan

Present, in the owner's language:
1. a summary: the two or three changes that matter most;
2. a table with one row per item: element, finding, proposed action (keep / rewrite / merge into X / move to X / migrate to Asana / delete), and where its content goes;
3. the prompt-audit findings from step 2, grouped with their proposed hunks;
4. what remains « à confirmer ».

In `report` mode, stop here and tell the owner that `/project:audit` without argument applies the plan.

## 5. Apply on approval

Check `git status` first. If the working tree has uncommitted changes, ask the owner to commit them (or run `/project:commit`) so the migration can be reviewed and reverted as one diff.

Ask the owner which groups of actions to apply (AskUserQuestion, multi-select). Deletions and anything outside the repository need their own explicit yes. Then apply in this order, so nothing is deleted before its content has moved:
1. create missing files from `${CLAUDE_PLUGIN_ROOT}/templates/`, filled from what the project already says (« à confirmer » otherwise);
2. merge and move content (decisions, pitfalls, specs, relocated migrations);
3. rewrite `CLAUDE.md`: keep the project's own commands, conventions and pitfalls, add the session protocol from the template, apply the accepted prompt-audit hunks;
4. `TODO.md`: with the `asana-board:suivi-asana` skill, create the project's section and its unassigned parent task « [code] <section> : prochaines sessions Claude Code » if missing, write their GIDs into `CLAUDE.md`, then add the open items: Claude's work under the parent task, the owner's assigned to them, each description starting with a « Statut : » line. Show the owner what was added, then delete `TODO.md`, or move it to `archives/TODO_<YYYY-MM-DD>.md` when the folder does not allow deletion (synced folders such as OneDrive) or the owner prefers. If Asana is not reachable, keep `TODO.md` and say so;
5. delete the legacy items the owner approved (or move them to `archives/` where deletion is not possible, and note it in the journal).

## 6. Verify

Re-run the audit script and compare with step 1: every approved action must show up as resolved. Grep for references to deleted or moved paths (in instruction files, README, scripts) and fix or report them. Add an entry to the journal of `ETAT_DU_PROJET.md` describing the migration, and record in `DECISIONS.md` any convention choice the owner made along the way. Report what changed, what was verified, and what is left for the owner.

Then ask the owner to run `/doctor` in this project: it trims from `CLAUDE.md` what Claude can derive from the code, deduplicates local and checked-in `CLAUDE.md` files, and moves guidance that isn't needed every session into nested `CLAUDE.md` files and skills, asking before each change. It also checks the installation, settings and unused plugins, which is why the owner runs it rather than this skill.
