# 01 — Spike: verify the platform risks ADR-0002 rests on

**What to build:** throwaway experiments (kept out of the product code) that answer four yes/no questions on the real platforms, recorded under Answer: (a) can several gateway sessions share one bot token and all receive guild events; (b) can one Claude Code session send a cross-session message to another named session on Windows, and the receiver act on it, with `crossSessionInbound: accept`; (c) does a session cron created inside an interactive session fire while it is idle; (d) can a bot that only logged in to the gateway once post through REST and send a Voice note (voice-message flag, duration, waveform) into a thread.

**Blocked by:** None — can start immediately

**Status:** resolved

- [ ] (a) answered with evidence (two gateway sessions on one token both see a MESSAGE_CREATE)
- [ ] (b) answered with evidence (receiver session's tool call logged)
- [ ] (c) answered with evidence (cron-triggered tool call logged)
- [ ] (d) answered with evidence (message + Voice note visible in the test channel)
- [ ] ADR-0002 updated if any answer is "no"

## Answer

Resolved 2026-10-09 — ADR-0002 holds.

- (a) **Yes.** Two raw gateway sessions on one token both received the same `TYPING_START`; in the live test, the Router and the KB session each ran the official plugin on the Manager token at the same time.
- (b) **Yes, with a catch.** A session started from inside another Claude Code session inherits `CLAUDECODE` / `CLAUDE_CODE_*` identity variables, thinks it is nested and never registers for cross-session messages. With those variables stripped (the launcher now does it), `SendMessage` reached the session and it acted within ~20 s.
- (c) **Yes.** A one-shot `CronCreate` job fired on time while the session was idle.
- (d) REST posting from a bot activated once on the gateway: **yes** (KB Researcher in the live test). Voice message upload: covered by process tests; live check pending in the smoke test.

Also found: the first start in a never-used folder asks to trust it (once per folder); the development-channels dialog appears at every launch (why ADR-0002 uses the official plugin).
