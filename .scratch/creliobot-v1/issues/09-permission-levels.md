# 09 — Permission levels

**What to build:** `guarded` (dontAsk, an allowlist, and guard hooks confining Bash and attachments to the KB folder and the session inbox, generalized from the owner's Prevision hooks) and `full` (bypass), chosen per KB profile.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Hook process tests: paths outside the KB refused, inside allowed, Git Bash and Windows paths handled
- [ ] Runtime tests: each level yields the expected flags and settings
