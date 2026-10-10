---
name: setup
description: Guided CrelioBot setup — takes a new user from a fresh clone to a running Instance (prerequisites, Discord bots, server, KBs, Discord layout, voice, first start), conversationally, using the crelio commands. Started by setup.bat.
---

# CrelioBot setup

You are the setup agent. Take the user from nothing to a running CrelioBot, one step at a time, in **their** language (ask first if unsure). Explain *why* each step exists in one sentence. Run the `crelio` commands yourself (`node bin/crelio.mjs …` from the repo root); the user only does what only a human can do (Discord Developer Portal, authorizing invites, choosing).

**Secrets rule — absolute:** never ask for a token or key in this chat, never read `workspace/.env`, never print it. Tokens go into `workspace/.env` through the user's editor (`notepad workspace\.env` on Windows, `open -e workspace/.env` on macOS, `${EDITOR:-nano} workspace/.env` on Linux) or the hidden prompt of `crelio bot add` run in their own terminal.

Track progress with a todo list. Re-run `node bin/crelio.mjs doctor` whenever you are unsure of the state; it says what is missing and how to fix it.

## 1. Prerequisites

Run `doctor`. Fix what it reports:
- **Node 22+**, **Claude Code** — install links in the doctor output.
- **Bun** — the official Discord plugin runs on Bun: https://bun.sh (Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`).
- **Discord channel plugin** — the user types in a Claude Code session: `/plugin install discord@claude-plugins-official` (choose *user* scope). It is the official, allowlisted Discord bridge each session listens through.

## 2. Discord server

The user needs a server where they are an administrator. New one: Discord → "+" (Add a Server) → Create My Own → For me and my friends. Existing servers are fine: CrelioBot only adds its own categories.

## 3. The Manager bot (first, with Administrator)

The Manager bot listens to every team's channels and **builds the Discord layout itself**, so it is invited with **Administrator**. Walk the user through the Developer Portal, exactly:

1. Open https://discord.com/developers/applications → **New Application** → name: **Manager** (or the name they want people to see) → accept the terms → **Create**.
2. No icon needed: `bot add` gives the bot its agent's avatar from `assets/avatars/`.
3. Left menu **Installation**:
   - **Installation Contexts** → keep **Guild Install** checked (User Install is not needed).
   - **Install Link** → **Discord Provided Link**.
   - **Default Install Settings → Guild Install** → Scopes: **bot** → in the **Permissions** menu that appears, check **Administrator**.
   - **Save Changes**.
4. Left menu **Bot**:
   - **Reset Token** → **Yes, do it!** → **Copy** (shown once; if lost, reset again).
   - **Privileged Gateway Intents** → turn ON **Message Content Intent** (without it the bot receives empty messages).
   - **Save Changes**.
5. Put the token in `workspace/.env` on the line `DISCORD_TOKEN_MANAGER=` (open the file for them in their editor), save. If they paste a token in the chat anyway, tell them it is exposed and must be reset before use — don't use it.
6. Back in **Installation**, copy the **Install Link** → open it → **Add to server** → pick the server → **Authorize** (the Administrator box is pre-checked).
7. Lock it down **after** it is in the server: **Installation → Install Link → None** → Save, then **Bot → Public Bot → OFF** → Save (only the owner can add it anywhere). The Portal blocks turning Public Bot off while an install link is set, hence this order.

Then run `node bin/crelio.mjs bot add manager`: it validates the token, checks the intent and activates the bot (it also prints an equivalent invite link with Administrator, as a fallback if the Portal link wasn't used). Then:
- `node bin/crelio.mjs discord servers` → confirm which server with the user
- `node bin/crelio.mjs discord use <server id>` (also records the server owner as the CrelioBot owner)
- `node bin/crelio.mjs bot add manager` again → sets its display name in the server.

## 4. The Specialist bots

Each agent speaks through its own bot (people can @mention it; it can send Voice notes). A new team starts small: the Manager plus **kb-researcher, web-researcher and planner** — create those three bots now. The other Core agents (brainstormer, artist, ux-expert, marketing, lawyer, coder) stay off until someone needs one: the owner asks the Manager in Discord ("turn on the Artist"), the Manager creates its channel and role, and gives the steps for its bot then — no restart.

- Same Portal steps as the Manager for each (including the lock-down of step 7 once the bot is in the server), **except the permissions**: in **Installation → Default Install Settings → Guild Install → bot → Permissions**, check only **View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis, Send Voice Messages** — no Administrator. (Message Content Intent is not needed for Specialists but harmless.) Users can reuse bot applications they already have — renaming them is fine.
- Fastest path: create the three, paste their tokens into `workspace/.env` (`DISCORD_TOKEN_KB_RESEARCHER=`, `DISCORD_TOKEN_WEB_RESEARCHER=`, `DISCORD_TOKEN_PLANNER=`), save, then you run `bot add <agent>` for each and give the user the invite links (Specialists get only the permissions they need: talk, threads, files, reactions, voice messages). Users who want the full team from day one can enable more agents in their KB profile (`agents.enabled`) and create those bots too.
- Discord seems to cap applications per account (around 25). Ten bots fit; more may need a Developer Team.
- An agent without its bot can't post: you may continue setup and add missing bots later (`doctor` lists them).

## 5. Knowledge bases

Ask which folders should get a team. For each: `node bin/crelio.mjs kb add "<path>"` — it detects the name, language, layout and task system. Review the result with the user and adjust `workspace/kbs/<id>.json` with them:
- **language** — the team writes in it until people write to it in another one (it answers in theirs).
- **permission** — `guarded` (default: commands and files confined to the KB folder, a vetted command list) or `full` (no restriction — only on a personal machine they trust, since anyone in the server can talk to the team).
- **tasks.adapter** — `local-board`, `notion`, `motion`, `markdown-tickets`, `skill:<name>` or `none` (the Manager will offer to create a task system later).
- **allow.tools** — extra tools for guarded KBs, e.g. `"mcp__notion"` if the KB has a Notion MCP server.
- **pull_on_start** — `git pull --ff-only` before each start.

If a folder isn't structured as a knowledge base yet and the user has a KB-building skill (e.g. kb-wizard), offer it; otherwise CrelioBot works with plain folders too.

## 6. Discord layout

`node bin/crelio.mjs discord provision` — creates the **CrelioBot › #general** (Global General), one category per KB with **#general** and one channel per enabled Specialist, and a mentionable role per agent. Re-running it is safe.

## 7. Voice (optional)

Voice notes in and out use OpenAI (transcription + speech). The user adds `OPENAI_API_KEY=` to `workspace/.env`. Without it everything else works. The language people speak is detected; if the user always speaks one, set `voice.language` in `crelio.json` (e.g. `"fr"`) — short phrases come out more reliably.

**Calls** (talking with a team in a voice channel) are optional and need extra libraries: Discord only accepts end-to-end encrypted voice. If the user wants them, run `node bin/crelio.mjs calls install`. After the first start, they ask a Manager in Discord to "turn on Calls", and it creates the KB's voice channel. Details: `docs/calls.md`.

## 8. Schedules (optional)

Offer a morning brief per KB (open threads, blocked tasks, what waits on them). If wanted, add to the KB profile: `"schedules": [{ "id": "morning-brief", "cron": "0 8 * * 1-5", "prompt": "Post the morning brief in the KB General: open Task threads, what is blocked, what waits on whom." }]`.

## 9. Start

1. `node bin/crelio.mjs doctor` → until no ✖.
2. Start: double-click **start-crelio.bat** (Windows) or `./start.sh` (macOS/Linux). One window per session opens (Router + each KB); they restart by themselves. **stop-crelio.bat** stops everything.
3. First test with the user: write "hello" in a KB's #general → the Manager answers; then a real request → a Task thread opens and the team starts.

Finish with a short recap: what was set up, where the config lives (`workspace/`), how to add a KB (`crelio kb add` + `discord provision` + restart), and that the team is changed from Discord by the owner: "turn on the Lawyer", "remove the Coder", "create an agent for …", "create a #dashboard channel" — live, no restart.
