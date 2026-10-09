# 06 — Voice notes

**What to build:** a person's Voice note is transcribed and handled as text; an Agent answers a Voice note with a short Voice note (a real Discord voice message from its Agent bot) plus the full text; voice replies on request at any time. OpenAI provider by default behind a provider interface; fallback to an audio attachment when Ogg Opus isn't available.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Ogg tests: duration and 256-point waveform from sample files
- [ ] MCP tests against fake Discord/OpenAI: voice-message flag, attachment metadata, transcription
- [ ] Live: Voice note in, Voice note out
