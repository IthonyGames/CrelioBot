// crelio calls install | enable <kb> | disable <kb> | status — the optional Call service (ADR-0007).
// Discord voice needs libraries the core does without: the DAVE encryption Discord requires is native code.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, loadInstance, updateKbProfile } from '../instance.mjs'
import { callsInstalled } from '../launcher.mjs'
import { serviceFile } from '../calls.mjs'
import { discordClient } from '../discord.mjs'
import { provisioner } from '../provision.mjs'
import { writeAccess } from '../runtime.mjs'

export default async function calls({ workspace, repoDir, sub, rest = [] }) {
  if (sub === 'install') {
    const dir = join(repoDir, 'calls')
    console.log('Installing the Call service (discord.js, @discordjs/voice, @snazzah/davey) in calls/ …')
    const command = `npm ${existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install'} --no-audit --no-fund`
    const res = spawnSync(command, { cwd: dir, stdio: 'inherit', shell: true })
    if (res.status !== 0) throw new ConfigError('npm failed — check your internet connection and Node 22.12+, then run "crelio calls install" again')
    console.log('✔ installed. Restart CrelioBot (stop, then start): a "CrelioBot - Calls" window joins the others.\n  Then ask a Manager in Discord: "turn on Calls" — it creates the voice channel.')
    return
  }
  if (sub === 'enable' || sub === 'disable') {
    // The same as asking a Manager in Discord (call_setup), for the owner at the PC.
    const instance = loadInstance(workspace, { repoDir })
    const kb = instance.kb(rest[0] ?? '')
    const d = kb.discord ?? {}
    if (sub === 'enable') {
      if (!d.category_id) throw new ConfigError(`KB "${kb.id}" has no Discord category yet — run "crelio discord provision" first`)
      const name = (kb.language ?? instance.language) === 'fr' ? 'Appel' : 'Call'
      const ch = await provisioner({ client: discordClient(instance.requireToken(kb.id, 'manager')), guildId: instance.guildId }).ensureChannel({ id: d.call_id, name, type: 2, parent_id: d.category_id })
      updateKbProfile(workspace, kb.id, k => { k.discord = { ...k.discord, call_id: ch.id }; k.call = { ...k.call, enabled: true } })
      console.log(`✔ Calls on for ${kb.name ?? kb.id} — voice channel "${name}" (${ch.id})${callsInstalled(repoDir) ? '' : '\n  → install the Call service: crelio calls install, then restart'}`)
    } else {
      updateKbProfile(workspace, kb.id, k => { k.call = { ...k.call, enabled: false } })
      console.log(`✔ Calls off for ${kb.name ?? kb.id} (the voice channel stays)`)
    }
    writeAccess(loadInstance(workspace, { repoDir }), kb.id)
    return
  }
  if (sub === 'status' || !sub) {
    const instance = loadInstance(workspace, { repoDir })
    console.log(`Call service: ${callsInstalled(repoDir) ? 'installed' : 'not installed (crelio calls install)'}`)
    try { console.log(`Running on port ${JSON.parse(readFileSync(serviceFile(instance), 'utf8')).port}`) } catch { console.log('Not running') }
    for (const kb of instance.kbs.values()) {
      console.log(`${kb.id.padEnd(16)} ${kb.call?.enabled ? `Calls on — voice channel ${kb.discord?.call_id ?? '(none)'}` : 'Calls off'}`)
    }
    return
  }
  throw new ConfigError('Usage: crelio calls install | enable <kb> | disable <kb> | status')
}
