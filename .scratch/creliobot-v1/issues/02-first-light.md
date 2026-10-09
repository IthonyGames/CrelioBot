# 02 — First light: one KB session answers in its KB General

**What to build:** a user with a Workspace describing one KB double-clicks the start launcher; a console window opens running that KB's session (Manager as main thread, official Discord plugin scoped to the KB category in static access mode, the KB's permission level); a person writing in the KB General gets an answer from the Manager bot; a session that exits restarts by itself; the stop launcher ends it. Includes the Workspace templates, the Instance module, the Session runtime, the launcher and a minimal plugin with the Manager.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Session runtime tests: Workspace fixture → exact claude args, env and generated files (access, settings, MCP config) for a KB session
- [ ] Two KBs in the fixture produce disjoint access scopes
- [ ] Restart loop restarts after exit and stops on the stop flag
- [ ] Live: message in KB General answered by the Manager bot
