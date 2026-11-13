---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.

## The browser

The agent cannot ask the user anything, so it cannot pick between two connected browsers. When the user has allowed Chrome for this research, pick the browser yourself before you spin up the agent: list the connected browsers (`list_connected_browsers`), ask the user which one when there are several, then select it (`select_browser`). The agent's prompt names the chosen browser and tells it not to switch to another one. Without that permission, the agent's prompt tells it not to open Chrome.
