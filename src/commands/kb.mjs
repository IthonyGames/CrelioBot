// crelio kb add <path> [--id <id>] [--name <name>] [--language <xx>] [--permission guarded|full] | list
// Detects what the folder already says (kb-wizard config, CONTEXT.md, task system) instead of asking.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { ConfigError, DEFAULT_TEAM, loadInstance } from '../instance.mjs'

export function detectKb(path) {
  const has = f => existsSync(join(path, f))
  const read = f => { try { return readFileSync(join(path, f), 'utf8') } catch { return '' } }
  let config = {}
  for (const f of ['kb.config.json', 'kb/kb.config.json']) if (has(f)) { try { config = JSON.parse(read(f)) } catch {} break }
  const claudeMd = read('CLAUDE.md')
  const layout = has('KNOWLEDGE_BASE.md') || has('kb/KNOWLEDGE_BASE.md') ? 'kb-wizard'
    : has('CONTEXT.md') || has('CONTEXT-MAP.md') ? 'domain-modeled'
    : has('docs') ? 'documented' : 'plain'
  const language = config.language ?? claudeMd.match(/Language:\s*([a-z]{2})\b/i)?.[1]?.toLowerCase() ?? null

  let tasks = { adapter: 'none', notes: '' }
  const backend = config.tasks?.backend
  const hasBoard = has('board.json') || has('operations/project-management/board.json') || (has('scripts') && readdirSync(join(path, 'scripts')).some(f => /^(local_)?board/i.test(f)))
  const ticketDirs = has('.scratch') ? readdirSync(join(path, '.scratch')).filter(d => existsSync(join(path, '.scratch', d, 'issues'))) : []
  if (backend === 'notion' || /notion/i.test(claudeMd.match(/task[^\n]*notion|notion[^\n]*task/i)?.[0] ?? '')) tasks = { adapter: 'notion', notes: 'Tasks database in Notion (see CLAUDE.md)' }
  else if (backend === 'motion') tasks = { adapter: 'motion', notes: '' }
  else if (hasBoard) tasks = { adapter: 'local-board', notes: 'board.json via the KB board helper' }
  else if (ticketDirs.length) tasks = { adapter: 'markdown-tickets', notes: `.scratch/${ticketDirs[0]}/issues/NN-slug.md (one file per ticket, Status: line)` }
  else if (backend === 'local') tasks = { adapter: 'local-board', notes: '' }
  const taskSkill = has('.claude/skills') && readdirSync(join(path, '.claude/skills')).find(s => /^(tache|tasks?|task-sync|.*-sync)$/i.test(s))
  if (taskSkill) tasks = { adapter: `skill:${taskSkill}`, notes: tasks.notes }

  return { name: config.kb_name ?? basename(path), language, layout, tasks, git: has('.git') }
}

export default async function kb({ workspace, repoDir, sub, rest, opts }) {
  if (sub === 'list' || !sub) {
    const instance = loadInstance(workspace, { repoDir })
    for (const k of instance.kbs.values()) console.log(`${k.id.padEnd(16)} ${k.permission.padEnd(8)} ${k.language ?? '?'}  ${k.path}`)
    return
  }
  if (sub !== 'add') throw new ConfigError('Usage: crelio kb add <path> [--id <id>] [--name <name>] [--language xx] [--permission guarded|full] | list')
  const path = resolve(rest[0] ?? '')
  if (!rest[0] || !existsSync(path)) throw new ConfigError(`Folder not found: ${rest[0] ?? '(none given)'}`)
  const found = detectKb(path)
  const id = (opts.id ?? found.name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const file = join(workspace, 'kbs', `${id}.json`)
  if (existsSync(file)) throw new ConfigError(`A KB with id "${id}" already exists (${file}) — pick another with --id`)
  const permission = opts.permission ?? 'guarded'
  if (!['guarded', 'full'].includes(permission)) throw new ConfigError('--permission must be guarded or full')
  const profile = {
    name: opts.name ?? found.name,
    path: path.replaceAll('\\', '/'),
    language: opts.language ?? found.language ?? 'en',
    permission,
    pull_on_start: false,
    tasks: found.tasks,
    discord: { category_id: '', general_id: '', agents: {}, roles: {} },
    agents: { enabled: [...DEFAULT_TEAM], custom: [] }, // the other Core agents are enabled from Discord when needed
    allow: { tools: [] },
    schedules: [],
  }
  mkdirSync(join(workspace, 'kbs'), { recursive: true })
  writeFileSync(file, JSON.stringify(profile, null, 2) + '\n')
  console.log(JSON.stringify({ id, file, detected: found, profile }, null, 2))
}
