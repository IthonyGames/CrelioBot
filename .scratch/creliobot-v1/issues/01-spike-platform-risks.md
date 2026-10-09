# 01 — Spike: verify the platform risks ADR-0002 rests on

**What to build:** throwaway experiments (kept out of the product code) that answer four yes/no questions on the real platforms, recorded under Answer: (a) can several gateway sessions share one bot token and all receive guild events; (b) can one Claude Code session send a cross-session message to another named session on Windows, and the receiver act on it, with `crossSessionInbound: accept`; (c) does a session cron created inside an interactive session fire while it is idle; (d) can a bot that only logged in to the gateway once post through REST and send a Voice note (voice-message flag, duration, waveform) into a thread.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] (a) answered with evidence (two gateway sessions on one token both see a MESSAGE_CREATE)
- [ ] (b) answered with evidence (receiver session's tool call logged)
- [ ] (c) answered with evidence (cron-triggered tool call logged)
- [ ] (d) answered with evidence (message + Voice note visible in the test channel)
- [ ] ADR-0002 updated if any answer is "no"
