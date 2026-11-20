---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, review the work. When a flow-board dashboard follows this skill, its instructions say which reviews run and how (the review of each ticket, then the review of the lot or of the group), and they win over this line. Otherwise, call the Skill tool with "code-review" (this plugin's two-axis review, mattpocock-skills:code-review).

Commit your work to the current branch.
