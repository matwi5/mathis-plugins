---
name: push
description: Finish a piece of work and push it - commit what is left, run the project's checks, confirm the end-of-session files are up to date, sync with the remote and push without force.
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git add *) Bash(git commit *) Bash(git fetch *) Bash(git pull *) Bash(git push *) Bash(git ls-remote *) Bash(git merge-base *) Bash(git rev-parse *) Bash(git symbolic-ref *) Bash(git remote *) Bash(gh run list *) Bash(gh run view *) Bash(gh run watch *) Glob Read(/${CLAUDE_PLUGIN_ROOT}/**)
---

Push the current branch. Gather the context and follow the rules in `${CLAUDE_PLUGIN_ROOT}/reference/git.md`.

Before step 1, create a task list (the TodoWrite tool, or TaskCreate and TaskUpdate where those are the task tools) with one entry per numbered step below, titled like the step, in order. Keep it current as you go: a step is in progress when you start it and completed when it ends. A step that does not apply, or that an argument skips, is marked completed and said in the report, never left open or removed.

## 1. Where the push goes

If the current branch is the default branch, ask the owner whether to push to it directly or to create a working branch first (`git switch -c <type>/<short-name>`): repositories that review changes through pull requests expect the second.

## 2. Uncommitted changes

If the working tree has changes, commit them following `${CLAUDE_PLUGIN_ROOT}/skills/commit/SKILL.md`.

## 3. Checks

Run the verification commands listed in the « Commandes » section of `CLAUDE.md` (tests, lint, type checking). If the project lists none, say so and continue. If a check fails, stop and report the failure: pushing a red build passes the problem on to whoever pulls next. Push anyway only if the owner says so.

## 4. End-of-session files

If the project follows the convention (`ETAT_DU_PROJET.md` exists), compare the commits about to be pushed (`git log @{u}..HEAD`, or the whole branch if it has no upstream) with the journal:
- no journal entry covers this work: write it and update the « État » section, as the session protocol in `CLAUDE.md` requires;
- a design decision was made in these commits and `DECISIONS.md` does not have it: add it;
- then commit these updates (`docs(state): ...` or the repository's equivalent).
Asana updates follow the protocol in `CLAUDE.md` (`asana-board:suivi-asana` skill); they don't block the push.

## 5. Sync and push

1. With an upstream, bring in remote commits first, as `${CLAUDE_PLUGIN_ROOT}/reference/git.md` (« Bringing in the remote ») says: `git fetch origin`, then nothing to do if `git merge-base --is-ancestor @{u} HEAD` succeeds, otherwise `git pull --rebase=merges --autostash`.
2. Push with the tags of the commits pushed: `git push --follow-tags`, or `git push -u --follow-tags origin HEAD` for a branch without upstream. If a tag sits in the pushed range (`git log --oneline --decorate` shows it), check that it reached the remote: `git ls-remote --tags origin <tag>`.
3. If the push is rejected because the remote moved, sync again and retry once. Never force: the rejected commits exist only on the remote.

## 6. CI

If the repository has a CI that runs on pushes to this branch (a workflow in `.github/workflows/` whose `on: push` covers it) and `gh` is available, follow the run of the pushed commit until it ends. Find it by the commit's **full** id (`git rev-parse HEAD`, then `gh run list --commit <full sha>`) or with `gh run list --branch <branch> --event push --limit 1`, never by a short SHA: `gh` matches the full id only, and a short one finds nothing, which looks like a missing or failed run. Then `gh run watch <run id> --exit-status`. A run that has not appeared yet is not a failure: list again before concluding. If it fails, read the failing job (`gh run view <run id> --log-failed`) and report it.

## Report

Branch and remote pushed to, commits pushed (`git log --oneline` of the range), tags pushed, checks run and their result, end-of-session files updated, the CI run and its result (or why it was not followed). If the branch is not the default one and has no pull request yet, mention `/project:pr`.
