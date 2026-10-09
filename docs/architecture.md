# Architecture

Vocabulary: [CONTEXT.md](../CONTEXT.md). Decisions and why: [docs/adr/](adr/).

## Processes

```
start-crelio.bat ─► crelio start ─► one console window per session (Windows Terminal tab if installed; tmux on macOS/Linux)
                                     └─ crelio run <id>   restart loop: regenerate files → (git pull) → claude … → wait → repeat

claude (one per KB, cwd = KB folder, --agent creliobot:manager, --name crelio-<kb>)
 ├─ plugin:discord@claude-plugins-official   official channel: Discord gateway as the Manager bot,
 │                                           delivers messages from this KB's category only (static access.json)
 ├─ mcp crelio (mcp/server.mjs)              team tools: post as any agent's bot (REST), threads + registry,
 │                                           voice, schedules, provision_agent, restart_session
 ├─ plugin creliobot (plugin/)               agents, skills, SessionStart context hook
 └─ subagents                                Specialists (background), nested up to Claude Code's limit

claude (Router, cwd = workspace/, --agent creliobot:router, --name crelio-router)
 └─ same, listening to the Global General; route + SendMessage to crelio-<kb>
```

No process of ours holds the Discord gateway: each session's official plugin does, all with the Manager token (several gateway sessions on one token is supported by Discord and verified in spike 01). Specialist bots only use REST; `crelio bot add` logs each one into the gateway once, which Discord requires before a bot can post.

## A Task, end to end

1. A person writes in a KB's `#general`. The plugin (Manager bot) reacts 👀 and pushes a `<channel>` event into that KB's session.
2. The Manager (main thread) routes it (`whereami` when unclear), then `thread_list` → reuse a Task thread or `thread_open` on the message. Task system sync per the `task-system` skill; `thread_meta` stores task id, Requester, Hops.
3. The Manager dispatches Specialists as background subagents, KB Researcher first, then the research wave in parallel. Each posts in the thread **with its own bot** (`post(agent: …)`), may call another Specialist directly, and returns a `STATUS:` block.
4. Escalation: a Specialist posts numbered questions tagging the person, returns `needs-input` with the message id; the Manager records `waiting_on`. The person replies under the question → the plugin delivers it → `whereami` shows `replied_to.agent` → the Manager continues that subagent (`SendMessage`) with the answer.
5. Summary, ticket update, learnings, `thread_close`.

Agents never talk to each other *through* Discord (the official plugin drops bot messages, ADR-0002): they call each other inside the session and *show* the conversation in Discord.

## Router → KB

The Router posts the request in the KB's General with `route` (as that KB's Manager bot, quoting the author) and then sends the KB session a cross-session message (`SendMessage` to `crelio-<kb>`, local named pipe / Unix socket) naming the posted message. KB sessions accept cross-session messages (`crossSessionInbound: accept` in their generated settings).

The launcher strips the parent session's identity variables (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, …) from every session it starts: inherited, they make a session believe it is nested, and it never registers for cross-session messages (found in spike 01).

## Restarts

A session that exits restarts after 3 s (backing off to 60 s when it keeps crashing). On start, the plugin's SessionStart hook injects the session context: identity, roster, task adapter, Schedules to arm, the last 5 messages of the General and of every open thread, recent Team learnings. Unfinished Tasks resume only when someone continues them.

## Files generated per session (`workspace/state/<id>/`)

| File | Purpose |
|---|---|
| `discord/access.json` | Official plugin access (static mode): the session's channels, no mention required, DMs dropped |
| `discord/inbox/` | Attachments downloaded by the plugin |
| `settings.json` | `crossSessionInbound`, permission allowlist, guard hooks (guarded level) |
| `mcp.json` | The Crelio MCP server for this session |
| `threads.json` | Thread registry: kind, Task id, Requester, owning agent, parent, Hops, waiting_on |
| `claude.pid`, `session.log`, `window.cmd` | Launcher bookkeeping |

## Permission levels (per KB, ADR-0006)

- `guarded`: `--permission-mode dontAsk`; allowlist = team tools, read tools, `Edit(./**)`, git/gh/npm basics, profile `allow.tools`; PreToolUse hooks `hooks/guard-bash.mjs` (every path in a command inside the KB or inbox; never Workspace secrets) and `hooks/guard-files.mjs` (attachments).
- `full`: `--permission-mode bypassPermissions`.

## Tests

`npm test`: Node's test runner, no dependencies. Seams: the session runtime (Workspace in → claude command and files out), the MCP server and hooks as processes against an in-memory fake of Discord and OpenAI (`test/fake-discord.mjs`), and Ogg parsing. Live checks: [smoke-test.md](smoke-test.md).
