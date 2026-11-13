---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

A round holds **4 questions at most, and about 400 words**: rounds of 750 to 1,050 words went unread. When the frontier holds more, ask first the questions whose answers unblock the most others; the rest of the frontier waits for the next round.

Format a round like so: a two-column table first, the question in a few words and your recommended answer in one line, then the detail of each question under it.

```
| Question | Recommended |
|---|---|
| 1. <question in a few words> | <your recommended answer, one line> |
| 2. <question in a few words> | <your recommended answer, one line> |

❓ **Q1** - **<question title>**: <the fact it rests on, one sentence>. <question body, a few lines at most, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <the fact it rests on, one sentence>. <question body, a few lines at most, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer. Each question reads on its own: it restates in one or two sentences the fact or the finding it rests on, instead of pointing to a report the user may not have read. In a round, that fact holds in one sentence, under the table, at the head of its question; the body of a question stays within a few lines.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one. When the user imposes a mechanism (a tool, a format, an approach), the next round's first question is about the mechanism itself; its settings wait for the round after, since they fall if the mechanism changes.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now, within the round's bound of 4 questions. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
