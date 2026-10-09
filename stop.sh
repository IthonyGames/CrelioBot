#!/usr/bin/env sh
# CrelioBot — stop every session.
cd "$(dirname "$0")" || exit 1
node bin/crelio.mjs stop
