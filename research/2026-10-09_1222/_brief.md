# Personal AI agent bots (Muse, Grok Bot, OpenAI Dots, OpenClaw, Hermes) — what to copy into CrelioBot
**Mode:** default + SOCIAL  |  **Agents:** 4  |  **Sources:** ~85 unique  |  **Pages fetched:** ~12 + 7 Reddit threads  |  **Date:** 2026-10-09

## TL;DR
The three names you gave are **cloud products launched in the last 2 months**: **Meta Muse** (personal agent in a cloud VM, Goals + Ideas tabs, approval gates, 2026-09-08), **xAI Grok Bot** (persistent bots with their own computer/browser/memory that coordinate with each other, beta since 2026-08), and **OpenAI Dots** (always-on agents with their own identity/tools, a primary Dot + planned "specialist Dots", DevDay 2026-09-29). None run on your PC. The self-hosted equivalents are **OpenClaw** (gateway hub + 20 channels + ClawHub skills, unstable updates, big security history) and **Hermes Agent** (single gateway, self-written skills, memory layers, cron, more reliable). **Nobody ships a Claude-Code-based multi-persona Discord team with per-task threads** — that gap is CrelioBot's niche.

## Key Findings

### Consensus (all agents agree)
- The winning architecture is **one gateway/hub process** owning the chat connections, with sessions/agents behind it (OpenClaw Gateway `ws://127.0.0.1:18789`, Hermes single gateway) [1][6][3].
- Common feature set: **skills as SKILL.md folders**, **file-based memory** (MEMORY.md/USER.md), **cron / proactive work**, **voice memo transcription**, **pairing + allowlist** for unknown senders, **approval gates** for sensitive actions [1][6][11][23].
- **Biggest pains in the field:** updates breaking the bot (OpenClaw), memory rot / context bloat, setup complexity, cost blow-ups, and agent-to-agent loops [S1][S2][S5][8].
- **Security:** prompt injection through chat content, exposed gateways, malicious marketplace skills, memory-file poisoning, and **link-preview exfiltration** (agent posts a URL with secrets → Discord fetches it) [ana-3][ana-4].

### Nuances
- **Multi-agent in Discord:** OpenClaw's pattern is *one bot token per agent + one channel per agent* [syn-12][syn-13]. First-hand reports are mixed: "tag each other back and forth" works for one user; others called it "token evaporation" and "very clunky, removed it" [S5]. → CrelioBot must make inter-agent handoffs **orchestrated (hub-and-spoke) with a hop budget**, not a free mesh.
- **Hermes vs OpenClaw:** Hermes = reliability + learning loop ("bake it into a skill or script"); OpenClaw = breadth + personality. People port Hermes' memory/self-skill ideas into their setups [S2][S3].
- **Per-role isolation works:** "Separate containers per role… each = its own scrum team with focused context" [S4] — matches "one Claude Code session per KB".

### Debates
- **Subscription vs API key:** Anthropic cut subscription access for third-party harnesses (OpenClaw) on 2026-04-04 and forbids claude.ai login in third-party products built on the Agent SDK [ana-2][cc-agent-sdk]. **Running the official `claude` CLI with a channel is the supported subscription path** — so CrelioBot drives the real CLI, never re-implements it.
- **Channels are a research preview:** custom channels need `--dangerously-load-development-channels` (one confirmation at launch); syntax may change → isolate the channel layer behind one adapter file [ana-1][cc-channels].

## Deep Dives
- **OpenClaw README** (github.com/openclaw/openclaw): Gateway control plane; CLI/TUI/web UI clients; plugin SDK; pairing `openclaw pairing approve <channel> <code>`; tools run on host unless sandbox configured. [1]
- **Hermes Agent README** (github.com/NousResearch/hermes-agent): single gateway for Telegram/Discord/Slack/WhatsApp/Signal/Email; agent-curated memory + FTS5 session search; creates skills after complex tasks; NL cron; subagents; native Windows install. [6]
- **TechCrunch on Dots:** always-on agents with own identity/credentials/tools; primary Dot + specialist Dots planned; Slack/Teams channels. [23]
- **CSA note on OpenClaw prompt injection:** link-preview exfiltration, memory poisoning, malicious skills; tiered mitigations. [ana-3]
- **zebbern/claude-code-discord** (Agent SDK, MIT): thread per session, Allow/Deny buttons for tools, RBAC on shell/git, `.env` + docker compose install. [syn-5]
- **fitz123/claude-code-bot** (archived): config bindings channel→agent, debounce 3s, layered config (`config.yaml` + gitignored `config.local.yaml`), validate before restart, "NO_REPLY" cron convention. [syn-7]

## From the field (SOCIAL)
> "I've switched from OpenClaw three days ago, having been tired of the constant flow of updates that kept making everything worse and worse." — r/openclaw, score 200, ~2026-05-03 [S1]

> "OC might know more about me, but Hermes gets shit done reliably. If it forgets anything, I'll ask it to make sure to remember/bake it into a skill or script." — r/openclaw, 2026-05 [S1]

> "Had a lot of trouble getting my agents to mention eachother in discord. Was very clunky and removed it." — r/OpenClawUseCases, ~2026-05-01 [S5]

> "The circuit breaker is real — I accidentally made a loop on day one and it stopped itself instead of draining my API credits." — r/OpenClawUseCases [S5]

> "Memory management turned out to be the hardest part — harder than model selection, harder than tool configuration." — 5-agent marketing team, 3 months [S6]

- **What people do:** pin versions + snapshots; per-role containers; route simple work to cheaper models; circuit breakers on loops; tiered memory with weekly compaction; turn repeated fixes into skills.
- **Temperature:** reliability and memory are the dominant complaints — not missing features.

## What CrelioBot should copy (decision input)
| Copy | From | CrelioBot form |
|---|---|---|
| Single hub owning Discord | OpenClaw/Hermes | `crelio-hub` (one bot token, webhooks per persona) |
| Pairing + allowlist, owner-only tool approval | OpenClaw, CC channels | `access` in config; permission relay only to owner DMs |
| Skills as SKILL.md, agent writes new skills from repeated work | Hermes | KB learnings protocol + "build the system" rule (already in your KBs) |
| Hop budget / circuit breaker on agent loops | field reports | hub counts hops per thread; Manager asks to continue |
| Cheap model for routing/research, strong for build | field reports | per-agent `model` in agent files |
| Goals / proactive briefings | Muse, Dots | optional scheduled routines per KB (later phase) |
| Doctor + setup wizard + layered config | OpenClaw, fitz123 | `crelio setup`, `crelio doctor`, `workspace/config.json` gitignored |
| Pin & don't self-update | field reports | hub never auto-updates; versioned releases |
| Suppress link previews in agent posts | CSA | hub wraps URLs or sets SUPPRESS_EMBEDS on agent messages |

## All Sources
[1] [P] OpenClaw README — https://github.com/openclaw/openclaw
[2] [B] OpenClaw overview — https://agentic-ai.readthedocs.io/en/latest/AgentPlatforms/openclaw/
[3] [P] OpenClaw vs Hermes (official docs) — https://docs.openclaw.ai/start/why-openclaw/openclaw-and-hermes-agent.md
[6] [P] Hermes Agent README — https://github.com/NousResearch/hermes-agent
[11] [E] Meta Muse launch — https://www.iclarified.com/102030/meta-launches-muse-a-personal-ai-agent-that-handles-everyday-tasks
[12] [E] Muse on WhatsApp — https://runtimewire.com/article/meta-muse-personal-ai-agent-whatsapp-apps-launch
[16] [E] Muse Spark 1.1 — https://datanorth.ai/news/meta-releases-muse-spark-1-1-agentic-ai-model
[18] [B] Grok Bot + Grok 4.6 — https://www.dplooy.com/blog/grok-bot-and-grok-46-cloud-agents-api-and-pricing
[19] [B] Grok Bot (ES) — https://ecosistemastartup.com/grok-bot-de-x-ai-agentes-de-ia-con-computadora-propia-para-tu-startup-en-2026/
[23] [E] OpenAI Dots — https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/
[24] [E] Dots — https://www.aljazeera.com/economy/2026/9/30/openai-launches-dots-personal-ai-assistant-built-to-handle-everything
[syn-1] [B] OpenClaw vs Hermes — https://composio.dev/blog/openclaw-vs-hermes-agent
[syn-5] [C] zebbern/claude-code-discord — https://github.com/zebbern/claude-code-discord
[syn-7] [C] fitz123/claude-code-bot — https://github.com/fitz123/claude-code-bot
[syn-9] [C] Discord plugin one-session limit — https://claudeissues.com/issue/56109-feature-discord-plugin-support-multiple-bot-tokens-per-machine-for-multi-session
[syn-12] [B] OpenClaw multi-agent masterclass — https://tenten.co/openclaw/en/docs/masterclass/module-08-multi-agent
[syn-13] [B] OpenClaw multi-agent guide — https://www.stack-junkie.com/blog/openclaw-multi-agent-setup-guide
[ana-1][cc-channels] [P] Claude Code channels — https://code.claude.com/docs/en/channels
[ana-2] [E] Anthropic cuts OpenClaw from subscriptions — https://www.implicator.ai/anthropic-cuts-openclaw-from-claude-subscriptions-citing-unsustainable-compute-costs/
[ana-3] [P] CSA research note — https://labs.cloudsecurityalliance.org/research/csa-research-note-openclaw-indirect-prompt-injection/
[ana-4] [E] OpenClaw security risks — https://www.techradar.com/pro/here-are-the-openclaw-security-risks-you-should-know-about
[8] [B] Multi-agent production challenges — https://www.zenml.io/llmops-database/production-deployment-challenges-and-infrastructure-gaps-for-multi-agent-ai-systems
[cc-agent-sdk] [P] Agent SDK overview — https://code.claude.com/docs/en/agent-sdk/overview
[S1] [F] r/openclaw, 200, ~2026-05-03 — https://www.reddit.com/r/openclaw/comments/1t2m2uu/yet_another_openclaw_vs_hermes_experience_sharing/
[S2] [F] r/openclaw, 49, 2026-09-17 — https://www.reddit.com/r/openclaw/comments/1wlqz67/hermes_vs_openclaw_is_there_actually_a_meaningful/
[S3] [F] r/hermesagent, 40, 2026-09-24 — https://www.reddit.com/r/hermesagent/comments/1wp07pi/someone_tell_me_how_hermes_is_better_than_openclaw/
[S4] [F] r/hermesagent, 79, ~2026-04-21 — https://www.reddit.com/r/hermesagent/comments/1srhsmd/from_openclaw_frustration_to_hermes_breakthrough/
[S5] [F] r/OpenClawUseCases, 29, ~2026-05-01 — https://www.reddit.com/r/OpenClawUseCases/comments/1t0swl4/tried_every_major_multiagent_solution_for/
[S6] [F] memory-kernel discussion — https://github.com/mainion-ai/memory-kernel/discussions/41
[S7] [F] r/ClaudeAI channels launch, 362, 2026-03-20 — https://www.reddit.com/r/ClaudeAI/comments/1ryh3da/new_in_claude_code_telegram_and_discord_remote/

Credibility: [P] primary/official  [E] established media  [C] community/forum  [B] blog/unknown  [F] first-person account

## Gaps & Low Confidence
- "Muse" → Meta Muse is medium-high confidence; Muse/Grok Bot/Dots details are from press, not vendor docs.
- No first-hand Windows reports for any of these bots.
- OpenClaw multi-agent routing internals (docs.openclaw.ai/concepts/architecture) not fetched.
- Cost figures ($80–300/day) are second-hand.

## Follow-ups
- Read OpenClaw's `voice-message.ts` when implementing Discord voice bubbles (production upload flow).
- Revisit Hermes' self-written-skills loop when designing the auto-learning phase.
