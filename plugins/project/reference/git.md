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
- A hook that fails (pre-commit, pre-push) reports a real problem: fix the cause. Never pass `--no-verify` (nor `-n` to `git commit`), whatever the state of the hook, even for a work-in-progress commit.

## Bringing in the remote

A plain `git pull --rebase` replays every local commit, even when the remote has nothing new, and flattens merge commits on the way: their commits change hash, and every hash quoted elsewhere (state file, plan, tickets) goes stale.

1. `git fetch origin`.
2. If `git merge-base --is-ancestor @{u} HEAD` succeeds, the remote has nothing the branch lacks: do not pull.
3. Otherwise check, with `<base>` = `@{u}`, whether another branch, a tag or a worktree carries the local commits (« Local commits carried elsewhere » below). Carried, or unsure: merge instead, `git merge --no-edit --autostash '@{u}'`, and the report names what carries them. Not carried: `git pull --rebase=merges --autostash`: local commits go on top of the remote ones, and merge commits are kept.
4. Push with `--follow-tags`, so the annotated tags of the pushed commits (made by `/project:version`) go with them.

## Local commits carried elsewhere

A rebase rewrites every local commit it replays. A local branch or a worktree that started from those commits (a worker's branch made from the main clone) keeps the old hashes: its later merge brings the same changes twice under other hashes, and what checks it against the rewritten branch stops (46 local commits rebased on 17/11/2026 under a worker's branch: its closing stopped, and its merge was replayed by hand). So, before any rebase onto `<base>` (`@{u}`, or `origin/<default>` for `/project:sync base`), look for them:

1. The commits the rebase would replay: `git rev-list '<base>..HEAD'` (the whole range in one pair of quotes: PowerShell would split `'<base>'..HEAD` in two). None: nothing is rewritten, rebase as usual. More than 200: merge without looking further, and say why (the command of point 2 would grow too long).
2. The local branches and tags that carry any of them, in one command with one `--contains` per listed hash (git lists a ref that contains any of them): `git for-each-ref --format='%(refname)' --contains '<hash 1>' --contains '<hash 2>' … refs/heads refs/tags`. Leave out the current branch, by its full name (`git symbolic-ref HEAD`, `refs/heads/<current>`): a short name can turn into `heads/<name>` when a tag has the same one. A tag counts too: a version tag left on a rewritten commit would not be pushed.
3. The worktrees on a detached HEAD, which no branch names: in `git worktree list --porcelain`, each block that has a `detached` line, other than the current worktree, and its `HEAD <hash>` line. For each, `git rev-list --count HEAD '^<base>' '^<its hash>'`: a count smaller than the number of commits listed at point 1 means it carries some of them.
4. A branch, a tag or a worktree found, or a command of points 1 to 3 that fails or prints something unclear: merge instead of rebasing, and say in the report which branches, tags and worktrees carry the local commits (or what could not be read). Nothing found: rebase as usual.

Only full hashes printed by git (40 or 64 hexadecimal characters) and `<base>` go on these command lines, each in single quotes; branch, tag and worktree names come from git's output and appear only in the report, never on a command line. `<base>` is `@{u}` or `origin/<default>`, and `<default>`, read from `git symbolic-ref` (a name the remote chose), goes on a command line only when it is made of letters, digits, `.`, `_`, `/` and `-` alone, quoted: any other name stops the sync, which says so. The check and the rebase are separate commands: a branch or worktree created from these commits in between (another discussion launching a worker) is not seen, so run the rebase right after the check. This check never deletes, moves or resets a branch, a tag or a worktree.
