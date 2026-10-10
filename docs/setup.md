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
3. **Bot** → **Reset Token** → copy; **Message Content Intent** ON → Save Changes.
4. Put the token in `workspace/.env`: `DISCORD_TOKEN_MANAGER=…` (never paste a token in a chat — if you did, reset it).
5. **Installation** → open the Install Link → Add to server → Authorize.
6. Lock it down: **Installation → Install Link → None** → Save, then **Bot → Public Bot OFF** → Save (the Portal only allows Public Bot off once no install link is set).
7. `crelio bot add manager` → `crelio discord servers` → `crelio discord use <server id>` → `crelio bot add manager` (sets its display name).

## 3. Specialist bots

A new team starts with the Manager plus `kb-researcher web-researcher planner`; the other Core agents (`brainstormer artist ux-expert marketing lawyer coder`) are turned on later from Discord. For each bot you create: same steps, but in **Installation → Guild Install → bot → Permissions** check only View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis, Send Voice Messages. Token in `workspace/.env` as `DISCORD_TOKEN_<AGENT_IN_CAPS>` (dashes → underscores), then `crelio bot add <agent>`.

## 4. Knowledge bases

`crelio kb add "<folder>"` for each, then review `workspace/kbs/<id>.json`: `language`, `permission` (`guarded` or `full`), `tasks.adapter`, `allow.tools`, `pull_on_start`.

## 5. Discord layout

`crelio discord provision` — the Global General (`𝐂𝐫𝐞𝐥𝐢𝐨𝐁𝐨𝐭`, on top), one category per KB (`𝙌𝙐𝙄𝙇𝙇𝙕`) with its KB General (`💭𝘔𝘦𝘴𝘴𝘢𝘨𝘦`), then a `<KB> agents` category per KB with its Agent channels, and one role per agent in the agent's color. Safe to re-run: it never renames or moves what exists, so restyle your server freely. `"discord_fonts": false` in `crelio.json` keeps plain letters.

## 6. Optional

- Voice: `OPENAI_API_KEY=…` in `workspace/.env`. Optional: `voice.language` in `crelio.json` (e.g. `"fr"`) when you always speak the same language; otherwise it is detected.
- Calls (voice channels): `crelio calls install`, restart, then ask a Manager "turn on Calls". See [calls.md](calls.md).
- Avatars: each bot gets its agent's avatar when you register it; for bots registered before, `crelio bot avatars` ([logo and avatars](agent-avatars.md)).
- Morning brief: in a KB profile, `"schedules": [{ "id": "morning-brief", "cron": "0 8 * * 1-5", "prompt": "Post the morning brief in the KB General: open Task threads, what is blocked, what waits on whom." }]`.

## 7. Start

`crelio doctor` until there is no ✖, then `start-crelio.bat` / `./start.sh`.

## Changing the team from Discord

The owner (the server owner, plus anyone listed in `crelio.json` → `admins`) changes a team by asking its Manager — or the Router in the Global General, naming the KB. Changes apply live: no restart.

| Ask | What happens |
|---|---|
| "Turn on the Artist" | `agent_enable`: the agent joins the team, its channel and role are created, the session hears the channel at once. If it has no bot yet, the Manager gives you the Developer Portal steps. |
| "Remove the Coder" | `agent_disable`: off the team; its channel and role in that KB are deleted (say "keep the channel" to keep them). The bot stays — other teams may use it. |
| "Create an agent for video editing" | The agent creator interviews you, writes the agent, creates its channel and role. |
| "Create a #dashboard channel" / a voice channel / a role | `discord_admin`, inside that KB's category. |
| "The token is in .env" | `bot_register`: checks the token, activates the bot, sets its name, gives you the invite link if it isn't in the server yet. |

The tools check that the approval is a recent message of yours. Tokens never go through Discord. Put them in `workspace/.env` on the PC.

## Adding things later

- **A KB**: `crelio kb add`, `crelio discord provision --kb <id>`, then restart (stop + start, or `crelio start --only <id>`).
- **An agent**: ask the Manager ("create an agent for …") — or the Router in the Global General for an agent on every team.
- **A bot token changed**: update `workspace/.env`, then ask the Manager to register it (or `crelio bot add <agent>`).
