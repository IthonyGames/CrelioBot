# CrelioBot

CrelioBot turns a Discord server into the workspace of a team of Claude Code agents. Each knowledge base gets its own team, its own Discord category and its own Claude Code session; a router in the server-wide channel sends requests to the right team.

## Language

### Instance and knowledge bases

**Instance**:
One person's installed copy of CrelioBot, with its own Discord server, bots and knowledge bases.
_Avoid_: deployment, install

**Workspace**:
The private part of an Instance — its configuration, secrets, session state and team learnings. Never published.
_Avoid_: config folder, data dir

**Knowledge base (KB)**:
A folder of project knowledge (and often code) that one team works in. CrelioBot reads it but does not own its layout.
_Avoid_: project, repo, vault

**KB profile**:
The Instance's description of one KB: where it lives, its language, its permission level, its task adapter, its channels and its schedules.
_Avoid_: KB config, registry entry

**Permission level**:
How much a KB's session may do on the machine — `guarded` (scoped to the KB folder) or `full`. Set per KB, never per agent.
_Avoid_: autonomy level, mode

### Sessions

**KB session**:
The single long-running Claude Code session that serves one KB. Nothing it sees or remembers reaches another KB session.
_Avoid_: bot, instance, worker

**Router session**:
The Claude Code session behind the Global General: it routes requests to KB sessions and answers questions that span KBs.
_Avoid_: global manager, dispatcher

### Agents

**Agent**:
A role on a KB team with its own instructions, model and Discord identity.
_Avoid_: bot, persona, assistant

**Core agent**:
One of the ten Agents every team starts with: Manager, KB Researcher, Web Researcher, Brainstormer, Artist, UX Expert, Marketing, Lawyer, Planner, Coder.

**Custom agent**:
An Agent a user adds to one KB's team (or to every team) with the agent creator.
_Avoid_: user agent, extra agent

**Manager**:
The Agent that runs a KB session: it takes requests, opens Task threads, sends work to Specialists in order, and summarizes results.
_Avoid_: orchestrator, lead, PM

**Specialist**:
Any Agent other than the Manager.
_Avoid_: worker, sub-agent (a specialist runs as one, but the role is the concept)

**Agent bot**:
The Discord bot application that gives an Agent its name, avatar and @mention. It carries no memory; the same Agent bot can speak for its Agent in several KBs.
_Avoid_: webhook, persona

### Discord layout

**Global General**:
The server-wide channel where anyone can ask anything; the Router session answers there.

**KB category**:
The Discord category that holds one KB's channels.

**KB General**:
The channel in a KB category where requests are made and Task threads live.
_Avoid_: main channel, lobby

**Agent channel**:
A Specialist's own channel inside a KB category, for talking to that Specialist directly.
_Avoid_: desk, room

### Work

**Task**:
One request a team works on from intake to summary, mirrored in the KB's task system when it has one.
_Avoid_: job, ticket (a ticket is the task system's record of a Task)

**Task thread**:
The Discord thread in a KB General where one Task is coordinated and its results are posted.
_Avoid_: task channel, conversation

**Side thread**:
A thread a Specialist opens in its Agent channel to work with a person on part of a Task, linked back to the Task thread.
_Avoid_: sub-thread, private thread

**Pipeline**:
The default order in which the Manager involves Specialists in a Task: KB Researcher first, then the research wave (Web Researcher, Marketing, Lawyer), Brainstormer, Artist, Planner, Coder, then review (Artist, UX Expert, Lawyer).

**Hop**:
One hand-off of work from one Agent to another inside a Task.

**Hop budget**:
The number of Hops a Task may take before the Manager must ask a person whether to continue.

**Evidence**:
A KB source or research result that backs a decision. An Agent may decide alone only with Evidence.

**Escalation**:
An Agent stopping to ask the person most likely to know, because it lacks Evidence to decide.
_Avoid_: approval, gate (a gate is fixed; an Escalation is triggered by missing Evidence)

**Requester**:
The person who asked for a Task; the default target of its Escalations.

**Brief**:
What an Agent hands to the Agent that called it when it finishes — the full detail of its work. Its Discord post carries only the headline.
_Avoid_: report, handoff note

**Ping**:
A notification a person gets because a post mentions them. A Task pings its Requester when it starts, for each question that needs them, and when it is done — never otherwise.
_Avoid_: tag (tagging an Agent is how people follow hand-offs; pinging a person costs their attention)

**Task adapter**:
How a KB session reads and writes the KB's own task system (a local board, Notion, Motion, markdown tickets, or a KB skill).
_Avoid_: task backend, integration

### Memory and time

**KB learning**:
A lesson about the KB's domain, recorded in that KB with the KB's own learning method.

**Team learning**:
A lesson about how the Agents work together, recorded in the Workspace.
_Avoid_: workflow note, meta-learning

**Schedule**:
Recurring work a KB session starts on its own at set times, such as a morning brief.
_Avoid_: cron, routine, job

**Voice note**:
A Discord voice message (the playable waveform bubble), sent by a person or by an Agent bot.
_Avoid_: audio file, mp3 reply
