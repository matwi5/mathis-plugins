---
name: retro
description: "Conduct a retrospective on a coding session."
disable-model-invocation: true
---

The user has asked for a **retrospective**. You are suggesting improvements to the coding agent's **environment** to improve future runs.

## Steps

1. Call the Skill tool with `writing-for-agents` for the writing style guide.

2. Read the primary sources for the session the user specifies. This may mean searching through session logs on this machine. If the user doesn't specify a session, default to the current one.

3. Look for candidates for improvement in these categories.

- **Navigation**: how easy was it for the agent to find the right files? Are there hidden dependencies between files? Would a **navigation pointer** make it easier? _Use when_ the session took a long time to find a piece of information.
- **Automated checks**: are there automated checks that could catch errors the agent made? Linting, typing, tests, filesystem linters? Read the repo's own check command first (its `package.json`/build-tool `lint`/`check` scripts, its CI workflow), so a check that already exists but sits unwired or silently broken is the finding, not a reinvention. A repo with no **guardrail** (no pre-commit hook and no CI job running its lint/typecheck/test command) is itself a finding: an un-linted repo is a standing missed opportunity, not a neutral default. _Use when_ the agent made a mistake an automated check could have caught, or the repo has no guardrail at all.
- **Coding standards**: should the **reviewer agent** be given a new rule to enforce? Should an existing rule be removed or clarified? Classify the violation first: a **mechanical** one (a fixed syntactic pattern, a banned API, an import shape, a file-location rule) gets a deterministic check, full stop: a custom rule in the repo's own linter, a new pre-commit hook, or a new CI job, whichever the repo's language and existing guardrail make cheapest. Default to building the check over writing the rule. Reserve `CODING_STANDARDS.md` for genuine **judgement calls** (cross-file consistency, "matches the surrounding style," anything no guardrail could ever substitute for). _Use when_ the reviewer agent failed to catch a mistake.
- **Global AGENTS.md**: are there any steering instructions that should be moved to coding standards (or automated checks) instead? _Use when_ the AGENTS.md file is particularly large - in the repo OR the user's global scope.
- **Tool economy**: did the agent make expensive tool calls that could be streamlined? Is there any custom tooling (CLI's, MCP's) that is particularly token-inefficient? _Use when_ the agent made an expensive tool call.
- **No-ops**: look for instructions in steering files that don't modify the agent's behavior. _Use when_ the steering files are large and unwieldy.
- **Information access**: look for opportunities to increase the agent's access to information. Teeing dev server logs, readonly access to third-party services. _Use when_ a crucial piece of information was not available to the agent.

4. Present these candidates to the user, in order of severity. When the flow-board dashboard tracks this retro, close the presentation by announcing what comes next: the user picks the candidates of this repository in the dashboard and clicks its splitting button, which puts a splitting request in the prompt: you then turn them into tickets and groups for the user to validate, each group done later in a linked session.

   **Candidates on mathis-plugins.** A candidate that changes a file served by the `mathis-plugins` marketplace (anything under `~/.claude/plugins/cache/mathis-plugins/` or `~/.claude/plugins/marketplaces/mathis-plugins/`: its plugins, this copy of the skills, the `config/rules/*.md` rules that `/setup:install` imports) is not a change for the user to make. Present it as an **issue** to open on the public repository `matwi5/mathis-plugins`, unless the user's `CLAUDE.md` says they maintain mathis-plugins: then present it as a normal candidate, without asking. The user's own project files, `CLAUDE.md`, memory and settings stay normal candidates.
   - One issue per candidate; merge candidates that describe the same problem in the same plugin. Split a mixed candidate: the part on the user's own files stays a normal candidate, the part on the plugin becomes an issue.
   - Before drafting, search the existing issues, open and closed: `gh issue list --repo matwi5/mathis-plugins --state all --search "<keywords>"` with a few keyword sets (plugin, skill or file name, symptom), then read the body and comments of each hit. Without an authenticated `gh`, query the public API (`https://api.github.com/search/issues?q=repo:matwi5/mathis-plugins+is:issue+<keywords>`, a few queries at most: about ten a minute without an account). If both fail, say so, give the search link and mark the candidate **not checked** rather than new.
   - Pick each candidate's outcome and show it next to the candidate. Decide yourself on a clear match (same problem, same plugin); on a partial overlap (same file but another symptom, same symptom but another cause), show the issue found and let the user choose between a new issue and a comment.
     - **No match**: a new issue.
     - **Open issue that covers it all**: nothing to publish; give its number and offer a 👍 (`gh api repos/matwi5/mathis-plugins/issues/<n>/reactions -f content=+1`, otherwise its link for the user to add it).
     - **Open issue, and the candidate adds something** (another case, a clearer cause, a better fix): a comment on it holding only the new part.
     - **Closed as fixed**: compare the installed version (the `version` of `<plugin>@mathis-plugins` in `~/.claude/plugins/installed_plugins.json`; the cache can keep older version folders) with the version that ships the fix (the closing comment, or the plugin's `CHANGELOG.md` on the repository's `main`). Installed version older: suggest `claude plugin marketplace update mathis-plugins`, then `claude plugin update <plugin>@mathis-plugins` and `/reload-plugins`, instead of an issue. Fix already installed: a regression, so a new issue titled "Regression of #<n>" that links it.
     - **Closed as not planned**: nothing to publish; give its link, and draft a comment on it only when the candidate brings a new argument.
   - Draft each issue in full (title and body: the plugin and the file concerned, what went wrong in general terms, the proposed change) and each comment in full (only the new part), in the user's language, or in English when it is neither French nor English.
   - The repository is public: anyone can read an issue or a comment, it gets indexed, and it stays cached once deleted. Keep the search keywords and the published text to the plugin alone: no code, path, project, employer or client name, transcript excerpt or secret from the user's project. If the candidate cannot be explained without such a detail, say so and let the user choose what they accept to publish.
   - Publish only on the user's explicit yes, one publication at a time, after showing its whole text. An issue with `gh issue create --repo matwi5/mathis-plugins` when `gh` is authenticated, otherwise a prefilled link `https://github.com/matwi5/mathis-plugins/issues/new?title=…&body=…` for the user to open; a comment with `gh issue comment <n> --repo matwi5/mathis-plugins`, otherwise the issue's link and the text to paste; a 👍 as above.

## Reference

### Implementation vs Review

Remember that all work goes through two stages: implementation and review. The implementation agent has the most **context pressure**. They are responsible for exploration, writing code, and debugging failures.

The review agent has the least context pressure - it receives a diff, so no exploration needed. It often does not need to write code or debug.

This means that the review agent should be responsible for imposing coding standards, not the implementation agent.

### Files

You have access to several files in the repo:

- `CLAUDE.md`/`AGENTS.md`: these files are pushed to the context window of any agent working in this repo. They should be used incredibly sparingly, usually only for **navigation pointers** to other files.
- `CODING_STANDARDS.md`: this file is read during review, not implementation. Add **navigation pointers** to docs folders if the standards file gets more than 1,000 lines long.
- Docs: use docs as references files, pointed to by other files. Look for existing docs before writing new ones.
- Skills: use skills for docs (since their description goes into the agent's context window), or for user-invoked commands. Follow the advice in the `writing-for-agents` skill.
