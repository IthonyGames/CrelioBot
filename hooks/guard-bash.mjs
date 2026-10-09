#!/usr/bin/env node
// PreToolUse (Bash) guard for the "guarded" level. Permission rules decide WHICH commands may run;
// this hook decides WHERE: the working directory and every path in the command must be inside the
// session folder or its inbox. Examples refused: `git diff --no-index C:/x`, `cd /c/Users`, `cat ~/.ssh/id_rsa`,
// `npm --prefix ../other install`. Known limit: code that a command runs (npm scripts, tests) is not inspected.

import { deny, isInside, readInput, sessionRoots, toNativePath } from './guard-common.mjs'

const TEXT_FLAGS = new Set(['-m', '--message', '-t', '--title', '-b', '--body', '--notes', '-F'])
const LOOKS_LIKE_PATH = /^([a-z]:[\\/]?|\/|~|\\\\)|(^|[\\/])\.\.([\\/]|$)/i

const data = await readInput()
const command = String(data?.tool_input?.command ?? '')
const cwd = data?.cwd ?? process.cwd()
const { roots, secrets, inbox } = sessionRoots()

if (!isInside(cwd, roots)) deny(`command refused: the working directory (${cwd}) is outside this session's folder`)

const tokens = [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3])
for (let i = 0; i < tokens.length; i++) {
  if (TEXT_FLAGS.has(tokens[i - 1])) continue
  let t = tokens[i].replace(/^[<>|&;(]+|[;)&|]+$/g, '')
  if (!t || t === '/dev/null' || /^[a-z][\w+.-]*:\/\//i.test(t)) continue // URLs
  const eq = t.match(/^--?[\w-]+=(.+)$/)
  if (eq) t = eq[1]
  if (!LOOKS_LIKE_PATH.test(t)) continue
  const p = toNativePath(t, cwd)
  if (isInside(p, secrets) && !isInside(p, [inbox])) deny(`command refused: "${tokens[i]}" points at CrelioBot secrets or session state`)
  if (!isInside(p, roots)) deny(`command refused: "${tokens[i]}" is outside this session's folder`)
}
process.exit(0)
