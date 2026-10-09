# Permissions are set per KB, not per Agent

A KB profile chooses one permission level — `guarded` (Claude Code `dontAsk` plus an allowlist and guard hooks that keep commands and files inside the KB folder) or `full` (bypass) — and every Agent in that KB session shares it. Least privilege per Agent (e.g. a read-only Lawyer) was proposed and rejected by the owner to keep profiles simple; the boundary that matters is the KB, which each session is already confined to.
