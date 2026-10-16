---
name: new
description: Set up a new project with the convention - CLAUDE.md with the session protocol, BRIEF.md, DECISIONS.md, ETAT_DU_PROJET.md, docs/ and travail/tasks/ - filled from a short interview with the project owner.
argument-hint: "[project description]"
disable-model-invocation: true
allowed-tools: Read(/${CLAUDE_PLUGIN_ROOT}/**) Bash(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py *) Bash(python ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py *) Bash(py -3 ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py *)
---

Set up the project in the current working directory following the convention in `${CLAUDE_PLUGIN_ROOT}/reference/conventions.md`. Read that file first: it defines what each file holds and how instruction files are written, and everything you generate must match it.

Owner's description, if given: $ARGUMENTS

Before step 1, create a task list (the TodoWrite tool, or TaskCreate and TaskUpdate where those are the task tools) with one entry per numbered step below, titled like the step, in order. Keep it current as you go: a step is in progress when you start it and completed when it ends. A step that does not apply, or that an argument skips, is marked completed and said in the report, never left open or removed.

## 1. Check the starting point

Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/audit.py .` (on Windows, `python` or `py -3` if `python3` is missing; quote the path if it contains spaces). If any of `CLAUDE.md`, `BRIEF.md`, `DECISIONS.md`, `ETAT_DU_PROJET.md` already exists, stop and point the owner to `/project:audit`: this skill creates files and must not overwrite existing ones. If Python is unavailable, check those four files with Glob.

Look at what the directory already holds (manifests such as `package.json`, `pyproject.toml`, `app.json`, existing folders, README) so the interview only asks what the files don't say.

## 2. Interview the owner

Gather what only the owner knows: the goal, the users, what is in and out of scope, constraints (deadlines, stack imposed, data rules), how success is judged, the name of the project's section in the user's Asana tracking project, the one named by the « Suivi Asana » block of the global `CLAUDE.md` (default: the project name), and what may be written in Asana (for example whether internal company data is allowed). Use AskUserQuestion for choices and ask in chat for free text; skip questions the description or the directory already answers. Keep it to what fills the templates - details can wait for later sessions.

## 3. Create the files

From `${CLAUDE_PLUGIN_ROOT}/templates/`, write `CLAUDE.md`, `BRIEF.md`, `DECISIONS.md` and `ETAT_DU_PROJET.md` at the project root, and create `docs/` and `travail/tasks/` (add an empty `.gitkeep` in each so git keeps them). Replace every `{{PLACEHOLDER}}`:

- `{{TODAY}}`: today's date, `YYYY-MM-DD`.
- `{{COMMANDS}}`: install, run and verify commands taken from the project's manifests (for example the `scripts` of `package.json`). Write only commands that exist; for a new empty project write `- à confirmer` lines instead of guessing.
- `{{CONVENTIONS}}` and `{{GOTCHAS}}`: only what differs from the stack's defaults and came up in the interview; otherwise `- à confirmer`.
- `{{ASANA_PROJECT}}`, `{{ASANA_PROJECT_GID}}`: the tracking project's name and GID from the « Suivi Asana » block of the global `CLAUDE.md`; « à confirmer » without that block.
- `{{ASANA_SECTION_GID}}`: from step 5 once the section exists; « à confirmer » until then.
- `{{ASANA_DATA_RULE}}`: the owner's rule on what may go into Asana, as a clause starting with « ; » (for example « ; les données internes de l'entreprise sont admises dans Asana »); otherwise an empty string.
- `{{EXTRA_END_RULES}}`: project-specific end-of-session updates if the owner named some (for example "toute mesure modifiée impose la mise à jour de `docs/mesures.md`"), as a sentence starting with a space; otherwise an empty string.
- Every other placeholder from the interview. What the owner did not settle is written « à confirmer », never invented.

Record in `DECISIONS.md` any choice the interview settled (stack, hosting, scope boundary), one entry each with the alternatives the owner mentioned.

## 4. Suggest, don't create, the extras

Offer to add `.github/pull_request_template.md` from `${CLAUDE_PLUGIN_ROOT}/templates/pull_request_template.md` if the project will use pull requests; its public section only makes sense if the project publishes release notes, so ask whether to keep it.

If some guidance only applies to part of the project (database migrations, translations, native config, a sub-project), suggest a `CLAUDE.md` in that folder, and a skill for knowledge or procedures needed only for some tasks: this is the form `/doctor` uses, so later checkups won't move it again. Let the owner decide. Same for hooks: suggest one only for an action that must happen every time.

## 5. Outside the project

These steps reach outside the working directory, so ask before each:
- `git init` if the directory is not a repository;
- in Asana, with the `asana-board:suivi-asana` skill if it is available in this session: the project's section, and in it the unassigned parent task « [code] <section> : prochaines sessions Claude Code » whose description starts with « Statut : à faire ». Then write the project and section GIDs into `CLAUDE.md`.

## 6. Verify and report

Re-run the audit script: every expected file must show `[OK]` and no `{{` may remain in the generated files (Grep for it). Report the files created, what is still « à confirmer », and the decisions left to the owner.
