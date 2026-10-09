# Instance data lives in a git-ignored Workspace; KB folders stay untouched

The public repository holds only the framework, the core Agents and setup tooling. Everything belonging to one Instance — Discord IDs, tokens, KB profiles, schedules, session state, Team learnings — lives in `workspace/`, which is git-ignored, so an Instance is a copy of the repo plus its Workspace. KB folders are not modified by CrelioBot except for Custom agents a user creates for that KB (`.claude/agents/`), which belong with the KB's own history; KB learnings go through each KB's existing learning method.
