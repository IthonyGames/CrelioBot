# Calls — talk with a team in a voice channel

Join your KB's voice channel and talk. The team's Manager bot joins you, listens, puts the team to work and answers out loud.

- **You join** → the bot joins within seconds and greets you.
- **You talk** → each thing you say is transcribed, shown in the voice channel's chat and handed to the KB session, which answers out loud. Real work gets a Task thread, as usual, so the results stay readable. Only speech is sent: silence, breathing, a keyboard or a fan never reach the team.
- **You leave while it works** → the bot stays in the channel and the team keeps working. When you come back, it gives you a short spoken update.
- **You go to another team's call** → the bot follows you there and talks for that team. The first Call stays open: its team keeps working, and when you come back to its channel the bot follows you back and gives you that team's update.
- **"That's all for tonight"** → it says goodbye and leaves when you leave. Otherwise it stays until nobody has been there for 2 hours.
- **Interrupt it** → start talking and it stops speaking. A cough or a noise doesn't count.

## Set up (once)

1. **An OpenAI key** for speech: `OPENAI_API_KEY=…` in `workspace/.env` (the same key as voice notes).
2. **Install the Call service** on the PC, in the CrelioBot folder:
   ```
   node bin/crelio.mjs calls install
   ```
   It installs `discord.js`, `@discordjs/voice` and `@snazzah/davey` into `calls/`, plus `opusscript` and `@echogarden/fvad-wasm` to tell speech from noise. Discord requires end-to-end encrypted voice, and that takes native code the rest of CrelioBot does without ([ADR-0007](adr/0007-calls-are-an-optional-service-with-dependencies.md)). After updating CrelioBot, run it again: it installs what a new version needs.
3. **Restart CrelioBot** (`stop-crelio.bat`, then `start-crelio.bat`). A "CrelioBot - Calls" window joins the others.
4. **Turn Calls on for a team**: in its `#general`, ask the Manager, for example "active le mode appel". It creates the voice channel (**Appel** or **Call**) in the KB's category. To turn them off, ask again.

`node bin/crelio.mjs calls status` shows whether the service runs and which teams have Calls on.

## Good to know

- **One voice channel at a time per bot.** That is Discord's rule: a bot is in one voice channel per server. With the shared Manager bot, the bot goes where the people are. If someone is still in the first Call when you join another team's channel, the bot says it is busy there and comes over once that Call is empty. To have two Calls live at the same time, give one team its own Manager bot.
- **The language you speak** is detected. If you always speak the same one, set it in `crelio.json` → `voice.language` (e.g. `"fr"`): short phrases are transcribed more reliably. A team writing in English still answers you out loud in French.
- **Anyone in the server can talk** in a voice channel. Team changes asked by voice (e.g. "turn on the Artist") count only when the **owner** says them. The tools check who spoke.
- **The voice channel's chat** keeps the Call's transcript: 🎙️ for what people said, 🔊 for what the bot said. You can also type there during a Call.
- **Names**: transcription is given the names of your KBs and agents so it spells them right. Add others in the KB profile: `"call": { "vocabulary": ["Quillz", "Motion"] }`.
- **Tuning** (KB profile, `call`):

  | Setting | Default | What it does |
  |---|---|---|
  | `silence_ms` | 800 | Silence that ends a phrase |
  | `merge_ms` | 700 | A pause shorter than this keeps your sentence in one piece |
  | `min_speech_ms` | 200 | Speech a phrase needs; anything with less is treated as noise |
  | `barge_ms` | 300 | Speech that interrupts the bot |
  | `idle_minutes` | 120 | Leave an empty Call after this long |
  | `transcript` | true | Post the transcript in the voice channel's chat |
  | `vad` | | Speech detection: `mode` (WebRTC aggressiveness 0–3, default 2), `min_db` (-50: quieter is never speech), `voicing` (0.55: how voice-like a sound must be) |

  The Call service log (`workspace/state/calls/service.log`) shows, for each thing you said, how much audio arrived and how much was speech: the place to look when a quiet voice gets ignored (lower `voicing` or `min_db`) or noise still gets through (raise them).

- **Voice**: the bot speaks with the voice notes' settings (`crelio.json` → `voice`: `tts_model`, `voice`, `speed`).
- **Privacy**: what you say is sent to OpenAI for transcription, like voice notes; speech detection runs on the PC, and audio without speech is never sent. The audio is not stored; the transcript is kept in `workspace/state/<kb>/call/utterances.jsonl` and in the voice channel's chat.

## When something is off

- **The bot doesn't join**: is the "CrelioBot - Calls" window open? `calls status`, then `workspace/state/calls/service.log`.
- **It joins but doesn't answer**: the KB session may be restarting. The bot says so in the voice channel's chat. Talk again in a minute.
- **"Busy in another call"**: someone is still in another KB's Call with the same bot.
