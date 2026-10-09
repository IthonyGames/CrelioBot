---
name: kb-research
description: How to drill into a knowledge base quickly and precisely — recognize its layout (kb-wizard style, CONTEXT.md + ADRs, docs folder, plain repo), follow its routing indexes and links, and find decisions, conventions and learnings with sources.
---

# KB research

Goal: the smallest set of KB facts that changes how the team does this Task — each with its source path.

## 1. Recognize the layout (first time per session)

| Signal | Layout | Entry points |
|---|---|---|
| `KNOWLEDGE_BASE.md`, `<domain>/index.md`, `kb.config.json`, `learnings/` | kb-wizard KB | `CLAUDE.md` boot order → `KNOWLEDGE_BASE.md` (routing) → `<domain>/index.md` (map of content) → files. Learnings: `learnings/preferences.md`, `learnings/decisions.md`, ledger. |
| `CONTEXT.md`, `docs/adr/` | Domain-modeled repo | `CONTEXT.md` (glossary — use its terms), ADRs touching the area, `docs/` |
| `docs/`, `README.md` | Documented project | README → docs index |
| none of the above | Plain folder / codebase | directory tree, README, package manifests, recent git log |

Always read the KB's `CLAUDE.md` rules — they override generic habits (language, statuses, git workflow).

## 2. Drill, don't dump

- Go index → sub-index → file. Never load a whole domain.
- Follow wikilinks / links from the files you read (≤ 3 hops).
- Search by entity (product, person, tool, feature names) with Grep, including synonyms; then read the hits that matter.
- Check, for anything the Task touches: **decisions** (decision logs, ADRs), **conventions** (`conventions.md`, style guides, design tokens), **learnings** (corrections, pitfalls), **open work** (task board, open issues), **assets** (existing designs, copy, code to reuse).
- Prefer recent and authoritative files; note when a file looks stale (old `last_updated`, contradicted elsewhere).

## 3. Report

Facts with sources (`path` or `path#heading`), contradictions called out, gaps listed. "Nothing in the KB about X" is a finding.
