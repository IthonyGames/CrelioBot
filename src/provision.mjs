// Discord provisioning, run as the Manager bot (invited with Administrator): the Global General,
// one category per KB with its KB General and Agent channels, and one mentionable role per Agent.
// Idempotent — reuses what the Workspace already points to, or what exists with the same name and
// parent, and records every ID back into the Workspace.

import { agentName, updateKbProfile, updateSettings, SPECIALISTS } from './instance.mjs'

export const GLOBAL_CATEGORY = 'CrelioBot'
const TOPICS = {
  general: 'Ask the team here — the Manager opens a thread per task.',
  'kb-researcher': 'KB Researcher — context, decisions and learnings from the knowledge base.',
  'web-researcher': 'Web Researcher — fast, medium or deep research on the web.',
  brainstormer: 'Brainstormer — decisions, options and the questions that matter.',
  artist: 'Artist — visuals, style, finishing touches.',
  'ux-expert': 'UX Expert — clarity and usability for the audience.',
  marketing: 'Marketing — audience, positioning, content.',
  lawyer: 'Lawyer — compliance checks with current sources.',
  planner: 'Planner — execution plans.',
  coder: 'Coder — implementation.',
}

export function channelName(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').slice(0, 100) || 'channel'
}

export function provisioner({ client, guildId, log = () => {} }) {
  let channels
  let roles
  const allChannels = async () => (channels ??= await client.get(`/guilds/${guildId}/channels`))
  const allRoles = async () => (roles ??= await client.get(`/guilds/${guildId}/roles`))

  async function ensureChannel({ id, name, type = 0, parent_id = null, topic }) {
    const list = await allChannels()
    const found = (id && list.find(c => c.id === id)) || list.find(c => c.name === name && c.type === type && (c.parent_id ?? null) === parent_id)
    if (found) return { id: found.id, created: false }
    const created = await client.post(`/guilds/${guildId}/channels`, { name, type, ...(parent_id ? { parent_id } : {}), ...(topic ? { topic } : {}) }, { reason: 'CrelioBot setup' })
    list.push(created)
    log(`created ${type === 4 ? 'category' : 'channel'} ${name}`)
    return { id: created.id, created: true }
  }

  async function ensureRole({ id, name }) {
    const list = await allRoles()
    const found = (id && list.find(r => r.id === id)) || list.find(r => r.name === name)
    if (found) return { id: found.id, created: false }
    const created = await client.post(`/guilds/${guildId}/roles`, { name, mentionable: true, permissions: '0' }, { reason: 'CrelioBot setup' })
    list.push(created)
    log(`created role @${name}`)
    return { id: created.id, created: true }
  }

  async function agentChannelAndRole({ kbName, categoryId, agent, channelId, roleId }) {
    const ch = await ensureChannel({ id: channelId, name: channelName(agent), parent_id: categoryId, topic: TOPICS[agent] ?? `${agentName(agent)} — custom agent.` })
    const role = await ensureRole({ id: roleId, name: `${agentName(agent)} · ${kbName}`.slice(0, 100) })
    return { channel_id: ch.id, role_id: role.id, created: ch.created || role.created }
  }

  return { ensureChannel, ensureRole, agentChannelAndRole }
}

/** Global General (Router). */
export async function provisionGlobal({ instance, client, log }) {
  const p = provisioner({ client, guildId: instance.guildId, log })
  const cat = await p.ensureChannel({ id: instance.settings.global_general?.category_id, name: GLOBAL_CATEGORY, type: 4 })
  const ch = await p.ensureChannel({ id: instance.globalGeneralId, name: 'general', parent_id: cat.id, topic: 'Ask anything — the Router sends it to the right team.' })
  updateSettings(instance.workspaceDir, s => { s.global_general = { ...s.global_general, category_id: cat.id, channel_id: ch.id } })
  return { category_id: cat.id, channel_id: ch.id, created: cat.created || ch.created }
}

/** One KB: category, KB General, an Agent channel and a role per Specialist (+ custom agents). */
export async function provisionKb({ instance, client, kbId, log }) {
  const kb = instance.kb(kbId)
  const d = kb.discord ?? {}
  const p = provisioner({ client, guildId: instance.guildId, log })
  const kbName = kb.name ?? kb.id
  const cat = await p.ensureChannel({ id: d.category_id, name: kbName.slice(0, 100), type: 4 })
  const general = await p.ensureChannel({ id: d.general_id, name: 'general', parent_id: cat.id, topic: TOPICS.general })
  const agents = { ...d.agents }
  const rolesMap = { ...d.roles }
  let created = cat.created || general.created
  const managerRole = await p.ensureRole({ id: rolesMap.manager, name: `Manager · ${kbName}`.slice(0, 100) })
  rolesMap.manager = managerRole.id
  for (const agent of instance.agentsFor(kbId).filter(a => a !== 'manager')) {
    const r = await p.agentChannelAndRole({ kbName, categoryId: cat.id, agent, channelId: agents[agent], roleId: rolesMap[agent] })
    agents[agent] = r.channel_id
    rolesMap[agent] = r.role_id
    created ||= r.created
  }
  updateKbProfile(instance.workspaceDir, kbId, k => {
    k.discord = { ...k.discord, category_id: cat.id, general_id: general.id, agents, roles: rolesMap }
  })
  return { category_id: cat.id, general_id: general.id, agents, roles: rolesMap, created }
}

export { SPECIALISTS }
