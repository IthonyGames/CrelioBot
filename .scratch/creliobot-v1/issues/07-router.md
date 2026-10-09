# 07 — Router

**What to build:** the Router session serves the Global General: it forwards a request to the right KB (posted visibly in the KB General, then handed to the KB session by cross-session message), answers "what's open everywhere", restarts a KB session on request, and drafts upstream proposals from generally useful Team learnings.

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [ ] `route` and `instance_status` tests against fake Discord and fixture registries
- [ ] Live: a request in the Global General becomes a Task thread in the right KB
