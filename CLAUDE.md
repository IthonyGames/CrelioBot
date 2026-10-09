# CrelioBot — contributor guide

> Running as the CrelioBot Router or the setup agent? This file is for people changing CrelioBot's code — ignore it and follow your agent instructions.

CrelioBot turns a Discord server into the workspace of Claude Code agent teams, one team and one session per knowledge base. Read `README.md` for the product, `CONTEXT.md` for the vocabulary (use its terms in code, tests and docs) and `docs/adr/` before changing anything structural.

## Layout

- `bin/crelio.mjs` — CLI entry. `src/commands/` — setup, doctor, bot, kb, discord.
- `src/instance.mjs` — the Workspace model (settings, KB profiles, secrets, agents, bots, channel ownership).
- `src/runtime.mjs` — pure: Instance + session id → claude args, env, generated files.
- `src/launcher.mjs` — windows, restart loop, stop.
- `src/tools.mjs` + `mcp/server.mjs` — the team's MCP tools (zero-dependency JSON-RPC over stdio).
- `src/discord.mjs`, `src/provision.mjs`, `src/bots.mjs` (bot registration), `src/voice.mjs`, `src/ogg.mjs`, `src/registry.mjs`, `src/context.mjs`.
- `src/calls.mjs` — Calls logic (dependency-free); `calls/` — the optional Call service, the only code with npm dependencies (ADR-0007).
- `hooks/` — guard hooks for the guarded permission level (referenced by generated settings).
- `plugin/` — the Claude Code plugin: agents, skills, SessionStart hook.
- `templates/workspace/` — what setup copies into `workspace/` (git-ignored, ADR-0004).

## Rules

- No runtime dependencies (ADR-0005): Node 22 built-ins only — except inside `calls/` (ADR-0007), which the core never imports.
- Every MCP tool stays inside its session's scope; add a scope test for any new tool.
- Never log, print or post tokens; never read `workspace/.env` outside `src/instance.mjs`.
- Test at the seams (see `docs/architecture.md#tests`): runtime fixtures, MCP server and hooks as processes against `test/fake-discord.mjs`. Run `npm test` before committing.
- Windows first, macOS/Linux supported: paths through `node:path`, `.bat` files CRLF.
- Agent prompts are English; agents write Discord messages in the KB's language.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
