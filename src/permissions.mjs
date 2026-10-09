// Discord permission sets for invite links.

const P = {
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  ADMINISTRATOR: 1n << 3n,
}

/** Specialists: talk, attach, react, open Side threads, send Voice notes — nothing administrative. */
export const SPECIALIST_PERMISSIONS = [
  P.VIEW_CHANNEL, P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS, P.CREATE_PUBLIC_THREADS, P.EMBED_LINKS,
  P.ATTACH_FILES, P.READ_MESSAGE_HISTORY, P.ADD_REACTIONS, P.USE_EXTERNAL_EMOJIS, P.SEND_VOICE_MESSAGES,
].reduce((a, b) => a | b, 0n).toString()

/** The Manager sets up the server (categories, channels, roles) and manages threads: Administrator. */
export const MANAGER_PERMISSIONS = P.ADMINISTRATOR.toString()

export function inviteUrl(appId, agent) {
  const permissions = agent === 'manager' ? MANAGER_PERMISSIONS : SPECIALIST_PERMISSIONS
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${permissions}`
}

// Application flags: message content intent enabled (full or "limited" for bots in < 100 servers).
export const hasMessageContentIntent = flags => ((flags ?? 0) & ((1 << 18) | (1 << 19))) !== 0
