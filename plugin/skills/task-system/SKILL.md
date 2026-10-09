---
name: task-system
description: Keep a KB's own task system in sync with CrelioBot Tasks — detect it (local board, Notion, Motion, markdown tickets, a KB skill), create or update the ticket for each Task, and offer to set one up when the KB has none.
---

# Task system

CrelioBot never replaces a KB's task system — it uses the KB's own, through its **Task adapter** (`team` → `kb.tasks.adapter`, plus `kb.tasks.notes`).

## Adapters

| Adapter | How to read and write tickets |
|---|---|
| `local-board` | The KB's local board (kb-wizard: `board.json` changed only through its helper script, e.g. `local_board.py`; never hand-edit generated views like `tasks.md`). |
| `notion` | The Notion MCP server configured for the KB (database named in `tasks.notes`). |
| `motion` | The Motion MCP server or API tool configured for the KB. |
| `markdown-tickets` | One markdown file per ticket in the folder named in `tasks.notes` (e.g. `.scratch/<feature>/issues/NN-slug.md`, with a `Status:` line). |
| `skill:<name>` | Call the KB's own skill `<name>` — it knows the KB's conventions. |
| `none` | No task system yet — see "Offering one" below. |

If the adapter is unset or `none`, **detect** before concluding: look for `board.json` / a board script, a tasks database mentioned in `CLAUDE.md` or `kb.config.json` (`tasks.backend`), `.scratch/*/issues/`, task skills in `.claude/skills/`, Notion/Motion MCP servers. If you find one, use it and tell the owner they can record it as the KB's adapter.

## For each Task

1. **Find** an existing ticket that matches (title, keywords) before creating one.
2. **Create** it if missing: title = the Task thread title, description = the request + a link to the Task thread, status per the KB's convention (default: "To do" / "In progress").
3. **Store** the ticket id on the thread: `thread_meta(patch: { task_id })`.
4. **Update** at milestones (in progress, waiting on someone, review) and at the summary. Default final status is **Review** — never "Done" for work a person hasn't checked, unless the person reports it done themselves.
5. Mention the ticket (link or id) in the Task summary.

## Offering one

When the KB has no task system, ask the Requester once, in the Task thread:

> This KB has no task system yet. Want one? 1) a simple local board in the KB (recommended), 2) connect your Notion / Motion / other tool, 3) no thanks.

- **Local board**: create `tasks/BOARD.md` in the KB — one `## <status>` section per column (To do, In progress, Waiting, Review, Done) with one bullet per ticket: `- [T-<n>] <title> — <thread link> — <owner>`. Ticket ids increment. Record the decision as a KB learning.
- **Another tool**: tell the owner which MCP server to add and that `tasks.adapter` goes in the KB profile; continue without one meanwhile.
- **No**: record the preference as a KB learning so you never ask again.
