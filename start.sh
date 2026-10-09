#!/usr/bin/env sh
# CrelioBot — start every session (Router + one per KB) in tmux windows (session "creliobot").
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 22 or later is required: https://nodejs.org"; exit 1; }
node bin/crelio.mjs start "$@" && echo "Attach with: tmux attach -t creliobot"
