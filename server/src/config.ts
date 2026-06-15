/**
 * Runtime configuration, read once from the environment. Every Discord feature
 * degrades gracefully when its vars are unset (see discord-integration.md): the
 * server runs fine with no Discord configured at all.
 */

const DAY = 86_400_000;

const clientId = process.env.DISCORD_CLIENT_ID ?? '';
const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? '';
const botToken = process.env.DISCORD_BOT_TOKEN ?? '';
const guildId = process.env.DISCORD_GUILD_ID ?? '';

export const CFG = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  rulesVersion: process.env.RULES_VERSION ?? 'dev',
  /** Frontend base URL (incl. any base path), for post-auth redirects + room links. */
  appBaseUrl: (process.env.APP_BASE_URL ?? '').replace(/\/$/, ''),
  /** Allowed CORS origins (comma-separated). Empty = reflect the request origin. */
  corsOrigins: (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  sessionTtlMs: Number(process.env.SESSION_TTL_DAYS ?? 30) * DAY,
  adminTtlMs: 2 * DAY,
  discord: {
    clientId,
    clientSecret,
    botToken,
    guildId,
    /** Explicit callback override (needed behind a host-rewriting proxy). */
    redirectUri: process.env.DISCORD_REDIRECT_URI ?? '',
    /** Sign-in is possible when the OAuth app is configured. */
    signIn: !!(clientId && clientSecret),
    /** Auto-add players to the guild on sign-in so bot DMs can reach them. */
    autoJoin: !!(clientId && clientSecret && guildId && botToken)
  },
  /** Discord ids allowed into /admin, seeded into server_settings on boot. */
  adminDiscordIds: (process.env.ADMIN_DISCORD_IDS ?? process.env.ADMIN_DISCORD_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
};

export const now = () => Date.now();
