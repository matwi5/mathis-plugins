---
name: commit
description: Commit the current changes with a precise Conventional Commits message written from the actual diff, staging files by path and leaving secrets out.
argument-hint: "[hint about the change]"
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git add *) Bash(git commit *) Bash(git rev-parse *) Read(/${CLAUDE_PLUGIN_ROOT}/**)
---

Commit the working tree changes. Owner's hint, if any: $ARGUMENTS

Follow the shared rules in `${CLAUDE_PLUGIN_ROOT}/reference/git.md` (staging by path, secrets, hooks).

## What to look at

- `git status --short` and `git diff HEAD` for the changes (for a large diff, `git diff HEAD --stat` first, then the files that matter).
- `git log --oneline -15` to match the repository's existing style: language, scopes in use, capitalization. The repository's habits win over the defaults below.

## The message

Conventional Commits: `type(scope): description`, types `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `build`, `ci`, `chore`. A breaking change gets `!` after the scope and a `BREAKING CHANGE:` footer, because version bumps are computed from it.

The subject names what changed (the component, function or behavior), in the imperative, 72 characters at most. A body is worth adding when the change touches several things or its reason is not obvious from the diff: one line per significant change, and the why when you know it. Describe only what the diff shows; the owner's hint can supply intent. `Fixes #<n>` or `Closes #<n>` only for an issue the owner confirms is fixed.

Examples of the level of precision expected:
- `fix(auth): refresh the token before it expires on resume`
- `feat(export): add CSV export to the monthly report`
- `refactor(hooks): extract pagination state into usePagination`

## One commit or several

When the changes are clearly unrelated (a fix and an unrelated refactor, for instance), propose splitting them and commit each group separately if the owner agrees. Otherwise make one commit.

## Finish

Stage the files by path, commit, then show `git log --oneline -1` and any file left unstaged with the reason.
