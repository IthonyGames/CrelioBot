# 05 — Full team and Pipeline

**What to build:** the ten Core agents and the team protocol skill. A real request runs end to end: Task thread reused or opened, KB Researcher first, the research wave in parallel, Brainstormer / Artist / Planner / Coder as needed, review, summary with results, thread closed. Agents decide with Evidence and Escalate otherwise to the Requester (or whoever knows); the answer under the question continues the asking Agent. Hop budget enforced. Side threads in Agent channels hand results back to the Task thread. The session-start hook restores open threads after a restart.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Session-start hook test: registry + fake Discord → context with identity, roster, open threads, Schedules
- [ ] Live: a multi-agent Task completes with a summary and a closed thread
- [ ] Live: an Escalation answered under the question resumes the right Agent
- [ ] Live: a Side thread in an Agent channel hands back to the Task thread
