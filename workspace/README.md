# workspace/

Your Instance's private data. Everything here except this file is git-ignored (see ADR-0004).

| Path | What it holds |
|---|---|
| `crelio.json` | Discord server, Global General, Router, Agent bots, voice settings |
| `kbs/<id>.json` | One KB profile per knowledge base (path, language, permission level, task adapter, channels, schedules) |
| `.env` | Bot tokens and API keys |
| `plugin/` | Custom agents shared by every KB (optional) |
| `learnings/` | Team learnings — how the agents work together |
| `state/<session>/` | Generated per-session files, logs and thread registry (safe to delete while stopped) |

Run `setup.bat` (or `node bin/crelio.mjs setup`) to create it.
