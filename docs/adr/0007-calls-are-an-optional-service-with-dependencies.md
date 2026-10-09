# Calls run in an optional service with its own dependencies, and reach sessions through their inbox

People can talk with a KB team in the KB's Discord voice channel: a Call. Two constraints shaped how.

**Voice needs native code.** Since 1 March 2026 Discord accepts only end-to-end encrypted voice: the DAVE protocol, which uses MLS key exchange and per-frame encryption. A connection without it is closed with code 4017. Writing DAVE and the voice gateway with Node built-ins is not a reasonable project. So Calls live in `calls/`, a separate package installed on demand (`crelio calls install`). It uses `discord.js` for the gateway, `@discordjs/voice` for the voice connection and `@snazzah/davey` for DAVE (native, with prebuilt binaries). The core stays dependency-free (ADR-0005). It holds all the Call logic: who is in a Call, joining and leaving, utterances, speech, and the session tools. The service is a thin adapter, so the logic is tested without the libraries. Received audio is never decoded: the Opus packets are wrapped into an Ogg file (`oggFromOpus`) and sent to the transcription API. Speech comes back as Ogg Opus and is played as is, so no Opus library and no ffmpeg are needed.

**A session must be woken by what people say.** The official Discord plugin only delivers text messages written by people (ADR-0002), and a custom channel still needs a confirmation dialog at every launch. Claude Code now documents each session's *inbox*: a local socket or named pipe whose address and token it exports to hooks. The plugin's SessionStart hook records them in `state/<kb>/inbox.json`. The Call service posts each utterance there, authenticated with the session's own token, and an idle session starts a turn with it. The session answers through MCP tools (`call_say`, `call_end`, `call_status`), which call the service's local HTTP control server.

## Considered options

- **The Monitor tool, or a background command the session keeps re-arming.** This needs the model to arm and re-arm a watcher; Monitor expires after 30 minutes at most, and each expiry costs a turn. The inbox needs nothing from the model.
- **A custom channel server.** It shows the development-channels dialog at every launch, so an unattended restart would block (ADR-0002).
- **A speech-to-speech model (OpenAI Realtime) as the voice of the team.** It is faster, but a second brain that doesn't know the KB or the team. The KB session stays the one that answers.

## Consequences

- Calls are opt-in per KB (`call.enabled`, set by `call_setup`) and need an OpenAI key. The launcher opens a "CrelioBot - Calls" window only when the service is installed.
- One bot can be in one voice channel per server. With one shared Manager bot, one Call is live at a time; another KB's Call waits until the first one has nobody in it. A KB that gives its team its own Manager bot gets its own Calls.
- Receiving audio is not an officially supported bot feature, and DAVE key changes can drop audio for a moment (discord.js issue #11441). The service rejoins after disconnections, and people can always type in the voice channel's chat.
- The inbox token sits in the Workspace state folder, which is already off-limits to agents in guarded sessions.
