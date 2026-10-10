// crelio discord servers | use <server id> | provision [--kb <id>]
// Runs as the Manager bot, which is invited with Administrator.

import { ConfigError, loadInstance, updateSettings } from '../instance.mjs'
import { discordClient } from '../discord.mjs'
import { provisionGlobal, provisionKb } from '../provision.mjs'

export default async function discord({ workspace, repoDir, sub, rest, opts }) {
  let instance = loadInstance(workspace, { repoDir })
  const client = discordClient(instance.requireToken(null, 'manager'))

  if (sub === 'servers') {
    const guilds = await client.get('/users/@me/guilds')
    if (!guilds.length) console.log('The Manager bot is in no server yet — invite it: crelio bot invite manager')
    for (const g of guilds) console.log(`${g.id}  ${g.name}${g.id === instance.guildId ? '   ← current' : ''}`)
    return
  }
  if (sub === 'use') {
    const id = rest[0]
    if (!/^\d{17,20}$/.test(id ?? '')) throw new ConfigError('Usage: crelio discord use <server id>   (see: crelio discord servers)')
    const g = await client.get(`/guilds/${id}`).catch(() => { throw new ConfigError('The Manager bot is not in that server — invite it first (crelio bot invite manager)') })
    updateSettings(workspace, s => { s.server = { ...s.server, guild_id: id, owner_id: s.server?.owner_id || g.owner_id } })
    console.log(`✔ using server "${g.name}" (${id}); owner ${g.owner_id}`)
    return
  }
  if (sub === 'provision') {
    if (!instance.guildId) throw new ConfigError('No server chosen yet — crelio discord servers, then crelio discord use <id>')
    const log = m => console.log(`  ${m}`)
    if (!opts.kb) {
      const g = await provisionGlobal({ instance, client, log })
      console.log(`✔ Global General ${g.channel_id}${g.created ? ' (created)' : ''}`)
    }
    instance = loadInstance(workspace, { repoDir })
    const kbIds = opts.kb ? [opts.kb] : [...instance.kbs.keys()]
    // Every KB's category first, then their Agents' categories: new categories go to the bottom.
    for (const kbId of kbIds) await provisionKb({ instance: loadInstance(workspace, { repoDir }), client, kbId, log, agents: false })
    for (const kbId of kbIds) {
      const k = await provisionKb({ instance: loadInstance(workspace, { repoDir }), client, kbId, log })
      console.log(`✔ ${kbId}: category ${k.category_id}, General ${k.general_id}, ${Object.keys(k.agents).length} Agent channels${k.created ? ' (created)' : ''}`)
    }
    console.log('Restart the sessions so they listen to the new channels: stop-crelio then start-crelio.')
    return
  }
  throw new ConfigError('Usage: crelio discord servers | use <server id> | provision [--kb <id>]')
}
