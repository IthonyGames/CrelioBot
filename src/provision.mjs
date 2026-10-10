// Discord provisioning, run as the Manager bot (invited with Administrator): the Global General, one
// category per KB with its KB General, one category per KB for its Agent channels, and one mentionable
// role per Agent in the Agent's color. Idempotent — reuses what the Workspace already points to, or what
// exists with the same name and parent, and records every ID back into the Workspace. It never renames
// or moves what exists: people restyle their server, and a re-run leaves it as they made it.
//
// The default look (from the owner's own server):
//   𝐂𝐫𝐞𝐥𝐢𝐨𝐁𝐨𝐭                the Global General, at the top, outside any category
//   𝙌𝙐𝙄𝙇𝙇𝙕                    a KB's category, its name in bold italic capitals
//     💭𝘔𝘦𝘴𝘴𝘢𝘨𝘦               the KB General          🔈𝘊𝘢𝘭𝘭  its voice channel, when Calls are on
//   Quillz agents             the KB's Agent channels, after every KB's category
// The letters are Unicode's mathematical alphanumerics; "discord_fonts": false in crelio.json keeps
// plain letters (screen readers spell the fancy ones out).

import { agentName, updateKbProfile, updateSettings, SPECIALISTS } from './instance.mjs'

const TOPICS = {
  global: 'Ask anything — the Router sends it to the right team.',
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

/** Each Core agent's color — its avatar's background (assets/avatars/). */
export const AGENT_COLORS = {
  manager: 0x2563EB, 'kb-researcher': 0x8B5E3C, 'web-researcher': 0x0E7490, brainstormer: 0xCA8A04,
  artist: 0xC026D3, 'ux-expert': 0x6D28D9, marketing: 0xB91C1C, lawyer: 0x475569, planner: 0xEA580C, coder: 0x16A34A,
}

// First code point of A, a and 0 in each Unicode "font" (Mathematical Alphanumeric Symbols).
const FONTS = {
  bold: [0x1D400, 0x1D41A, 0x1D7CE], // 𝐁𝐨𝐥𝐝 (serif)
  'bold-italic': [0x1D63C, 0x1D656, 0x1D7EC], // 𝘽𝙤𝙡𝙙 𝙞𝙩𝙖𝙡𝙞𝙘 (sans)
  italic: [0x1D608, 0x1D622, 0x1D7E2], // 𝘐𝘵𝘢𝘭𝘪𝘤 (sans)
}

/** Text in a Unicode "font". Accented letters keep their accent; anything else is left as is. */
export function styled(text, font) {
  const [upper, lower, digit] = FONTS[font]
  return [...String(text).normalize('NFD')].map(ch => {
    const c = ch.codePointAt(0)
    if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65)
    if (c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97)
    if (c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48)
    return ch
  }).join('')
}

/** The names CrelioBot gives what it creates in Discord. */
export function layoutNames(instance) {
  const font = instance.settings.discord_fonts === false ? text => text : styled
  const kbName = kb => kb.name ?? kb.id
  return {
    global: font('CrelioBot', 'bold'),
    kbCategory: kb => font(kbName(kb).toUpperCase(), 'bold-italic').slice(0, 100),
    general: `💭${font('Message', 'italic')}`,
    call: `🔈${font('Call', 'italic')}`,
    agentsCategory: kb => `${kbName(kb)} agents`.slice(0, 100),
  }
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

  async function ensureRole({ id, name, color }) {
    const list = await allRoles()
    const found = (id && list.find(r => r.id === id)) || list.find(r => r.name === name)
    if (found) return { id: found.id, created: false }
    const created = await client.post(`/guilds/${guildId}/roles`, { name, mentionable: true, permissions: '0', ...(color ? { color } : {}) }, { reason: 'CrelioBot setup' })
    list.push(created)
    log(`created role @${name}`)
    return { id: created.id, created: true }
  }

  /** Where a KB's Agent channels go: its recorded category, else wherever its Agent channels already are
   * (older layouts kept them in the KB's category), else "<KB> agents" — found or created. */
  async function agentsCategory({ kb, names }) {
    const d = kb.discord ?? {}
    const list = await allChannels()
    if (d.agents_category_id && list.some(c => c.id === d.agents_category_id)) return { id: d.agents_category_id, created: false }
    const existing = Object.values(d.agents ?? {}).map(id => list.find(c => c.id === id)?.parent_id).find(Boolean)
    if (existing) return { id: existing, created: false }
    const name = names.agentsCategory(kb)
    const byName = list.find(c => c.type === 4 && c.name.toLowerCase() === name.toLowerCase())
    if (byName) return { id: byName.id, created: false }
    return ensureChannel({ name, type: 4 })
  }

  async function agentChannelAndRole({ kbName, categoryId, agent, channelId, roleId }) {
    const ch = await ensureChannel({ id: channelId, name: channelName(agent), parent_id: categoryId, topic: TOPICS[agent] ?? `${agentName(agent)} — custom agent.` })
    const role = await ensureRole({ id: roleId, name: `${agentName(agent)} · ${kbName}`.slice(0, 100), color: AGENT_COLORS[agent] })
    return { channel_id: ch.id, role_id: role.id, created: ch.created || role.created }
  }

  return { ensureChannel, ensureRole, agentsCategory, agentChannelAndRole }
}

/** Global General (Router): a channel at the top of the server, outside any category. */
export async function provisionGlobal({ instance, client, log }) {
  const p = provisioner({ client, guildId: instance.guildId, log })
  const ch = await p.ensureChannel({ id: instance.globalGeneralId, name: layoutNames(instance).global, topic: TOPICS.global })
  updateSettings(instance.workspaceDir, s => { s.global_general = { ...s.global_general, channel_id: ch.id } })
  return { channel_id: ch.id, created: ch.created }
}

/**
 * One KB: its category and KB General, the Manager's role and — with `agents` — its Agents' category,
 * channels and roles. "crelio discord provision" runs every KB without agents first, so the KBs'
 * categories come before the Agents' ones in the server.
 */
export async function provisionKb({ instance, client, kbId, log, agents: withAgents = true }) {
  const kb = instance.kb(kbId)
  const d = kb.discord ?? {}
  const p = provisioner({ client, guildId: instance.guildId, log })
  const names = layoutNames(instance)
  const kbName = kb.name ?? kb.id
  const cat = await p.ensureChannel({ id: d.category_id, name: names.kbCategory(kb), type: 4 })
  const general = await p.ensureChannel({ id: d.general_id, name: names.general, parent_id: cat.id, topic: TOPICS.general })
  const agents = { ...d.agents }
  const rolesMap = { ...d.roles }
  let created = cat.created || general.created
  const managerRole = await p.ensureRole({ id: rolesMap.manager, name: `Manager · ${kbName}`.slice(0, 100), color: AGENT_COLORS.manager })
  rolesMap.manager = managerRole.id
  created ||= managerRole.created
  let agentsCat = d.agents_category_id ? { id: d.agents_category_id } : null
  if (withAgents) {
    agentsCat = await p.agentsCategory({ kb, names })
    created ||= agentsCat.created
    for (const agent of instance.agentsFor(kbId).filter(a => a !== 'manager')) {
      const r = await p.agentChannelAndRole({ kbName, categoryId: agentsCat.id, agent, channelId: agents[agent], roleId: rolesMap[agent] })
      agents[agent] = r.channel_id
      rolesMap[agent] = r.role_id
      created ||= r.created
    }
  }
  updateKbProfile(instance.workspaceDir, kbId, k => {
    k.discord = { ...k.discord, category_id: cat.id, general_id: general.id, ...(agentsCat ? { agents_category_id: agentsCat.id } : {}), agents, roles: rolesMap }
  })
  return { category_id: cat.id, general_id: general.id, agents_category_id: agentsCat?.id ?? null, agents, roles: rolesMap, created }
}

export { SPECIALISTS }
