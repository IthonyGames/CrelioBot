# CrelioBot v1 — spec

Status: ready-for-agent

## Problem Statement

People who keep their work in Claude Code knowledge bases want to drive them from Discord — from their phone, by voice, together with other people — and want more than one assistant answering: a real team of specialists that researches, debates, designs, plans and builds, the way Meta Muse, xAI Grok Bot or OpenAI Dots promise but on their own PC, on their own Claude login, against their own files.

Today the owner runs one Claude Code session per KB through the official Discord channel plugin, one bot per KB, each with hand-written launchers, tool servers and guard hooks. It works for one assistant per KB, but there is no team: no specialists with their own identity, no way for one agent to hand work to another, no shared protocol for tasks, threads, voice or learnings, and every new KB means copying and editing scripts. Nothing comparable exists as an open-source project: OpenClaw and Hermes run their own agent loop (and Anthropic no longer lets subscriptions power third-party harnesses), and the Claude Code Discord bots that exist give one agent per session.

## Solution

CrelioBot is an open-source framework that turns a Discord server into the workspace of Claude Code agent teams, one team per KB.

- The server has a **Global General** channel served by a **Router session**, and one **KB category** per KB. Each category has a **KB General** (where requests are made and **Task threads** live) and one **Agent channel** per Specialist.
- Each KB is served by one **KB session** — a normal interactive Claude Code session started in the KB folder, with the **Manager** as its main thread. The ten **Core agents** (Manager, KB Researcher, Web Researcher, Brainstormer, Artist, UX Expert, Marketing, Lawyer, Planner, Coder) and any **Custom agents** each speak through their own Discord **Agent bot**.
- A request in a KB General becomes a **Task**: the Manager reuses or opens a Task thread, syncs the KB's task system, then runs the **Pipeline** — KB Researcher first, then the research wave, Brainstormer, Artist, Planner, Coder and the review — and ends with a summary of what was done, the results, and the closed thread.
- Agents decide on their own when they have **Evidence**; otherwise they **Escalate** to the person most likely to know, who answers right under the question. Answers that are durable knowledge are written into the KB, so autonomy grows.
- Specialists can pull a person into a **Side thread** in their Agent channel, then hand the result back to the Manager in the Task thread.
- Voice works both ways: a person's Voice note is transcribed, and an Agent can answer with a real Discord Voice note.
- The **Router** forwards requests from the Global General to the right KB session, answers questions across KBs, and handles administration.
- Setup is done by an agent: one launcher opens a Claude Code session that walks the user through creating the bots, adding KBs and creating the Discord layout. Another launcher starts every session in its own window and restarts any that stops.

## User Stories

### Setup and operation

1. As a new user, I want to clone the repo and run one setup launcher, so that I don't have to read a long manual before trying CrelioBot.
2. As a new user, I want the setup to be a conversation with an agent, so that it adapts to my server, my KBs and my language.
3. As a new user, I want step-by-step guidance for creating each bot application (including the Message Content intent), so that I don't get lost in the Discord Developer Portal.
4. As a user, I want to give tokens only through local files or a local prompt, never in Discord or chat, so that my bots can't be hijacked.
5. As a user, I want an invite link generated for each bot with exactly the permissions it needs, so that I don't have to compute permission integers.
6. As a user, I want the setup to create the Global General, one category per KB, its KB General and its Agent channels for me, so that the Discord layout is consistent.
7. As a user, I want running setup again to reuse what already exists, so that I can fix or extend my server without duplicates.
8. As a user, I want to add an existing folder as a KB and have CrelioBot detect its language, layout and task system, so that I don't describe what the folder already says.
9. As a user whose folder isn't a KB yet, I want the setup to offer to turn it into one, so that the KB Researcher has something structured to drill into.
10. As a user, I want a doctor command that checks Node, Bun, Claude Code, the Discord plugin, tokens, intents, permissions and channels, so that I can see what is broken in one place.
11. As a user, I want one launcher that opens every session (Router and each KB) in its own window, so that starting my team is one double-click.
12. As a user, I want a session that crashes or exits to restart on its own without any dialog to click, so that the team stays up while I'm away.
13. As a user, I want a stop launcher that closes every session cleanly, so that I can update or shut down safely.
14. As a user on macOS or Linux, I want an equivalent start script, so that CrelioBot isn't Windows-only.
15. As a user, I want my Instance's data (IDs, tokens, profiles, learnings) kept out of the repo, so that I can pull updates and share improvements without leaking anything.

### Isolation and access

16. As a user with several KBs, I want each KB served by its own session, so that one KB's context and files never leak into another.
17. As a user, I want a KB session to receive only messages from its own category, so that unrelated conversations don't distract or contaminate it.
18. As a user, I want a KB session's tools to refuse to post or act outside its own category, so that a confused or manipulated agent can't spam other KBs.
19. As a server owner, I want everyone in my server to be able to talk to the agents, so that my collaborators can use the team too.
20. As a user, I want to choose per KB between a guarded permission level (commands and files confined to the KB) and full access, so that I trade safety and convenience consciously.
21. As a user, I want agents' links to be posted without link previews, so that a prompt-injected agent can't exfiltrate secrets through Discord's URL unfurling.

### Tasks and the pipeline

22. As a requester, I want to write a request in a KB General and see a Task thread opened for it, so that each piece of work has its own place.
23. As a requester, I want the Manager to reuse an open Task thread when my request continues an existing Task, so that work doesn't get duplicated.
24. As a requester, I want the Manager to create or update the matching ticket in my KB's task system, so that Discord and my task board stay in sync.
25. As a user whose KB has no task system, I want the Manager to ask whether I want one and set it up, so that tasks can be tracked from then on.
26. As a requester, I want the KB Researcher to gather the KB's context, past decisions and learnings first, so that every Specialist starts from what we already know.
27. As a requester, I want the Manager to involve only the Specialists my Task needs, in the Pipeline order, so that simple requests stay fast and complex ones get the full team.
28. As a requester, I want independent Specialists (Web Researcher, Marketing, Lawyer) to work in parallel, so that the research wave doesn't take longer than it must.
29. As a requester, I want each Specialist to post its contribution in the Task thread under its own bot, so that I can see who did what.
30. As a requester, I want agents to @mention each other visibly when they hand off, so that the conversation reads like a team at work.
31. As a requester, I want a Specialist to be able to call another directly (e.g. the Brainstormer asking the Web Researcher to check a fact), so that decisions are informed without a round-trip through me.
32. As a requester, I want the Manager to stop and ask me before a Task exceeds its Hop budget, so that agents can't ping-pong forever and burn my usage.
33. As a requester, I want the Manager to end each Task with a summary of what was done, the decisions made and the results (files, links, screenshots), so that I don't have to read the whole thread.
34. As a requester, I want the Manager to close the Task thread itself once the summary is posted and nobody is waiting on an answer, so that open threads mean open work.
35. As a requester, I want a closed Task thread to reopen when I write in it again, so that follow-ups keep their history.
36. As a user, I want the team to pick up open Task threads after a session restart, so that a crash doesn't lose work in progress.

### Evidence and Escalations

37. As a requester, I want agents to decide on their own when the KB or research gives them Evidence, so that I'm not asked things the team can answer.
38. As a requester, I want an agent lacking Evidence to tag the person most likely to know (by default me) with precise, numbered questions and its recommendation, so that my answer unblocks it quickly.
39. As a requester, I want to answer right under the agent's question and have that agent continue, so that I don't have to address anyone explicitly.
40. As a KB owner, I want answers to Escalations that are durable knowledge written into the KB, so that the same question is never asked twice.
41. As a requester, I want the Brainstormer to always lay out every question it considered, with its recommendation and the Evidence behind it, so that I can see it didn't cut corners even when it decided alone.
42. As a requester, I want the Brainstormer to escalate only the questions it has no Evidence for (taste, priorities, money, brand), so that I spend my time on real decisions.

### Agent channels and Side threads

43. As a user, I want to talk to a Specialist directly in its Agent channel, so that I can work on its part without going through the Manager.
44. As a user, I want a Specialist to open a Side thread for each piece of work in its channel, so that its channel stays readable.
45. As a user, I want to tell a Specialist "this is good" in its Side thread and have it hand the result back to the Manager in the Task thread, so that the Task resumes with my approval recorded.

### Specialists

46. As a requester, I want the Web Researcher to choose a fast, medium or deep search depending on the question, so that small questions are cheap and big ones are thorough.
47. As a requester, I want the Artist to make deliverables beautiful and coherent with the KB's palette, style and conventions, including finishing touches like animation, so that results feel complete.
48. As a requester, I want the UX Expert to check that results are understandable for their audience, so that beauty doesn't cost clarity.
49. As a requester, I want the Marketing agent to cover trends, psychology, positioning and content using research and the KB, so that marketing work is grounded.
50. As a requester, I want the Lawyer to check compliance using up-to-date web sources, so that legal risks are flagged before release.
51. As a requester, I want the Planner to turn everyone's input into an execution plan, so that the Coder (or whoever executes) has a clear path.
52. As a requester, I want the Coder to implement with the KB's own conventions and skills, covering edge cases, in an isolated working copy, so that my main branch isn't broken mid-task.

### Custom agents

53. As a user, I want to ask the Manager to create a new Agent for my KB, so that my team can grow with my needs.
54. As a user, I want the agent creator to interview me briefly (role, when to involve it, model, name) and write the Agent's definition into my KB, so that the Agent is versioned with the KB.
55. As a user, I want an Agent meant for every KB to be stored in my Workspace instead, so that I define it once.
56. As a user, I want the agent creator to guide me through creating the new Agent bot and then create its channel and role automatically, so that the new Agent is usable in minutes.
57. As a user, I want the KB session to restart by itself to load a new Agent, so that I don't have to touch the PC.

### Router

58. As anyone in the server, I want to ask something in the Global General and have it reach the right KB's team, so that I don't have to know where each KB lives.
59. As a user, I want the Router to post the forwarded request visibly in the KB General, so that the KB's history shows where the request came from.
60. As a user, I want to ask the Router what is open across all KBs, so that I get one overview.
61. As a user, I want the Router to restart a stuck KB session on request, so that I can recover remotely.

### Voice

62. As a user, I want my Voice notes transcribed automatically, so that I can talk to the team hands-free.
63. As a user, I want an agent to answer my Voice note with a short Voice note plus the full text, so that I can listen on the go without losing detail.
64. As a user, I want to ask for voice replies explicitly at any time, so that I control when agents speak.

### Memory and Schedules

65. As a KB owner, I want lessons about my domain recorded in my KB with its own learning method, so that my KB stays the single source of truth.
66. As a user, I want lessons about how the agents work together recorded in my Workspace, so that the team improves across all my KBs.
67. As a user, I want the Router to suggest turning a generally useful Team learning into an improvement of the public project, so that my usage improves CrelioBot for everyone.
68. As a user, I want to create a Schedule by asking the Manager in plain language ("every weekday at 8, morning brief"), so that recurring work happens without me.
69. As a user, I want an optional morning brief per KB listing open Task threads, blocked Tasks and what is waiting on me, so that I start the day knowing where things stand.
70. As a user, I want to list and remove Schedules, so that I keep control over what runs.

## Implementation Decisions

Decisions already recorded as ADRs: Agent bots, never webhooks (ADR-0001); inbound through the official Discord plugin, tools in our own MCP server (ADR-0002); one session per KB with the Manager as main thread (ADR-0003); private Workspace and untouched KBs (ADR-0004); no runtime npm dependencies (ADR-0005); permission level per KB (ADR-0006).

### Modules

- **Instance** (deep module). Loads and validates the Workspace: the instance settings (Discord server, owner, Global General, Router), the Agent bot registry (agent → token variable, bot user ID, application ID), the KB profiles and the secrets file. It answers the questions every other module asks: which KBs exist; which Agents a KB has (Core agents, Workspace-wide Custom agents, KB Custom agents); which bot speaks for an Agent in a KB (shared bot unless the profile overrides); and, given a Discord channel or thread, which KB and which role it belongs to (KB General, an Agent's channel, the Global General, or outside the Instance).
- **Session runtime**. A pure function from (Instance, session ID) to everything needed to start that session: working folder, environment, `claude` arguments and the generated files (the official plugin's access file in static mode, a settings file for the permission level, the MCP config). KB sessions start in the KB folder with the Manager as the main agent, a session name of `crelio-<kb>`, and cross-session inbound set to accept. The Router starts in the Workspace with the Router agent.
- **Launcher**. Writes each session's runtime files, opens one console window per session (Windows Terminal tabs if available, otherwise console windows; tmux on macOS/Linux) running a restart loop that regenerates files before each start, optionally pulls the KB's git main branch, and stops on a stop flag.
- **Discord client**. A thin REST client used with one Agent bot token at a time: JSON and multipart requests, retrying on 429 with `retry_after`, Discord error codes surfaced as readable errors, message splitting at 2000 characters on paragraph/code-fence boundaries, and link previews suppressed on everything agents post. Includes a one-off gateway login used to activate a REST-only bot.
- **Crelio MCP server** (one per session, stdio). Exposes the team's tools; every tool checks that its target is inside the session's scope (its KB category, or the Global General for the Router):
  - `post(agent, chat_id, text, files?, reply_to?)` — post as an Agent bot.
  - `speak(agent, chat_id, text)` — Voice note from an Agent bot.
  - `transcribe(chat_id, message_id)` — text of a person's Voice note.
  - `thread_open(agent, chat_id, name, message_id?)`, `thread_close(chat_id)`, `thread_list()`, `thread_history(chat_id, before?)`, `thread_meta(chat_id, patch?)` — Task and Side threads, with a per-session registry holding each thread's kind, Task, Requester, owning Agent, parent Task thread, Hop count and who is waiting on whom.
  - `whereami(chat_id, message_id?)` — the KB, channel role, Agent and thread record for a message, including which Agent wrote the message a person replied to.
  - `react`, `edit` — as an Agent bot.
  - `team_learning(text, agents?)` — append a Team learning to the Workspace.
  - `schedules(list|add|remove)` — the KB profile's Schedules.
  - `provision_agent(agent)` — create a new Agent's channel and role once its bot exists.
  - `restart_session(kb?)` — restart this KB session, or (Router only) another one.
  - Router only: `route(kb, text, author)`, which posts the forwarded request in the KB General and returns where it landed; `instance_status()`.
- **Voice**. Provider interface for speech-to-text and text-to-speech; OpenAI implementation by default (whisper transcription, TTS in Ogg Opus). Voice notes are sent with the voice-message flag, computing duration from the Ogg stream and a 256-point waveform from it; if the provider can't produce Ogg Opus, fall back to an audio attachment.
- **Provisioner**. Idempotently creates the Global General, KB categories, KB Generals, Agent channels and one mentionable role per Agent, with an explicit view permission for the bots (required by Discord from 16 Nov 2026); records IDs in the Workspace.
- **Bot registry tooling**. Adds a bot to the registry from a token entered locally (hidden prompt or secrets file), validates it, reads its user and application IDs, activates it with a one-off gateway login, sets its display name and avatar, and prints its invite link with the CrelioBot permission set.
- **Doctor**. Checks the environment and the Instance end to end and prints actionable fixes.
- **CrelioBot plugin** (loaded into every session with `--plugin-dir`):
  - Agents: Router, Manager and the nine Specialists, each with its model (Opus for Manager, Planner, Coder, Brainstormer; Sonnet otherwise) and a shared team protocol skill preloaded.
  - Skills: team protocol (posting, tagging, threads, Evidence and Escalation, Hop budget, language, learnings); websearch (the owner's public MIT skill, fast/medium/deep mapped to `--fast` / default / `--deep`, without the social agent); grilling (Matt Pocock, MIT) and auto-grill (self-answering with Evidence, escalating the rest); task system (detect, create, adapt the KB's task system through a Task adapter); KB research (navigating kb-wizard KBs, CONTEXT.md/ADR repos, or plain folders); agent creator; voice etiquette.
  - Session-start hook: injects the session's identity (KB, language, channel map, Agent roster with bot user IDs), open Task and Side threads with their last messages, Schedules to re-arm, and recent Team learnings.
  - Guard hooks for the guarded level: Bash commands and attachments confined to the KB folder and the session inbox (generalized from the owner's Prevision setup).
- **Setup agent**. A setup launcher starts Claude Code in the repo with the setup skill, which drives the CLI (bots, KBs, provisioning, doctor) conversationally.

### Interactions

- Inbound: the official plugin delivers every message from the session's channels and their threads (no mention required, anyone in the server), in static access mode. The Manager resolves where it came from (`whereami`) and either takes it as a new request, continues a Task or Side thread, routes it to the Agent of that channel, or routes a reply to the Agent whose question it answers.
- Specialists run as background subagents; the Manager continues a waiting Specialist with the person's answer. After a restart, threads are rebuilt from their history.
- Router to KB: the Router posts the request in the KB General with `route`, then sends the KB session a cross-session message naming the posted message; the KB session treats it as a new request from the original author.
- Schedules fire inside the KB session (session cron), re-armed from the KB profile at every session start.

## Testing Decisions

- Good tests check behaviour at a module's public seam, never internals; Discord and OpenAI are faked at the HTTP level, not mocked inside modules.
- Seams (the fewer the better):
  1. **Session runtime**: Workspace fixture in → exact `claude` arguments, environment and generated files out. Covers Instance resolution, permission levels, scoping of the access file, multi-KB isolation.
  2. **Crelio MCP server as a process**: spawn it over stdio against a local fake Discord/OpenAI HTTP server; drive it with JSON-RPC; assert the HTTP requests made and the tool results. Covers posting, scope refusal, splitting, threads and registry, Voice notes, routing.
  3. **Hooks as processes**: JSON on stdin → decision or context on stdout.
  4. **Ogg parsing**: duration and waveform from real Ogg Opus samples.
- Runner: Node's built-in test runner; no dependencies.
- Live verification: a smoke-test checklist on a throwaway Discord server, run before each release.
- Prior art: the owner's Prevision tool server and guard hooks (same JSON-RPC and hook contracts).

## Out of Scope

- Online presence for REST-only Agent bots (they may appear offline).
- A web dashboard.
- Per-Agent memory.
- Chat platforms other than Discord.
- Building native integrations for every task system — CrelioBot relies on the KB's own task tools and MCP servers through Task adapters.
- Opening pull requests upstream automatically — the Router drafts the proposal; the user submits it.
- Migrating the owner's own KBs (done on his Instance after release).

## Further Notes

- Platform risks to verify before building on them (first ticket): several official-plugin sessions sharing one Manager token; cross-session messaging between channel sessions on Windows; session cron firing while a channel session is idle; a REST-only bot posting and sending a Voice note after one gateway login.
- Channels are a research preview; ADR-0002 keeps the channel-specific surface small so a protocol change costs little.
- Discord: 20 MiB upload limit per file, 2000 characters per message, voice messages can't be edited, private categories need an explicit view permission for bots after 16 Nov 2026.
