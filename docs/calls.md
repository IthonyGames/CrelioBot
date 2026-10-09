# Calls — talk with a team in a voice channel

Join your KB's voice channel and talk. The team's Manager bot joins you, listens, puts the team to work and answers out loud.

- **You join** → the bot joins within seconds and greets you.
- **You talk** → each thing you say is transcribed, shown in the voice channel's chat and handed to the KB session, which answers out loud. Real work gets a Task thread, as usual, so the results stay readable.
- **You leave while it works** → the bot stays in the channel and the team keeps working. When you come back, it gives you a short spoken update.
- **"That's all for tonight"** → it says goodbye and leaves when you leave. Otherwise it stays until nobody has been there for 2 hours.
- **Interrupt it** → start talking and it stops speaking.

## Set up (once)

1. **An OpenAI key** for speech: `OPENAI_API_KEY=…` in `workspace/.env` (the same key as voice notes).
2. **Install the Call service** on the PC, in the CrelioBot folder:
   ```
   node bin/crelio.mjs calls install
   ```
   It installs `discord.js`, `@discordjs/voice` and `@snazzah/davey` into `calls/`. Discord requires end-to-end encrypted voice, and that takes native code the rest of CrelioBot does without ([ADR-0007](adr/0007-calls-are-an-optional-service-with-dependencies.md)).
3. **Restart CrelioBot** (`stop-crelio.bat`, then `start-crelio.bat`). A "CrelioBot - Calls" window joins the others.
4. **Turn Calls on for a team**: in its `#general`, ask the Manager, for example "active le mode appel". It creates the voice channel (**Appel** or **Call**) in the KB's category. To turn them off, ask again.

`node bin/crelio.mjs calls status` shows whether the service runs and which teams have Calls on.

## Good to know

- **One Call at a time per bot.** With the shared Manager bot, if a Call is live in one KB and someone joins another KB's voice channel, the bot says it is busy. It comes over once the first Call has nobody in it.
- **Anyone in the server can talk** in a voice channel. Team changes asked by voice (e.g. "turn on the Artist") count only when the **owner** says them. The tools check who spoke.
- **The voice channel's chat** keeps the Call's transcript: 🎙️ for what people said, 🔊 for what the bot said. You can also type there during a Call.
- **Names**: transcription is given the names of your KBs and agents so it spells them right. Add others in the KB profile: `"call": { "vocabulary": ["Quillz", "Motion"] }`.
- **Tuning** (KB profile, `call`):

  | Setting | Default | What it does |
  |---|---|---|
  | `silence_ms` | 800 | Silence that ends a phrase |
  | `merge_ms` | 700 | A pause shorter than this keeps your sentence in one piece |
  | `min_speech_ms` | 400 | Shorter sounds are ignored |
  | `idle_minutes` | 120 | Leave an empty Call after this long |
  | `transcript` | true | Post the transcript in the voice channel's chat |

- **Voice**: the bot speaks with the voice notes' settings (`crelio.json` → `voice`: `tts_model`, `voice`, `speed`).
- **Privacy**: what you say is sent to OpenAI for transcription, like voice notes. The audio is not stored; the transcript is kept in `workspace/state/<kb>/call/utterances.jsonl` and in the voice channel's chat.

## When something is off

- **The bot doesn't join**: is the "CrelioBot - Calls" window open? `calls status`, then `workspace/state/calls/service.log`.
- **It joins but doesn't answer**: the KB session may be restarting. The bot says so in the voice channel's chat. Talk again in a minute.
- **"Busy in another call"**: someone is still in another KB's Call with the same bot.
