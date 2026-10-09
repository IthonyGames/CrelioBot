---
name: agent-creator
description: Create a Custom agent for a CrelioBot team when someone asks ("create an agent for video editing") — short interview, the agent's definition file, its Discord channel and role, guidance to create its bot, then a session restart to load it.
---

# Agent creator

A Custom agent is a new role on the team, with its own instructions, model and Discord bot. Run this when someone asks the Manager for a new agent (or the Router, for an agent shared by every KB).

## 1. Interview — one round

Post one round in the request's thread (grilling format: numbered questions, your recommendation for each — "ok" accepts all):

1. **Role** — what it is responsible for, in one sentence; what it must never do.
2. **When to involve it** — which Tasks, at which point of the Pipeline (before/after which agents), and whether people talk to it directly in its channel.
3. **Output** — what it posts or produces, in what shape.
4. **Skills and tools** — skills it should use (e.g. `creliobot:websearch`, a KB skill), MCP tools it needs.
5. **Model** — `sonnet` (default: fast, cheaper) or `opus` (deep reasoning, building).
6. **Name** — display name and id (lowercase-with-dashes, e.g. `video-editor`).
7. **Scope** — this KB only (stored in the KB, versioned with it) or every KB (stored in the Workspace — ask in the Global General).

Escalate only what you can't infer from the request and the KB.

## 2. Write the definition

Compose the definition and pass it to `mcp__crelio__provision_agent(agent: <id>, definition: <content>)` — the tool saves it (in the KB's `.claude/agents/` from a KB session; in the Workspace plugin for every KB from the Router), registers the agent, and creates its Agent channel and role. Don't write the file yourself: `.claude/` is protected in guarded sessions.

Template:

```markdown
---
name: <id>
description: <Display name> on a CrelioBot team — <role in one sentence>; <when the Manager should involve it>.
model: <sonnet|opus>
skills:
  - creliobot:team-protocol
  - <other skills>
---

You are the **<Display name>**. <Mission in two sentences.>

## How you work
<steps specific to the role, grounded in the KB's conventions>

## What you post
<the shape of its Discord output, with an emoji header like the Core agents>
```

## 3. Its bot (the owner, on the PC)

The agent can't post without its own bot application. If `bot_ready` is false, post these exact steps to the **owner** (tag them):

1. https://discord.com/developers/applications → **New Application** → name **<Display name>** → Create.
2. **Installation** → Install Link **Discord Provided Link** → Default Install Settings → Guild Install → scope **bot** → Permissions: View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis, Send Voice Messages → Save Changes.
3. **Bot** → **Reset Token** → Copy; **Public Bot** OFF → Save Changes.
4. On the PC, in the CrelioBot folder: open `workspace/.env`, add `DISCORD_TOKEN_<ID_IN_CAPS_WITH_UNDERSCORES>=<token>`, save — then run `node bin/crelio.mjs bot add <id>`.
5. **Installation** → copy the Install Link → open it → Add to server → Authorize.
6. Reply "done" here.

**Never** accept a token pasted in Discord — if someone pastes one, tell them to reset it in the Portal immediately.

## 4. Load it

When the bot is ready (owner said "done"), post that the team restarts for a few seconds, then call `mcp__crelio__restart_session` (the Router: once per KB). After the restart, dispatch the new agent once to introduce itself in its channel (2-3 lines: what it does, when to call it).
