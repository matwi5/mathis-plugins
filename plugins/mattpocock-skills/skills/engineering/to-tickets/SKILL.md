---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

**A ticket in a sensitive area is written from the code, not from memory.** Before writing one of its acceptance criteria, or an option you offer the user about it, read the function it names. List every path that writes, merges, erases its data or reads it to make a decision (a view, a sort, a cleanup) by a search, and quote that search in the ticket: the command and its result. Ask the lifecycle question (the name at the second send, who writes the data, when it goes stale, how what gets deleted is designated). For a persisted field, it also covers a failed read, a failed write, its bounds (empty, too long, a date in the future or the past), the erasure of what must be kept, a forged copy, and each transition of the object that carries a mark (sent, cancelled, sent again, back), with what the mark becomes at each one, and what becomes of a value already kept out of form when a new one arrives: these questions are foreseeable while framing, and left open they come back one ticket at a time during the implementation. A ticket that changes an attachment predicate (what decides which object a value read back belongs to: a session to a group, a count to a relay) carries the table of the forms that predicate receives: absent, template not filled in, old id (out of form), valid but unknown to the plan; for each form, the table gives its fate and the test that fixes it, and a sensitive question that sorts values repeats that table under each of its options. A ticket never keeps an « à confirmer »: that is a question for the user now, while framing.

**Every sensitive ticket carries an invariant.** A ticket in a sensitive area has a line « **Invariant:** « … » »: the one sentence of what the thing it touches must never do or become (its persisted data; for a ticket that keeps no data, what a command or a path it builds must never reach). For a very sensitive ticket (it writes data other discussions or sessions also write, or it deletes data), that sentence is settled with the user. For a ticket that is only sensitive, the session that breaks the work down writes it and shows it with the breakdown. Without that line, every Important finding of its reviews gets fixed instead of going to the report, and the fixes chase each other (one low-severity finding grew into 23 over three review rounds).

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**A measurement ticket** (a probe, a benchmark, a trial whose results a document records) asks, in its acceptance criteria, that each result it writes quotes its log line: the log file and the line, or the raw output it comes from. A text written before the measurement and never checked against it keeps claims that no run showed. A measurement of what a session loads at start runs in an interactive session: a `-p` run loads neither connectors nor deferred tools. A done criterion compares only the files the ticket changes (a diff limited to its paths), never a whole shared file that other sessions may change meanwhile.

**A criterion about the existing tests** (« the existing tests pass without changing their expectations »), in any ticket, sensitive or not, quotes the search for the tests that read the function the ticket changes: the command and its result. Written from memory, such a criterion was false (42 tests in 16 files read the changed function). Each ticket template below carries a line for that search, so it is not forgotten at the first draft.

**A criterion never misleads the session that runs it.** Three more ways a criterion did:

- **No absolute count on a file another ticket of the lot changes.** « 16 tests » goes false as soon as the other ticket lands first. The criterion says « the tests from before pass », and when one ticket's criterion counts or reads what another ticket changes in the same file, the two get a blocking edge from one to the other.
- **Test data stays possible.** Data that a criterion has the code delete, move or sort carries values the ticket's own code could have produced (a name, a date, an owner). Impossible data (a file named outside the form the code writes, dated 1970) tests a case the code never meets and contradicts the invariant of a sensitive ticket, and its fixes go round in circles.
- **A landmark names its source.** A folder, a root or a reference file says where it comes from: the environment variable, or the folder the command runs from (« the folder » alone can be the caller's or the project's).

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Before asking the user to approve (in a run where the approval is skipped, before declaring it skipped), check that each sensitive ticket has its invariant line, then reread each acceptance criterion of each sensitive ticket against its invariant (the sentence of what the thing it touches must never do or become); a sensitive ticket without an invariant is not put up for approval (in a run where the approval is skipped, a very sensitive ticket whose invariant awaits the user is not started before the answer; the rest of the breakdown goes on). A criterion that breaks its ticket's invariant (a date « brought back to now » in a ticket whose invariant says « a real past date ») is rewritten, or becomes a question for the user now. Reread also each clause of the invariant of any ticket that carries one against the current code, field by field: a clause the code already breaks by design becomes a question for the user now, and the ticket quotes the search that checked it, naming those fields and the function the ticket changes (an invariant naming fields the code broke by design was only seen at implementation).

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured; the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below: one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. If the source was an existing issue, make each ticket its sub-issue (tracker doc's operation). Apply the `ready-for-agent` triage label unless instructed otherwise; the tickets are agent-grabbable by construction.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

<local-ticket-template>

# <NN>: <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None (can start immediately)".

**Status:** ready-for-agent

**Tests that read the function:** `<command>` — <result> (remove this line from a ticket that changes no tested function)

**Invariant:** « the one sentence of what the thing this ticket touches must never do or become » (remove this line from a ticket outside a sensitive area)

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Acceptance criteria

**Tests that read the function:** `<command>` — <result> (remove this line from a ticket that changes no tested function)

**Invariant:** « the one sentence of what the thing this ticket touches must never do or become » (remove this line from a ticket outside a sensitive area)

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)". Omit this section when blockers were set as native edges.

</issue-template>

In either form, avoid specific file paths or code snippets: they go stale fast. The searches a ticket quotes (their command and result, such as the line « Tests that read the function ») keep their paths: they record what was checked, and when. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.
