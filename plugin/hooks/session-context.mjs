#!/usr/bin/env node
// SessionStart hook: prints the CrelioBot session context (see src/context.mjs) and records the
// session's inbox address for the Call service.
// Silent outside CrelioBot sessions (e.g. the setup session), and never blocks a start.

import { loadInstance } from '../../src/instance.mjs'
import { createTools } from '../../src/tools.mjs'
import { sessionContext } from '../../src/context.mjs'
import { writeInboxAddress } from '../../src/calls.mjs'

const sessionId = process.env.CRELIO_SESSION
const workspace = process.env.CRELIO_WORKSPACE
if (!sessionId || !workspace) process.exit(0)

try {
  const instance = loadInstance(workspace, { repoDir: process.env.CRELIO_HOME })
  // Where the Call service posts what people say in a Call (this session's inbox; changes at every start).
  writeInboxAddress(instance.stateDir(sessionId))
  console.log(await sessionContext({ instance, sessionId, tools: createTools({ instance, sessionId }) }))
} catch (e) {
  console.log(`# CrelioBot\nSession context unavailable at start (${e.message}). Use mcp__crelio__team and thread_list.`)
}
