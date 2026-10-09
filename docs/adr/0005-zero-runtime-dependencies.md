# No runtime npm dependencies

CrelioBot's CLI, MCP server and hooks use only Node 22 built-ins (`fetch`, `FormData`, `WebSocket`, `node:test`) and talk to Discord and OpenAI over plain REST. discord.js would have saved code, but the official plugin already holds the gateway connection (ADR-0002), so we only need REST plus a one-off gateway login per bot; dropping dependencies removes the `npm install` step from setup and the supply-chain risk that plagued comparable agent projects.
