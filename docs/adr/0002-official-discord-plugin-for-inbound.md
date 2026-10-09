# Inbound messages come through the official Discord channel plugin; our tools live in a plain MCP server

Each session receives Discord messages through `plugin:discord@claude-plugins-official`, scoped to its KB category by a generated `access.json`, and does everything else (post as an Agent bot, threads, Voice notes, schedules, team learnings) through CrelioBot's own MCP server. We first designed a single "hub" process with a custom channel server, and a spike proved it works — but during the channels research preview a custom channel only loads with `--dangerously-load-development-channels`, which shows a confirmation dialog at **every** launch, so an automatic restart after a crash would sit blocked until someone clicked. Only Team/Enterprise admins can allowlist a custom channel. The official plugin is allowlisted, already used by the owner, and needs no dialog.

## Consequences

- The official plugin drops messages written by bots, so Agents never talk to each other through Discord. They talk inside their KB session (the Manager and Specialists call each other as subagents) and only *show* the conversation in Discord.
- The Router reaches KB sessions with Claude Code's native cross-session messaging, not through Discord.
- Schedules fire inside each KB session (session-scoped cron, re-armed at every session start), because nothing outside a session can push into it.
- One Manager token is used by several plugin instances at once (one gateway connection per session). If that ever misbehaves, a KB profile can give its session a dedicated Manager token.
- If Anthropic opens custom-channel allowlisting to individual users, the hub design can return; the MCP tool layer is unchanged by that switch.
- *2026-10-09:* sessions no longer run the plugin in static access mode. The plugin re-reads `access.json` on every message, so a Team change (a new Agent channel, a channel the owner had created) is heard without a restart. With an allowlist DM policy and no pairing, the plugin never writes the file itself.
