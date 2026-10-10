# Architecture

Vocabulary: [CONTEXT.md](../CONTEXT.md). Decisions and why: [docs/adr/](adr/).

## Processes

```
start-crelio.bat ─► crelio start ─► one console window per session (Windows Terminal tab if installed; tmux on macOS/Linux)
                                     └─ crelio run <id>   restart loop: regenerate files → (git pull) → claude … → wait → repeat

claude (one per KB, cwd = KB folder, --agent creliobot:manager, --name crelio-<kb>)
 ├─ plugin:discord@claude-plugins-official   official channel: Discord gateway as the Manager bot,
 │                                           delivers messages from this KB's category only (access.json, re-read live)
 ├─ mcp crelio (mcp/server.mjs)              team tools: post as any agent's bot (REST), threads + registry,
 │                                           voice, schedules, provision_agent, restart_session
 ├─ plugin creliobot (plugin/)               agents, skills, SessionStart context hook
 └─ subagents                                Specialists (background), nested up to Claude Code's limit

claude (Router, cwd = workspace/, --agent creliobot:router, --name crelio-router)
 └─ same, listening to the Global General; route + SendMessage to crelio-<kb>
```

No process of ours holds the Discord gateway: each session's official plugin does, all with the Manager token (several gateway sessions on one token is supported by Discord and verified in spike 01). Specialist bots only use REST; `crelio bot add` logs each one into the gateway once, which Discord requires before a bot can post.

## A Task, end to end

1. A person writes in a KB's `#general`. The plugin (Manager bot) pushes a `<channel>` event into that KB's session. It adds no receipt reaction: `ack_reaction` in `crelio.json` turns one on (e.g. `"👀"`).
2. The Manager (main thread) routes it (`whereami` when unclear), then `thread_list` → reuse a Task thread or `thread_open` on the message. Task system sync per the `task-system` skill; `thread_meta` stores task id, Requester, Hops.
3. The Manager dispatches Specialists as background subagents, KB Researcher first, then the research wave in parallel. Each posts in the thread **with its own bot** (`post(agent: …)`), may call another Specialist directly, and returns a `STATUS:` block.
4. Escalation: a Specialist posts numbered questions tagging the person, returns `needs-input` with the message id; the Manager records `waiting_on`. The person replies under the question → the plugin delivers it → `whereami` shows `replied_to.agent` → the Manager continues that subagent (`SendMessage`) with the answer.
5. Summary, ticket update, learnings, `thread_close`.

Notifications: a Task pings its Requester when it starts (the thread opener), for each question that needs them, and when it is done (the summary). Everything else is short and quiet — `post` never pings the author of a message it replies to, only the people its text mentions, and flags posts over 900 characters back to the agent; the details travel between agents in their briefs (the final answer each returns).

Agents never talk to each other *through* Discord (the official plugin drops bot messages, ADR-0002): they call each other inside the session and *show* the conversation in Discord.

## Router → KB

The Router posts the request in the KB's General with `route` (as that KB's Manager bot, silently, naming the author without a mention and copying the request's attachments), leaves the original untouched (no reply, no reaction), and then sends the KB session a cross-session message (`SendMessage` to `crelio-<kb>`, local named pipe / Unix socket) naming the posted message. The KB's Task thread opener is the author's one ping. KB sessions accept cross-session messages (`crossSessionInbound: accept` in their generated settings).

The launcher strips the parent session's identity variables (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, …) from every session it starts: inherited, they make a session believe it is nested, and it never registers for cross-session messages (found in spike 01).

## Team changes, live

A Team change is made by the owner's message, through `agent_enable`, `agent_disable`, `discord_admin`, `bot_register` and `provision_agent`. A KB session changes its own team; the Router changes any team and passes `kb`. Each tool:

1. **Checks the Owner approval.** It fetches the message named by `approval_chat_id` / `approval_message_id`. The message must be in the session's own channels, written by the owner (`server.owner_id`, or someone in `admins`), and at most a day old. A recent message from the owner, in the session's channels, is the only accepted proof: an Agent cannot make a Team change on its own initiative.
2. **Makes the change.** It changes Discord through the KB's Manager bot (channels, roles, display name) and records it in the KB profile (`agents.enabled`, `discord.*`) or in `crelio.json` (`bots`).
3. **Rewrites the session's `access.json`.** The official plugin re-reads it on every message, so a new channel is heard at once.

Nothing restarts:
- The MCP server holds a **live Instance**: a proxy that re-reads the Workspace when one of its files changes, checking at most once a second. A Team change made by one session, by the Router or in the owner's editor is therefore seen by every running session.
- Core agents are always loaded through the plugin, whether enabled or not.
- A Custom agent created mid-session is loaded natively only if its KB's `.claude/agents/` folder existed when the session started; Claude Code watches that folder. Otherwise `team` returns it as `general-purpose` with its `definition` file, and the Manager dispatches it that way.

Tokens stay out of Discord. The owner puts a token in `workspace/.env` on the PC. `bot_register` reads it inside the MCP server process (`src/bots.mjs`, shared with `crelio bot add`) and never returns it.

Profiles written before the Default team existed list `agents.disabled` instead of `agents.enabled`. They keep every agent but the disabled ones. Their first Team change rewrites them as an explicit `enabled` list.

## Restarts

A session that exits restarts after 3 s (backing off to 60 s when it keeps crashing). On start, the plugin's SessionStart hook injects the session context: identity, roster, task adapter, Schedules to arm, the last 5 messages of the General and of every open thread, recent Team learnings. Unfinished Tasks resume only when someone continues them.

## Files generated per session (`workspace/state/<id>/`)

| File | Purpose |
|---|---|
| `discord/access.json` | Official plugin access: the session's channels, no mention required, DMs dropped. The plugin re-reads it on every message; Team changes rewrite it |
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
