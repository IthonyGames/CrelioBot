# 03 — Agent bots post in Task threads

**What to build:** in a KB General, a request makes the Manager open a Task thread and the KB Researcher (as a background subagent) post its findings there under its own Agent bot. Delivers the Crelio MCP server with the Discord client, `post`, `thread_open/close/list/history/meta`, `whereami`, `react`, `edit`, the per-session thread registry, scope checks, message splitting and suppressed link previews.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] MCP server process tests against a fake Discord: post as the right bot, split > 2000 chars, suppress embeds, refuse out-of-scope channels and threads
- [ ] Thread registry survives a server restart
- [ ] `whereami` identifies KB General, Agent channel, Task/Side thread and the Agent a reply answers
- [ ] Live: Task thread opened by the Manager, KB Researcher posts under its own bot
