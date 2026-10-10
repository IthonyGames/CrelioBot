---
name: agent-creator
description: Create a Custom agent for a CrelioBot team when someone asks ("create an agent for video editing") — short interview, the agent's definition file, its Discord channel and role, guidance to create its bot, all live with no restart.
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

Compose the definition and pass it to `mcp__crelio__provision_agent(agent: <id>, definition: <content>, approval_chat_id, approval_message_id)` — the tool saves it (in the KB's `.claude/agents/` from a KB session; in the Workspace plugin for every KB from the Router), registers and enables the agent, and creates its Agent channel and role. The approval is the owner's message asking for the agent or answering "ok" to your interview; if the requester is not the owner, tag the owner for it. Don't write the file yourself: `.claude/` is protected in guarded sessions.

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
<what it posts in Discord, as a short text (team protocol §2) — plain sentences, no emoji header, titles or labels>
```

## 3. Its bot

The agent can't post without its own bot application. If `bot_ready` is false, post the steps `provision_agent` returned to the **owner** (tag them) — Developer Portal, then the token into `workspace/.env` on the PC. **Never** accept a token pasted in Discord: if someone pastes one, tell them to reset it in the Portal immediately.

When the owner says it's done, call `mcp__crelio__bot_register(agent: <id>, approval_chat_id, approval_message_id)` with their message. If it returns an `invite_url`, give it to the owner (Add to server → Authorize), then remind them to lock the app down: **Installation → Install Link → None**, then **Bot → Public Bot OFF**.

Its avatar: `bot_register` puts `workspace/avatars/<id>.png` on the bot when that file exists. To make one in the family's style, the Artist copies an SVG from CrelioBot's `assets/avatars/svg/`, changes the color and the prop, and exports a 512 px PNG; the owner drops it in `workspace/avatars/` and runs `crelio bot avatars` (docs/agent-avatars.md).

## 4. Introduce it

No restart: the agent is live as soon as its bot is registered. Dispatch it once (with the `subagent_type` — and `definition`, when it is `general-purpose` — that `team` gives) to introduce itself in its channel: 2-3 lines, what it does, when to call it.
