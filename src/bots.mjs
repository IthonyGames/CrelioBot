// Registering an Agent bot: check its token with Discord, activate it on the gateway once, record its
// ids in the Workspace and give it its display name and avatar in the server. Used by `crelio bot add`
// (terminal) and by the bot_register tool (Discord). The token is read from workspace/.env and never
// leaves this process — no agent sees it.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentName, updateSettings } from './instance.mjs'
import { discordClient } from './discord.mjs'
import { gatewayLogin } from './gateway.mjs'
import { hasMessageContentIntent, inviteUrl } from './permissions.mjs'

export const tokenEnvFor = agent => `DISCORD_TOKEN_${agent.toUpperCase().replace(/-/g, '_')}`

export const SPECIALIST_PERMISSION_NAMES = 'View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis, Send Voice Messages'

export const PORTAL_STEPS = agent => `
  1. https://discord.com/developers/applications → "New Application" → name it "${agentName(agent)}" → Create
  2. "Installation" → Install Link: "Discord Provided Link" → Default Install Settings → Guild Install →
     scopes: bot → Permissions: ${agent === 'manager' ? '"Administrator"' : SPECIALIST_PERMISSION_NAMES} → Save Changes
  3. "Bot" → "Reset Token" → copy it (shown once); Privileged Gateway Intents → "Message Content Intent" ON → Save
  4. Put the token in workspace/.env as ${tokenEnvFor(agent)}=… (never paste a token in a chat or in Discord — if you did, reset it)
  5. "Installation" → copy the Install Link → open it → Add to server → Authorize
  6. Lock it down: "Installation" → Install Link: None → Save; then "Bot" → "Public Bot" OFF → Save`

/** An Agent's avatar: the Workspace's own (`workspace/avatars/<agent>.png`, for Custom agents or a
 * personal choice) first, then the Core agents' set in `assets/avatars/`. */
export function avatarFile(instance, agent) {
  for (const dir of [join(instance.workspaceDir, 'avatars'), join(instance.repoDir, 'assets', 'avatars')]) {
    const file = join(dir, `${agent}.png`)
    if (existsSync(file)) return file
  }
  return null
}

/** Gives a bot its Agent's avatar — only when it has none, unless `force`. 'set' | 'kept' | 'none' (no file). */
export async function setAvatar({ instance, agent, client, me, force = false }) {
  const file = avatarFile(instance, agent)
  if (!file) return 'none'
  if (me.avatar && !force) return 'kept'
  await client.patch('/users/@me', { avatar: `data:image/png;base64,${readFileSync(file).toString('base64')}` })
  return 'set'
}

/**
 * Registers the bot whose token is given for an Agent. Returns what happened and what is left for the
 * owner (invite it when it is not in the server yet). Throws a DiscordError when Discord refuses the token.
 */
export async function registerBot({ instance, agent, token, clientFor = t => discordClient(t), activate = gatewayLogin }) {
  const client = clientFor(token)
  const me = await client.get('/users/@me')
  const app = await client.get('/applications/@me')
  const warnings = []
  // Only the Manager reads messages (its plugin holds the gateway); Specialists only write.
  if (agent === 'manager' && !hasMessageContentIntent(app.flags)) {
    warnings.push('Message Content Intent looks OFF — Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent (required: the Manager reads the messages)')
  }
  let activated = true
  try { await activate(token) } catch (e) { activated = false; warnings.push(`gateway activation failed: ${e.message}`) }

  const tokenEnv = instance.settings.bots?.[agent]?.token_env ?? tokenEnvFor(agent)
  updateSettings(instance.workspaceDir, s => {
    s.bots = { ...s.bots, [agent]: { ...s.bots?.[agent], token_env: tokenEnv, user_id: me.id, app_id: app.id } }
  })

  let inServer = null
  if (instance.guildId) {
    try {
      await client.patch(`/guilds/${instance.guildId}/members/@me`, { nick: agentName(agent) })
      inServer = true
    } catch (e) {
      if (e.status === 404 || e.code === 10004) inServer = false
      else warnings.push(`could not set the display name: ${e.message}`)
    }
  }
  const avatar = await setAvatar({ instance, agent, client, me }).catch(e => { warnings.push(`could not set the avatar: ${e.message}`); return 'failed' })
  return {
    agent,
    username: me.username,
    user_id: me.id,
    app_id: app.id,
    activated,
    in_server: inServer,
    avatar,
    ...(inServer === false || !instance.guildId ? { invite_url: inviteUrl(app.id, agent) } : {}),
    warnings,
  }
}
