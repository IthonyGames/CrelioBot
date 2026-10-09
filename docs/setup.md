# Manual setup

The setup agent (`setup.bat` / `./setup.sh`) does all of this with you. This page is the same path by hand.

Commands below are run from the CrelioBot folder: `node bin/crelio.mjs …` (shortened to `crelio …`).

## 1. Prerequisites

- Node 22+, [Bun](https://bun.sh), [Claude Code](https://code.claude.com/docs/en/quickstart) (signed in)
- In a Claude Code session: `/plugin install discord@claude-plugins-official` (user scope)
- `crelio setup` once (or copy `templates/workspace/` to `workspace/` and `env.example` to `workspace/.env`)

## 2. The Manager bot

1. https://discord.com/developers/applications → **New Application** → "Manager" → Create.
2. **Installation** → Install Link: **Discord Provided Link** → Default Install Settings → **Guild Install** → scopes **bot** → Permissions **Administrator** → Save Changes.
3. **Bot** → **Reset Token** → copy; **Message Content Intent** ON; **Public Bot** OFF → Save Changes.
4. Put the token in `workspace/.env`: `DISCORD_TOKEN_MANAGER=…`
5. **Installation** → open the Install Link → Add to server → Authorize.
6. `crelio bot add manager` → `crelio discord servers` → `crelio discord use <server id>` → `crelio bot add manager` (sets its display name).

## 3. Specialist bots

For each of `kb-researcher web-researcher brainstormer artist ux-expert marketing lawyer planner coder`: same steps, but in **Installation → Guild Install → bot → Permissions** check only View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis, Send Voice Messages. Token in `workspace/.env` as `DISCORD_TOKEN_<AGENT_IN_CAPS>` (dashes → underscores), then `crelio bot add <agent>`.

## 4. Knowledge bases

`crelio kb add "<folder>"` for each, then review `workspace/kbs/<id>.json`: `language`, `permission` (`guarded` or `full`), `tasks.adapter`, `allow.tools`, `pull_on_start`.

## 5. Discord layout

`crelio discord provision` — Global General, one category per KB, its #general and Agent channels, one role per agent. Safe to re-run.

## 6. Optional

- Voice: `OPENAI_API_KEY=…` in `workspace/.env`.
- Morning brief: in a KB profile, `"schedules": [{ "id": "morning-brief", "cron": "0 8 * * 1-5", "prompt": "Post the morning brief in the KB General: open Task threads, what is blocked, what waits on whom." }]`.

## 7. Start

`crelio doctor` until there is no ✖, then `start-crelio.bat` / `./start.sh`.

## Adding things later

- **A KB**: `crelio kb add`, `crelio discord provision --kb <id>`, then restart (stop + start, or `crelio start --only <id>`).
- **An agent**: ask the Manager ("create an agent for …") — or the Router in the Global General for an agent on every team.
- **A bot token changed**: update `workspace/.env`, `crelio bot add <agent>`, restart.
