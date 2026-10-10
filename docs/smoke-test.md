# Live smoke test

Run on a throwaway Discord server before each release (or after changing the runtime, the MCP server or the agents). Use a scratch KB folder.

## Setup
- [ ] Fresh clone → `setup.bat` → the setup agent reaches a running Instance without manual edits beyond tokens
- [ ] `crelio doctor` shows no ✖

## Start and restart
- [ ] `start-crelio.bat` opens one window per session, none shows a dialog
- [ ] Close a KB window's Claude (Ctrl+C twice): it restarts by itself within seconds
- [ ] `crelio status` lists every session as running; `stop-crelio.bat` stops them all

## Isolation
- [ ] A message in KB A's #general is answered by A's session only
- [ ] Asking KB A's Manager to post in KB B's channel is refused

## Task flow
- [ ] A request in a KB #general opens a Task thread on the message, titled with the requester
- [ ] KB Researcher posts first, under its own bot; parallel research wave when relevant
- [ ] A Specialist escalates with numbered questions tagging the requester; replying under the question resumes that Specialist
- [ ] The Manager posts the summary with results — a few plain sentences, no titles or "Decided/Next" labels — updates the task system, closes the thread
- [ ] Writing in the closed thread reopens it and continues the Task

## Agent channels
- [ ] A message in #artist gets a Side thread from the Artist; "approved" hands back to the Task thread

## Router
- [ ] A request in the Global General about KB A lands in A's #general (quoted, linked) and becomes a Task thread
- [ ] "What's open everywhere?" lists open threads per KB

## Voice
- [ ] A voice message is understood; the reply includes a real voice message (waveform bubble) from the agent's bot

## Restart memory
- [ ] Restart mid-Task: the session context lists the thread with its last messages; "continue" resumes it; a new request is handled as new

## Schedules
- [ ] "Every day at <in 2 minutes>, post a hello" → a Schedule is saved and fires; it is re-armed after a restart

## Custom agent
- [ ] "Create an agent for X" → interview → definition in the KB → channel + role → bot steps → restart → the agent introduces itself

## Guarded level
- [ ] Asking for `cat` of a file outside the KB, or of `workspace/.env`, is refused
- [ ] Attaching a file outside the KB is refused
