---
name: sync
description: Bring the current branch up to date with its remote, or with the default branch when asked, without losing local work - fetch, rebase or merge, autostash.
argument-hint: "[base]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git fetch *) Bash(git pull *) Bash(git merge-base *) Bash(git rev-parse *) Bash(git symbolic-ref *) Bash(git remote *) Bash(git log *) Bash(git rebase *) Bash(git merge *) Bash(git stash *) Read(/${CLAUDE_PLUGIN_ROOT}/**)
---

Update the current branch. Argument: $ARGUMENTS

Gather the context and follow the rules in `${CLAUDE_PLUGIN_ROOT}/reference/git.md`.

## Steps

1. `git fetch --prune origin`.
2. **Without argument**: bring in the branch's own upstream.
   - No upstream: nothing to pull; say so (the branch has never been pushed).
   - If `git merge-base --is-ancestor @{u} HEAD` succeeds, the remote has nothing new: stop there, the branch is up to date.
   - Otherwise `git pull --rebase=merges --autostash`. Rebasing replays only local commits that are not on the remote, `=merges` keeps their merge commits, and autostash sets uncommitted work aside and restores it afterwards. See « Bringing in the remote » in the reference.
3. **With `base`**: bring the default branch into the current one.
   - On the default branch itself, this is the same as step 2.
   - If the current branch has been pushed and others may have pulled it, merge (`git merge origin/<default>`) so its history stays valid for them. If it has never been pushed, rebase, keeping its merge commits (`git rebase --rebase-merges --autostash origin/<default>`). When unsure, ask.
4. If `--autostash` could not re-apply the stash cleanly, the stash is kept: say so and show `git stash list`.

## Report

Show `git status --short --branch` and `git log --oneline -5`, and state what came in (number of commits and from where) or that the branch was already up to date.
