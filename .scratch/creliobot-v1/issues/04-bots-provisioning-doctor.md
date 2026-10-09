# 04 — Bot registry, Discord provisioning and doctor

**What to build:** CLI commands to add an Agent bot from a locally entered token (validated, activated with a one-off gateway login, name set, invite link printed); to provision the Global General, KB categories, KB Generals, Agent channels and Agent roles idempotently (bots granted view permission explicitly); and a doctor that checks the environment and the Instance end to end with fixes.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Provisioning is idempotent (a second run creates nothing)
- [ ] Invite link carries the CrelioBot permission set
- [ ] Doctor reports a missing intent, a bot missing from the server, a missing channel, missing Bun / Discord plugin / Claude Code
