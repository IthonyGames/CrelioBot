#!/usr/bin/env node
// PreToolUse guard for tools that send files to Discord (the plugin's reply, crelio post/attach):
// those servers run outside Claude Code's file permissions, so without this hook an agent could attach
// any file on the PC. Allowed: files inside the session folder or its inbox — never the Workspace
// secrets or session state.

import { deny, isInside, readInput, sessionRoots } from './guard-common.mjs'

const data = await readInput()
const files = data?.tool_input?.files
if (files === undefined || files === null) process.exit(0)
if (!Array.isArray(files)) deny('files must be a list of paths')

const { roots, secrets, inbox } = sessionRoots()
for (const f of files) {
  const path = String(f)
  if (isInside(path, secrets) && !isInside(path, [inbox])) deny(`attachment refused: ${path} is CrelioBot secret or session state`)
  if (!isInside(path, roots)) deny(`attachment refused: ${path} is outside this session's folder and inbox`)
}
process.exit(0)
