---
name: pr
description: Open a GitHub pull request for the current branch against the default branch or a given base, with a title and body written from the commits - the repository's PR template, or the plugin's (public release-notes section + internal details for reviewers).
argument-hint: "[base-branch] [--draft] [--auto]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git log *) Bash(git diff *) Bash(git fetch *) Bash(git push *) Bash(git rev-parse *) Bash(git symbolic-ref *) Bash(git remote *) Bash(gh pr create *) Bash(gh pr view *) Bash(gh pr list *) Bash(gh pr merge *) Bash(gh api *) Bash(gh auth status *) Read Glob Read(/${CLAUDE_PLUGIN_ROOT}/**)
---

Open a pull request. Arguments: $ARGUMENTS

Gather the context and follow the rules in `${CLAUDE_PLUGIN_ROOT}/reference/git.md`. The base is the branch named in the arguments, otherwise the default branch. Compare against `origin/<base>` after a fetch, never the local copy of the base, which may be behind.

## 1. Pre-flight

- The current branch is not the base.
- `git log --oneline origin/<base>..HEAD` lists at least one commit.
- The working tree is clean; otherwise ask whether to commit first (`/project:commit`).
- The branch is pushed and up to date with its upstream; otherwise push it (`git push -u origin HEAD`).
- `gh pr view` shows no open PR for this branch yet; if one exists, give its URL and stop.

## 2. Title and body

Write in the language the repository already uses for commits and PRs (look at the last few PRs with `gh pr list --state all --limit 5`); translate the template headings if needed.

**Title**: Conventional Commits form, `type(scopes): description`, with every affected sub-project in the scopes (`fix(app,worker): ...`). With a single commit, reuse its subject; otherwise summarize the change as a whole. If the project versions its releases, end the title with the version(s) shipped, in the format the repository's recent PR titles use (for example `v0.14.0 (JS: 0.14.0.3)` for an Expo app with an OTA counter, `· worker v0.5.3` for a second project): CI jobs sometimes parse it, so keep the existing format exactly.

**Body**: use the repository's PR template if it has one (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md` or `docs/PULL_REQUEST_TEMPLATE.md`), otherwise `${CLAUDE_PLUGIN_ROOT}/templates/pull_request_template.md`. Fill every section that applies, delete the ones that don't (a single-project repository has no « Projets concernés » table), and remove the template's HTML comments.

Write from the commit messages and the diff stat (`git diff --stat origin/<base>...HEAD`); read code only where a commit message is too vague to describe the change. The internal part is for reviewers: name the components, functions, tables and migrations, reference bug IDs when the project uses them, and put in « Détails techniques » what the diff does not say (deployment steps, OTA or native build, migration to apply, trade-offs).

**Public section** (`<!-- PUBLIC -->` … `<!-- INTERNAL -->`), when the template has one: it is published to end users, so it holds only what they can see.
- One opening sentence, then only the categories that have content (✨ new, 🐛 fixes, ⚡ improvements).
- Describe each change by what the user sees or gains: "Live results now refresh reliably" rather than "Fix WebSocket reconnection in useLiveFeed".
- Leave out file names, components, hooks, tables, internal tools, admin-only and back-office changes.
- A PR with no user-facing change (docs, CI, refactoring, admin only) gets no public block at all: delete both markers, and start at « Résumé ».
- Keep both markers when the block is present: a CI job that extracts the section usually drops it when `<!-- INTERNAL -->` is missing.

**Verification**: list the checks actually run on this branch with their result, and the manual checks still to do as unticked boxes. Only tick what was run; an unchecked box is more useful than a false one.

**Issues**: look for issue numbers in commit messages and the branch name. Put `Closes #<n>` only for issues the owner confirms are fixed; list the others as `Related to #<n>`.

## 3. Create

`gh pr create --base <base> --title "<title>" --body "<body>"`, adding `--draft` if requested. If `gh` is missing or not authenticated (`gh auth status`), use the GitHub tools of the session if there are any; otherwise print the title and body for the owner to paste.

Auto-merge only with `--auto`; without the flag, the PR waits for review. With it:

1. Read the repository's settings: `gh api repos/{owner}/{repo} --jq '{allow_auto_merge, allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` (`gh` fills in `{owner}/{repo}`).
2. If `allow_auto_merge` is not `true`, never fall back to a direct merge: leave the PR open, and tell the owner to either turn on « Allow auto-merge » in the repository settings (General › Pull Requests) or merge it themselves once CI is green.
3. Otherwise merge with the method the repository uses, never `--squash` by default. If only one method is allowed, use it. If several are, look at the last merged PRs: `gh pr list --state merged --limit 3 --json number,mergeCommit`, then the parent count and title of a merge commit with `gh api repos/{owner}/{repo}/commits/<oid> --jq '{parents: (.parents | length), title: (.commit.message | split("\n")[0])}'`. Two parents means `--merge`; one parent means `--squash` when the commit title ends with `(#<PR number>)`, which GitHub adds to squashed commits only, otherwise `--rebase`. With no merged PR to go by, ask the owner. Then `gh pr merge <number> --auto --<method>`.

## Report

PR URL, base, number of commits, linked issues. For a substantial change without `--auto`, mention `/code-review ultra <number>` for a deep review before merging; with `--auto` the PR merges once checks pass, so leave it out. With `--auto`, also say which merge method was set, or that auto-merge is off in the repository and what the owner can do.
