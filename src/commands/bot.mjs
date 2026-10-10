// crelio bot add <agent> | invite [<agent>] | avatars [--force] | list
// Tokens are read from workspace/.env or typed into a hidden prompt — never passed on the command line,
// never seen by an agent, never posted in Discord.

import { createInterface } from 'node:readline'
import { ConfigError, agentName, loadInstance, setSecret } from '../instance.mjs'
import { inviteUrl } from '../permissions.mjs'
import { PORTAL_STEPS, registerBot, setAvatar, tokenEnvFor } from '../bots.mjs'
import { discordClient } from '../discord.mjs'

export { PORTAL_STEPS }

function hiddenPrompt(question) {
  if (!process.stdin.isTTY) return Promise.resolve('')
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s) } // echo the question, not the token
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()) })
  })
}

export async function addBot({ workspace, repoDir, agent, log = console.log }) {
  if (!agent || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(agent)) throw new ConfigError('Usage: crelio bot add <agent id>   (e.g. manager, coder, kb-researcher)')
  let instance = loadInstance(workspace, { repoDir })
  const tokenEnv = instance.settings.bots?.[agent]?.token_env ?? tokenEnvFor(agent)
  let token = instance.secret(tokenEnv)
  if (!token) {
    log(`\nBot for the ${agentName(agent)} agent — create it in the Discord Developer Portal:${PORTAL_STEPS(agent)}\n  (or paste the token below, hidden, instead of step 4)\n`)
    token = await hiddenPrompt(`Token for ${agentName(agent)} (hidden): `)
    if (!token) throw new ConfigError(`No token given. Put it in workspace/.env as ${tokenEnv}=… and run "crelio bot add ${agent}" again.`)
    setSecret(workspace, tokenEnv, token)
    instance = loadInstance(workspace, { repoDir })
  }

  const r = await registerBot({ instance, agent, token }).catch(e => {
    if (e.name === 'DiscordError' && e.status === 401) throw new ConfigError(`The ${tokenEnv} token was refused by Discord (${e.message}) — reset it in the Developer Portal and try again`)
    throw e
  })
  log(`✔ token valid — bot "${r.username}" (${r.user_id})`)
  if (r.activated) log('✔ activated on the gateway (required once before a bot can post)')
  for (const w of r.warnings) log(`⚠ ${w}`)
  if (r.in_server) log(`✔ display name in the server set to "${agentName(agent)}"`)
  if (r.avatar === 'set') log('✔ avatar set')
  else if (r.invite_url) log(`→ ${r.in_server === false ? 'not in the server yet — invite it' : 'invite it to your server'}:\n  ${r.invite_url}`)
  return { agent, user_id: r.user_id, app_id: r.app_id }
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
  if (sub === 'avatars') {
    // Each registered bot gets its Agent's avatar (assets/avatars/, or workspace/avatars/ first).
    const force = rest.includes('--force')
    for (const [a, b] of Object.entries(instance.settings.bots ?? {})) {
      const token = instance.secret(b.token_env)
      if (!token) { console.log(`${agentName(a).padEnd(16)} ✖ no token`); continue }
      try {
        const client = discordClient(token)
        const r = await setAvatar({ instance, agent: a, client, me: await client.get('/users/@me'), force })
        console.log(`${agentName(a).padEnd(16)} ${{ set: '✔ avatar set', kept: '· has one already (--force to replace)', none: '· no avatar file' }[r]}`)
      } catch (e) { console.log(`${agentName(a).padEnd(16)} ✖ ${e.message}`) }
    }
    return
  }
  if (sub === 'list' || !sub) {
    for (const [a, b] of Object.entries(instance.settings.bots ?? {})) {
      console.log(`${agentName(a).padEnd(16)} ${instance.secret(b.token_env) ? '✔ token' : '✖ no token'}  ${b.user_id ? `bot ${b.user_id}` : 'not registered'}`)
    }
    return
  }
  throw new ConfigError('Usage: crelio bot add <agent> | invite [<agent>] | avatars [--force] | list')
}
