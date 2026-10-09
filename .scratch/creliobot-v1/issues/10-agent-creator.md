# 10 — Agent creator

**What to build:** "@Manager create an agent for X" runs the agent creator: a short interview, the Custom agent definition written into the KB (or the Workspace for all KBs), step-by-step guidance to create the Agent bot with the token entered locally, then the Agent's channel and role created and the session restarted to load it.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] `provision_agent` and `restart_session` tests
- [ ] Live: a new Custom agent answers in its own channel after the restart
