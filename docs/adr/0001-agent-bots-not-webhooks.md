# Every Agent speaks through its own Discord bot application, never a webhook

Each Agent has a real Discord bot application (Agent bot), so people can @mention it, see it in the member list, and receive Voice notes from it. Webhooks would have let one bot post under many names with no extra setup, but they can't be mentioned, can't send Voice notes, and the owner rejected them outright. Agent bots are shared across KBs by default (one `@Coder` for every KB category); a KB profile may override a bot token if someone wants separate identities per KB.

## Consequences

- Adding an Agent means creating a bot application by hand in the Discord Developer Portal — Discord offers no API for it. The agent creator guides the user step by step and never asks for a token in Discord.
- Sharing a bot across KBs does not share context: isolation comes from KB sessions (ADR-0003), not from bots.
