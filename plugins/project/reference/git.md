# Git context for the project skills

Shared by `commit`, `sync`, `push`, `pr` and `version`. The commands are plain git so they run the same under bash and PowerShell; run them one at a time rather than chaining with shell operators.

## Gather the context

1. `git rev-parse --show-toplevel`: fails outside a repository. Stop there and say so.
2. `git status --short --branch`: current branch, upstream, ahead/behind counts, working tree state.
3. Default branch, first answer that works:
   - `git symbolic-ref --short refs/remotes/origin/HEAD` (prints `origin/<name>`);
   - otherwise `git remote set-head origin --auto`, then the command above again;
   - otherwise whichever of `origin/main`, `origin/master` exists (`git rev-parse --verify --quiet <ref>`);
   - otherwise there is no remote default branch: say so and ask which branch to use.
4. Upstream of the current branch: `git rev-parse --abbrev-ref --symbolic-full-name @{u}`; failure means the branch has never been pushed.
5. In-progress operations: a rebase, merge or cherry-pick already under way shows in `git status`. Finish or abort it with the owner before starting anything else.

## Rules shared by every git skill

- No `--force`, `--force-with-lease`, `reset --hard`, `clean -fd` or history rewrite on a pushed branch unless the owner asks for that exact command: they discard work that may exist nowhere else.
- Stage files by path. Never stage secrets: `.env*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, credentials or service-account JSON, `*.tfvars`. If one shows up as changed and is not git-ignored, point it out and suggest adding it to `.gitignore`.
- On a conflict, stop and list the conflicted files with a short description of each side. Resolve only with the owner's go-ahead, then continue the operation (`git rebase --continue` or a merge commit).
- A hook that fails (pre-commit, pre-push) reports a real problem: fix the cause, never bypass with `--no-verify`.

## Bringing in the remote

A plain `git pull --rebase` replays every local commit, even when the remote has nothing new, and flattens merge commits on the way: their commits change hash, and every hash quoted elsewhere (state file, plan, tickets) goes stale.

1. `git fetch origin`.
2. If `git merge-base --is-ancestor @{u} HEAD` succeeds, the remote has nothing the branch lacks: do not pull.
3. Otherwise `git pull --rebase=merges --autostash`: local commits go on top of the remote ones, and merge commits are kept.
4. Push with `--follow-tags`, so the annotated tags of the pushed commits (made by `/project:version`) go with them.
