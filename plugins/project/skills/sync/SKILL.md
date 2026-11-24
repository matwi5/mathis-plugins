---
name: sync
description: Bring the current branch up to date with its remote, or with the default branch when asked, without losing local work - fetch, rebase or merge, autostash.
argument-hint: "[base]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git fetch *) Bash(git pull *) Bash(git merge-base *) Bash(git rev-parse *) Bash(git symbolic-ref *) Bash(git remote *) Bash(git log *) Bash(git rev-list *) Bash(git for-each-ref *) Bash(git worktree list *) Bash(git rebase *) Bash(git merge *) Bash(git stash *) Read(/${CLAUDE_PLUGIN_ROOT}/**)
---

Update the current branch. Argument: $ARGUMENTS

Gather the context and follow the rules in `${CLAUDE_PLUGIN_ROOT}/reference/git.md`.

## Steps

1. `git fetch --prune origin`.
2. **Without argument**: bring in the branch's own upstream.
   - No upstream: nothing to pull; say so (the branch has never been pushed).
   - If `git merge-base --is-ancestor @{u} HEAD` succeeds, the remote has nothing new for this branch: nothing to pull.
   - Otherwise, first look for another branch, a tag or a worktree that carries the local commits, with `<base>` = `@{u}` (« Local commits carried elsewhere » in the reference: `git rev-list`, `git for-each-ref --contains`, `git worktree list --porcelain`). Carried, or unsure: merge instead, `git merge --no-edit --autostash '@{u}'`, so that their hashes stay valid for that branch, tag or worktree. Not carried: `git pull --rebase=merges --autostash`. Rebasing replays only local commits that are not on the remote, `=merges` keeps their merge commits, and autostash sets uncommitted work aside and restores it afterwards. See « Bringing in the remote » in the reference.
   - Then, off the default branch, count what the default branch has that this one lacks: `git rev-list --count 'HEAD..origin/<default>'` (the default from `git symbolic-ref --short refs/remotes/origin/HEAD`; a name with other signs than letters, digits, `.`, `_`, `/` and `-` skips this count, and the report says so; with `base`, such a name stops the sync, as the reference says). When it is positive, the branch is not « up to date » even if its own upstream is: say how many commits `origin/<default>` has ahead, and offer `/project:sync base` to bring them in (a sync had said « up to date » while main had a commit more on the remote).
3. **With `base`**: bring the default branch into the current one.
   - On the default branch itself, this is the same as step 2.
   - If the current branch has been pushed and others may have pulled it, merge (`git merge 'origin/<default>'`) so its history stays valid for them. If it has never been pushed, first look for another branch, a tag or a worktree that carries its local commits, with `<base>` = `origin/<default>` (« Local commits carried elsewhere » in the reference); carried, or unsure: merge (`git merge --no-edit --autostash 'origin/<default>'`). Otherwise rebase, keeping its merge commits (`git rebase --rebase-merges --autostash 'origin/<default>'`). When unsure whether it has been pushed, ask. `<default>` goes on these command lines only in the form the reference allows (letters, digits, `.`, `_`, `/`, `-`), quoted.
4. If `--autostash` could not re-apply the stash cleanly, the stash is kept: say so and show `git stash list`. A merge stopped on a conflict keeps the uncommitted work aside in `MERGE_AUTOSTASH`, not in the stash list: it comes back after the merge commit or `git merge --abort`, and shows in `git stash list` only if re-applying it fails then.

## Report

Show `git status --short --branch` and `git log --oneline -5`, and state what came in (number of commits and from where) or that the branch was already up to date with its upstream, and, when the sync merged instead of rebasing because other branches, tags or worktrees carry the local commits, which ones (or what could not be read), plus, without argument, the commits `origin/<default>` has ahead (step 2), with `/project:sync base` offered when there are some.
