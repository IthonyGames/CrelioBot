// Thread registry: what a session knows about each of its Task and Side threads, kept on disk so it
// survives restarts. Discord stays the source of truth for messages; this holds the coordination
// facts Discord can't: kind, Task, Requester, owning Agent, parent Task thread, Hops, who waits on whom.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const THREAD_FIELDS = ['kind', 'name', 'task_id', 'requester', 'agent', 'parent', 'hops', 'status', 'waiting_on', 'summary', 'notes']

export function openRegistry(stateDir) {
  const file = join(stateDir, 'threads.json')
  const read = () => {
    if (!existsSync(file)) return { threads: {} }
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return { threads: {} } }
  }
  const write = data => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify(data, null, 2) + '\n')
    renameSync(file + '.tmp', file)
  }
  return {
    get(id) { return read().threads[id] ?? null },
    list() { return Object.entries(read().threads).map(([id, t]) => ({ thread_id: id, ...t })) },
    upsert(id, patch) {
      const data = read()
      const now = new Date().toISOString()
      const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k, v]) => THREAD_FIELDS.includes(k) && v !== undefined))
      data.threads[id] = { created_at: now, ...data.threads[id], ...clean, updated_at: now }
      write(data)
      return { thread_id: id, ...data.threads[id] }
    },
  }
}
