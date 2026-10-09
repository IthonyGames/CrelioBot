#!/usr/bin/env node
// crelio — CrelioBot command line. Run "crelio help" for the commands.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ConfigError, loadInstance } from '../src/instance.mjs'
import { runSession, startAll, stopAll, isSessionProcess, launchIds, pidFile } from '../src/launcher.mjs'

const REPO = resolve(import.meta.dirname, '..')

const HELP = `CrelioBot — Claude Code agent teams on Discord

Usage: crelio <command> [options]

Running
  start [--only <id> ...]     open one window per session (Router + each KB) and keep them running
  stop                        stop every session
  status                      show sessions and whether they are running
  run <id>                    the restart loop for one session (used by "start")

Setup
  setup                       start the setup agent (guided, conversational)
  doctor                      check prerequisites, bots and Discord layout
  bot add <agent>             register an Agent bot from a token typed locally
  bot invite [<agent>]        print invite links
  kb add <path>               add a folder as a KB
  discord provision           create the Discord layout (channels, roles) from the Workspace
  calls install | status      the Call service (voice channels) — optional dependencies
  calls enable|disable <kb>   turn Calls on/off for a KB (creates its voice channel)

Options
  --workspace <dir>           Workspace folder (default: CRELIO_WORKSPACE or ./workspace)
`

function parse(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--only') (opts.only ??= []).push(argv[++i])
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    else opts._.push(a)
  }
  return opts
}

async function main() {
  const opts = parse(process.argv.slice(2))
  const [cmd, sub, ...rest] = opts._
  const workspace = resolve(opts.workspace ?? process.env.CRELIO_WORKSPACE ?? join(REPO, 'workspace'))

  switch (cmd) {
    case 'start': {
      const opened = startAll(workspace, { repoDir: REPO, only: opts.only })
      console.log(`Started ${opened.length} session(s):\n  ${opened.join('\n  ')}`)
      return
    }
    case 'run':
      if (!sub) throw new ConfigError('Usage: crelio run <session id>')
      return runSession(workspace, sub, { repoDir: REPO })
    case 'stop': {
      const stopped = stopAll(workspace, { repoDir: REPO })
      console.log(stopped.length ? `Stopped: ${stopped.join(', ')}` : 'No running session found (stop flag set anyway).')
      return
    }
    case 'status': {
      const instance = loadInstance(workspace, { repoDir: REPO })
      for (const id of launchIds(instance)) {
        const file = pidFile(instance, id)
        const pid = existsSync(file) ? Number(readFileSync(file, 'utf8')) : null
        console.log(`${id.padEnd(20)} ${pid && isSessionProcess(pid) ? `running (pid ${pid})` : 'stopped'}`)
      }
      return
    }
    case 'setup':
    case 'doctor':
    case 'bot':
    case 'kb':
    case 'calls':
    case 'discord': {
      const mod = await import(`../src/commands/${cmd}.mjs`)
      return mod.default({ workspace, repoDir: REPO, sub, rest, opts })
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP)
      return
    default:
      throw new ConfigError(`Unknown command "${cmd}". Run "crelio help".`)
  }
}

main().catch(err => {
  const known = err instanceof ConfigError || err?.name === 'DiscordError'
  console.error(known ? `\n✖ ${err.message}\n` : err)
  if (err?.name === 'DiscordError' && err.status === 403) console.error('  The Manager bot needs Administrator in the server — run "crelio doctor" for the fix.\n')
  process.exit(1)
})
