// crelio setup — creates the Workspace from the templates (if needed), then opens Claude Code in the
// repo with the setup agent, which drives the rest conversationally with the crelio commands.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError } from '../instance.mjs'
import { cleanEnv } from '../runtime.mjs'
import { findExecutable, spawnClaude } from '../launcher.mjs'

export function createWorkspace(workspace, repoDir) {
  const t = join(repoDir, 'templates', 'workspace')
  mkdirSync(join(workspace, 'kbs'), { recursive: true })
  mkdirSync(join(workspace, 'learnings'), { recursive: true })
  const created = []
  if (!existsSync(join(workspace, 'crelio.json'))) { copyFileSync(join(t, 'crelio.json'), join(workspace, 'crelio.json')); created.push('crelio.json') }
  if (!existsSync(join(workspace, '.env'))) { copyFileSync(join(t, 'env.example'), join(workspace, '.env')); created.push('.env') }
  const learnings = join(workspace, 'learnings', 'team.md')
  if (!existsSync(learnings)) writeFileSync(learnings, '# Team learnings\n\nHow the agents work together — recorded by the agents, read at every session start.\n\n')
  return created
}

export default async function setup({ workspace, repoDir, rest }) {
  const created = createWorkspace(workspace, repoDir)
  if (created.length) console.log(`Workspace created: ${workspace} (${created.join(', ')})`)
  const claude = findExecutable('claude')
  if (!claude) throw new ConfigError('Claude Code (claude) not found — install it: https://code.claude.com/docs/en/quickstart')
  const cli = process.platform === 'win32' ? 'node bin\\crelio.mjs' : 'node bin/crelio.mjs'
  const args = [
    '--plugin-dir', join(repoDir, 'plugin'),
    '--name', 'crelio-setup',
    '--allowedTools', `Bash(${cli} *)`, 'Bash(node bin/crelio.mjs *)', 'Read', 'Glob', 'Grep',
    '--', `/creliobot:setup ${rest.join(' ')}`.trim(),
  ]
  const child = spawnClaude(claude, { args, cwd: repoDir, env: { ...cleanEnv(process.env), CRELIO_WORKSPACE: workspace } })
  await new Promise(resolve => child.on('exit', resolve))
}
