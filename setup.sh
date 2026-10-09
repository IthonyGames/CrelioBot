#!/usr/bin/env sh
# CrelioBot — guided setup. Opens Claude Code with the setup agent.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 22 or later is required: https://nodejs.org"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "Claude Code is required: https://code.claude.com/docs/en/quickstart"; exit 1; }
node bin/crelio.mjs setup "$@"
