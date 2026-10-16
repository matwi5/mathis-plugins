---
name: version
description: Bump the project version with SemVer - detect the version files (package.json, pyproject.toml, Cargo.toml, Expo app config...), propose the bump from the commits since the last release, update every file consistently; handles Expo native vs OTA releases.
argument-hint: "[patch|minor|major|ota]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git log *) Bash(git diff *) Bash(git tag *) Bash(git describe *) Bash(git rev-parse *) Read Glob Grep Read(/${CLAUDE_PLUGIN_ROOT}/**)
---

Bump the version. Requested bump, if any: $ARGUMENTS

Follow the shared rules in `${CLAUDE_PLUGIN_ROOT}/reference/git.md`.

Before step 1, create a task list (the TodoWrite tool, or TaskCreate and TaskUpdate where those are the task tools) with one entry per numbered step below, titled like the step, in order. Keep it current as you go: a step is in progress when you start it and completed when it ends. A step that does not apply, or that an argument skips, is marked completed and said in the report, never left open or removed.

## 1. Find the version sources

Look for, outside `node_modules` and virtual environments:
- `package.json` (`version`), including workspace packages;
- `pyproject.toml` (`[project] version` or `[tool.poetry] version`);
- `Cargo.toml` (`[package] version`);
- Expo: `app.json`, `app.config.ts` or `app.config.js` (`expo.version`, `runtimeVersion`, `extra.jsVersion`);
- other files that repeat the version: `CHANGELOG.md`, a version badge or table in `README.md`, a version line in `CLAUDE.md`;
- git tags: `git describe --tags --abbrev=0`.

If the sources disagree with each other, show them side by side and ask which one is right before changing anything.

If an Expo app is detected, read `${CLAUDE_PLUGIN_ROOT}/skills/version/expo.md` now: an Expo release is either native or OTA, and the wrong choice breaks updates for installed apps.

## 2. Choose the bump

The commits since the last tag (or since the last change to the version field, found with `git log -L` or `git log -S`) decide it:
- `BREAKING CHANGE` or `type!:` → major;
- `feat` → minor;
- `fix`, `perf` and the rest → patch.
Below 1.0.0, a breaking change bumps the minor and a feature the patch, unless the project documents otherwise.

With an argument, use it; if it contradicts the commits (a `patch` requested over a breaking change), say so and ask. Without one, propose the computed bump with the commits that justify it, and let the owner confirm or choose another.

## 3. Update

- npm projects: `npm version <new> --no-git-tag-version` keeps `package-lock.json` in step; for other package managers, edit `package.json` and let the lockfile follow on the next install. Never hand-edit a lockfile.
- Every other source from step 1 gets the same version.
- `CHANGELOG.md`, if the project has one: a new section at the top in the file's existing format, listing the changes from the commits in the owner's words.

## 4. Commit and tag

Commit the version files together: `chore(release): v<new>` (or the repository's convention). Create the tag `v<new>` only if the repository already tags its releases, and make it annotated (`git tag -a v<new> -m "v<new>"`): `git push --follow-tags` sends only annotated tags. Pushing is left to `/project:push`.

## Report

Old and new version, bump type and why, files changed, tag created or not, and for Expo which release path applies (native build or OTA update).
