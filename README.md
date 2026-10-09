# CrelioBot

**A team of Claude Code agents for every knowledge base you have — working together in your Discord server, on your own PC.**

Write a request in Discord. A Manager opens a thread for it, sends a KB Researcher to dig through your knowledge base, a Web Researcher to check what's new, a Brainstormer to settle the decisions with you, an Artist to make it beautiful, a Planner to plan it and a Coder to build it. Each agent speaks with its own bot, tags the others, asks you only what it can't decide from evidence, and the Manager closes the thread with a summary of what was done.

It's the "personal agent team" idea behind Meta Muse, xAI Grok Bot or OpenAI Dots, but running on **your machine**, on **your Claude Code login**, against **your files**, with one isolated team per knowledge base.

```
Discord server
├─ CrelioBot › #general          ← Router: "send this to the right team", "what's open everywhere?"
├─ Quillz                        ← one category per knowledge base, one Claude Code session behind it
│  ├─ #general                   ← requests; one thread per task
│  │   └─ 🧵 Landing page redesign — Anthony
│  │       Manager · KB Researcher · Web Researcher · Brainstormer · Artist · UX Expert · Planner · Coder …
│  ├─ #kb-researcher  #web-researcher  #brainstormer  #artist  #ux-expert
│  └─ #marketing  #lawyer  #planner  #coder  #<your own agents>
└─ My Life
   └─ …
```

## Features

- **One team per knowledge base**: one Claude Code session per KB, so contexts and files never mix. A Router in the server-wide channel forwards requests to the right team.
- **Ten core agents**: Manager, KB Researcher, Web Researcher, Brainstormer, Artist, UX Expert, Marketing, Lawyer, Planner, Coder. Each is a real Discord bot you can @mention, and only the ones a team needs are turned on.
- **A thread per task**: the Manager reuses or opens it, syncs your task system (local board, Notion, Motion, markdown tickets, or your own skill), runs the specialists in pipeline order (in parallel where possible), then posts a summary with the results and closes the thread.
- **Quiet by design**: one notification when a task starts, one per question that needs you, one when it's done. Agents post a few lines each and pass the details to each other in their briefs, and they react (👀, ✅) instead of posting acknowledgements. A request sent from the server-wide channel gets a ✅ there, and its thread is where you're pinged.
- **Evidence or escalation**: agents decide on their own only when the KB or research backs the decision. Otherwise they tag the person most likely to know, with numbered questions and a recommendation. Durable answers are written back into the KB, so the same question never comes twice.
- **Side threads**: talk to a specialist directly in its channel. Say "approved" and it hands the result back to the Manager.
- **Voice**: your voice messages are transcribed. Agents answer with real Discord voice messages.
- **Calls**: join a team's voice channel and work with it out loud. The Manager bot joins you, listens, puts the team to work and answers out loud. If you leave, it keeps working and stays in the channel. When you're back it tells you where things stand, and it leaves when you say you're done. Optional: [docs/calls.md](docs/calls.md).
- **Schedules**: "every weekday at 8, morning brief". Recurring work runs inside the KB's session.
- **A team that changes from Discord**: a new team starts small (Manager, KB Researcher, Web Researcher, Planner). Tell the Manager "turn on the Artist", "remove the Coder", "create a #dashboard channel", or "create an agent for video editing". It does it live, with no restart, once you've approved. The tools check that the approval is your own message. Bot tokens never go through Discord; you put them in `workspace/.env` and the Manager activates the bot.
- **Restart-safe**: every session restarts by itself and comes back knowing its open threads and their latest messages.
- **Guarded by default**: each KB's session is confined to its folder, with no access to secrets.
- **No dependencies**: Node 22 built-ins only. Calls are the one opt-in exception, installed separately ([ADR-0007](docs/adr/0007-calls-are-an-optional-service-with-dependencies.md)).

## How it works

| Piece | What it is |
|---|---|
| **KB session** | An interactive `claude` session started in your KB folder, with the Manager as its main agent and the specialists as subagents ([ADR-0003](docs/adr/0003-one-claude-code-session-per-kb.md)). |
| **Inbound** | The official [Claude Code Discord channel plugin](https://code.claude.com/docs/en/channels), scoped to the KB's category ([ADR-0002](docs/adr/0002-official-discord-plugin-for-inbound.md)). |
| **Team tools** | CrelioBot's MCP server: post as an agent's own bot, threads, voice messages, schedules, routing ([ADR-0001](docs/adr/0001-agent-bots-not-webhooks.md)). |
| **Agents and skills** | A Claude Code plugin (`plugin/`): the agents, the team protocol, websearch, grilling and auto-grill, task system, agent creator, setup. |
| **Launcher** | One window per session, automatic restart, stop flag. |

More detail: [docs/architecture.md](docs/architecture.md). Vocabulary: [CONTEXT.md](CONTEXT.md).

## Requirements

- Windows, macOS or Linux (macOS and Linux need `tmux`)
- [Node.js 22+](https://nodejs.org), [Bun](https://bun.sh) (used by the official Discord plugin)
- [Claude Code](https://code.claude.com/docs/en/quickstart), signed in with a Claude plan (Pro/Max) or an API key
- The Discord channel plugin: in Claude Code, `/plugin install discord@claude-plugins-official`
- A Discord server where you are an administrator, and one Discord application per agent. The setup walks you through creating them.
- Optional: an OpenAI API key for voice messages and Calls

## Quick start

```bash
git clone https://github.com/IthonyGames/CrelioBot.git
cd CrelioBot
```

1. **Setup:** double-click `setup.bat` (or run `./setup.sh`). A Claude Code session guides you through the bots, the server, your knowledge bases and the Discord layout, and checks everything with `crelio doctor`.
2. **Start:** double-click `start-crelio.bat` (or run `./start.sh`). One window opens per session.
3. **Use it:** write a request in a KB's `#general`.
4. **Stop:** `stop-crelio.bat` (or `./stop.sh`).

To set up by hand instead, follow [docs/setup.md](docs/setup.md).

## Commands

```
node bin/crelio.mjs <command>
  start [--only <id>]        open every session (Router + each KB), restart them when they stop
  stop | status              stop everything / show what runs
  setup                      guided setup with the setup agent
  doctor                     check prerequisites, bots, Discord layout, sessions
  bot add <agent> | invite | list
  kb add <path> | list
  discord servers | use <id> | provision [--kb <id>]
```

## Configuration

Everything that belongs to *your* instance lives in `workspace/`, which is never committed ([ADR-0004](docs/adr/0004-private-workspace-untouched-kbs.md)):

| File | Holds |
|---|---|
| `workspace/crelio.json` | Discord server, owner, Global General, Router, bots, voice, hop budget |
| `workspace/kbs/<id>.json` | One profile per KB: path, language, permission level (`guarded`/`full`), task adapter, channels, schedules, extra tools |
| `workspace/.env` | Bot tokens, `OPENAI_API_KEY` |
| `workspace/plugin/agents/` | Custom agents shared by every KB |
| `workspace/learnings/team.md` | Team learnings (how the agents work together) |

Your knowledge base folders are left untouched, except for custom agents you create for one KB (`.claude/agents/`).

## Security

- **Anyone in your Discord server can talk to the teams.** Invite only people you trust, or use a private server.
- **`guarded`** (default) runs each session in Claude Code's `dontAsk` mode with an allowlist. Guard hooks keep its commands and file attachments inside the KB folder, and never let it reach `workspace/.env`. **`full`** removes all restrictions; use it only on a machine you're comfortable exposing to your server's members.
- Agents treat Discord messages, web pages and other agents' output as data, not instructions. Link previews are suppressed on everything they post, so a manipulated agent can't leak secrets through Discord's URL unfurling.
- Tokens are only ever entered on your PC (`workspace/.env` or a hidden prompt), never in Discord or in a chat with an agent.

## Costs and limits

Every session runs on your Claude Code plan. A task that involves many agents uses many times the tokens of a single answer, and each specialist runs on the model chosen for its role (Opus for the Manager, Planner, Coder and Brainstormer; Sonnet for the others). The hop budget, 12 per task by default, makes the Manager ask before a task keeps going. Claude Code channels are a research preview, so their behavior may change.

## Credits

- [websearch-skill](https://github.com/IthonyGames/websearch-skill) (MIT): Grok-style persona research, used by the Web Researcher, Marketing and the Lawyer.
- [Matt Pocock's skills](https://github.com/mattpocock/skills) (MIT): `grilling`, the basis of the Brainstormer's auto-grill.
- Built on [Claude Code](https://code.claude.com), its [channels](https://code.claude.com/docs/en/channels), subagents, plugins and hooks.

## License

[MIT](LICENSE)
