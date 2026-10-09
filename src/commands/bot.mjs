// crelio bot add <agent> | invite [<agent>] | list
// Tokens are read from workspace/.env or typed into a hidden prompt — never passed on the command line,
// never seen by an agent, never posted in Discord.

import { createInterface } from 'node:readline'
import { ConfigError, agentName, loadInstance, setSecret, updateSettings } from '../instance.mjs'
import { discordClient } from '../discord.mjs'
import { gatewayLogin } from '../gateway.mjs'
import { hasMessageContentIntent, inviteUrl } from '../permissions.mjs'

const tokenEnvFor = agent => `DISCORD_TOKEN_${agent.toUpperCase().replace(/-/g, '_')}`

function hiddenPrompt(question) {
  if (!process.stdin.isTTY) return Promise.resolve('')
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s) } // echo the question, not the token
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()) })
  })
}

export const PORTAL_STEPS = agent => `
  1. https://discord.com/developers/applications → "New Application" → name it "${agentName(agent)}" → Create
  2. "Installation" → Install Link: "Discord Provided Link" → Default Install Settings → Guild Install →
     scopes: bot → Permissions: ${agent === 'manager'
       ? '"Administrator"'
       : 'View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links,\n     Attach Files, Read Message History, Add Reactions, Use External Emojis, Send Voice Messages'} → Save Changes
  3. "Bot" → "Reset Token" → copy it (shown once); Privileged Gateway Intents → "Message Content Intent" ON;
     "Public Bot" OFF → Save Changes
  4. Paste the token below (hidden), or put it in workspace/.env as ${tokenEnvFor(agent)}=… and run this again
  5. "Installation" → copy the Install Link → open it → Add to server → Authorize`

export async function addBot({ workspace, repoDir, agent, log = console.log }) {
  if (!agent || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(agent)) throw new ConfigError('Usage: crelio bot add <agent id>   (e.g. manager, coder, kb-researcher)')
  let instance = loadInstance(workspace, { repoDir })
  const tokenEnv = instance.settings.bots?.[agent]?.token_env ?? tokenEnvFor(agent)
  let token = instance.secret(tokenEnv)
  if (!token) {
    log(`\nBot for the ${agentName(agent)} agent — create it in the Discord Developer Portal:${PORTAL_STEPS(agent)}\n`)
    token = await hiddenPrompt(`Token for ${agentName(agent)} (hidden): `)
    if (!token) throw new ConfigError(`No token given. Put it in workspace/.env as ${tokenEnv}=… and run "crelio bot add ${agent}" again.`)
    setSecret(workspace, tokenEnv, token)
  }

  const client = discordClient(token)
  const me = await client.get('/users/@me').catch(e => { throw new ConfigError(`The ${tokenEnv} token was refused by Discord (${e.message}) — reset it in the Developer Portal and try again`) })
  const app = await client.get('/applications/@me')
  log(`✔ token valid — bot "${me.username}" (${me.id})`)
  if (!hasMessageContentIntent(app.flags)) {
    log(`⚠ Message Content Intent looks OFF — Bot tab → Privileged Gateway Intents → Message Content Intent${agent === 'manager' ? ' (required for the Manager: it reads the messages)' : ''}`)
  }
  await gatewayLogin(token).then(
    () => log('✔ activated on the gateway (required once before a bot can post)'),
    e => log(`⚠ gateway activation failed: ${e.message}`),
  )

  updateSettings(workspace, s => {
    s.bots = { ...s.bots, [agent]: { ...s.bots?.[agent], token_env: tokenEnv, user_id: me.id, app_id: app.id } }
  })
  instance = loadInstance(workspace, { repoDir })

  const guild = instance.guildId
  if (guild) {
    try {
      await client.patch(`/guilds/${guild}/members/@me`, { nick: agentName(agent) })
      log(`✔ display name in the server set to "${agentName(agent)}"`)
    } catch (e) {
      if (e.status === 404 || e.code === 10004) log(`→ not in the server yet — invite it:\n  ${inviteUrl(app.id, agent)}`)
      else log(`⚠ could not set the display name: ${e.message}`)
    }
  } else {
    log(`→ invite it to your server:\n  ${inviteUrl(app.id, agent)}`)
  }
  return { agent, user_id: me.id, app_id: app.id }
}

export default async function bot({ workspace, repoDir, sub, rest }) {
  if (sub === 'add') return addBot({ workspace, repoDir, agent: rest[0] })
  const instance = loadInstance(workspace, { repoDir })
  if (sub === 'invite') {
    const agents = rest[0] ? [rest[0]] : Object.keys(instance.settings.bots ?? {})
    for (const a of agents) {
      const appId = instance.settings.bots?.[a]?.app_id
      console.log(`${agentName(a).padEnd(16)} ${appId ? inviteUrl(appId, a) : `(no bot yet — crelio bot add ${a})`}`)
    }
    return
  }
  if (sub === 'list' || !sub) {
    for (const [a, b] of Object.entries(instance.settings.bots ?? {})) {
      console.log(`${agentName(a).padEnd(16)} ${instance.secret(b.token_env) ? '✔ token' : '✖ no token'}  ${b.user_id ? `bot ${b.user_id}` : 'not registered'}`)
    }
    return
  }
  throw new ConfigError('Usage: crelio bot add <agent> | invite [<agent>] | list')
}
