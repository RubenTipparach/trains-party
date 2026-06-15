# Discord Integration Guide - Trains Party

How Discord plugs into Trains Party: sign-in (identity), invites, and turn
notifications, layered on the authoritative game server. This guide is the
reference for the staged rollout in `design.md` and follows the patterns proven
in the sibling High Frontier fan game.

> **Doctrine:** REST is authoritative; Discord is an optional layer. Every
> Discord feature degrades gracefully when its env vars are unset, so the app
> runs fine with no Discord configured at all. Nothing here changes the pure,
> deterministic engine (see `CLAUDE.md` Section 2).

---

## 1. What Discord does here

| Capability | Requires | Summary |
| --- | --- | --- |
| **Sign in with Discord** | `CLIENT_ID` + `CLIENT_SECRET` | OAuth `identify`. The server mints a session; the player's name/avatar come from Discord. This is the primary identity. |
| **Room invites (DM)** | `BOT_TOKEN` (+ mutual guild) | The bot DMs a player a room link. Discord only delivers bot DMs to users who share a server with the bot. |
| **Auto-join the community server** | `BOT_TOKEN` + `GUILD_ID` + OAuth `guilds.join` | On sign-in, add the player to your Discord server so DM invites "just work". Optional. |
| **Channel announcements** | `WEBHOOK_URL` | Post "a room is looking for players" / "game finished" to a channel via webhook (no bot token needed). |
| **Turn notifications (DM)** | `BOT_TOKEN` | DM a human player when it becomes their turn. Optional. |

Identity model: **Discord sign-in is primary.** A signed-in user is identified
by their Discord snowflake; the server maps that user to a *seat* (`p1..p4`) in a
room. The engine still only ever sees anonymous seat ids, so determinism and
`rulesVersion` pinning are untouched.

---

## 2. Environment variables

All read at server boot from the environment (Fly secrets in production). Every
one is optional; features light up as their vars are provided.

| Variable | Purpose | Sensitivity |
| --- | --- | --- |
| `DISCORD_CLIENT_ID` | OAuth application id (sign-in) | Public |
| `DISCORD_CLIENT_SECRET` | OAuth token exchange | **Secret** |
| `DISCORD_BOT_TOKEN` | Send DMs (invites / turn pings) | **Secret** |
| `DISCORD_GUILD_ID` | Home server for `guilds.join` auto-add | Public |
| `DISCORD_WEBHOOK_URL` | Channel webhook for announcements | **Secret** |
| `DISCORD_REDIRECT_URI` | Override the OAuth callback URL | Optional |
| `SESSION_TTL_DAYS` | Session lifetime (default 30) | Optional |

Capability matrix:

- **Nothing set:** Discord dormant. Players use anonymous name-based seats (today's behaviour).
- **`CLIENT_ID` + `CLIENT_SECRET`:** "Sign in with Discord" works (identify only).
- **+ `BOT_TOKEN`:** DM invites and turn pings work for players who share a server with the bot.
- **+ `GUILD_ID`** (with `guilds.join` scope): sign-in auto-joins your server, so DMs reach everyone.
- **`WEBHOOK_URL`:** channel announcements, independent of all the above.

The server derives the redirect URI from the incoming request host unless
`DISCORD_REDIRECT_URI` is set (required behind a host-rewriting proxy).

---

## 3. Discord Developer Portal setup

1. <https://discord.com/developers/applications> -> **New Application**.
2. **OAuth2 -> General:** copy the **Client ID** and **Client Secret**.
3. **OAuth2 -> Redirects:** add, byte-for-byte:
   - `https://trains-party.fly.dev/auth/discord/callback` (production)
   - `http://localhost:8080/auth/discord/callback` (local dev)
4. **Bot:** add a bot, copy the **Bot Token**. Enable no privileged intents (DMs
   and `guilds.join` do not need them).
5. **Invite the bot** to your server with the `bot` scope so it shares a mutual
   guild with players (required for DM delivery). Copy the server's **Guild ID**
   (Developer Mode -> right-click server -> Copy Server ID).
6. **Channel webhook** (optional): Channel -> Edit -> Integrations -> Webhooks ->
   New Webhook -> copy URL.

Scopes used: `identify` (always), `guilds.join` (only if auto-join is enabled).

---

## 4. Database schema (server SQLite)

New tables alongside the existing `rooms` / `actions`:

```sql
-- A signed-in Discord user.
CREATE TABLE profiles (
  discord_id   TEXT PRIMARY KEY,        -- snowflake
  username     TEXT NOT NULL,
  display_name TEXT,
  avatar       TEXT,                    -- avatar hash or full URL
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Server-minted bearer sessions (the client stores the token).
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL REFERENCES profiles(discord_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One-time OAuth state, PERSISTED (not in-memory): on Fly the machine can
-- auto-stop while the user is on Discord's consent screen, which would wipe an
-- in-memory store and break every sign-in.
CREATE TABLE oauth_state (
  state      TEXT PRIMARY KEY,
  redirect   TEXT,                      -- where to send the user back in the app
  created_at INTEGER NOT NULL           -- 10-minute TTL, swept on use
);

-- Who holds each seat in a room. discord_id NULL = open seat or bot.
CREATE TABLE room_seats (
  room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  seat_id    TEXT NOT NULL,             -- p1..p4
  discord_id TEXT REFERENCES profiles(discord_id),
  name       TEXT NOT NULL,
  bot        INTEGER NOT NULL DEFAULT 0,
  level      TEXT,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (room_code, seat_id)
);

-- In-room chat (polled, since-id).
CREATE TABLE chat (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  discord_id TEXT REFERENCES profiles(discord_id),
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Pending invites (surfaced in the lobby; DM sent if the bot can reach them).
CREATE TABLE invites (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code           TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  inviter_discord_id  TEXT NOT NULL,
  invitee_discord_id  TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  accepted            INTEGER NOT NULL DEFAULT 0
);
```

Extend `rooms` with: `title`, `rules_version`, `seed`, `map_mode`, `options`
(JSON), `status` (`lobby|active|finished`), `creator_discord_id`, `max_players`.

Only the public Discord snowflake is stored for a link; clearing a session or
seat removes the association.

---

## 5. OAuth sign-in flow

```
Client                         Server                         Discord
  | POST /auth/discord/start ----> mint+persist `state`
  |                                build authorize URL  --------->
  | <----------- { url } ----------|
  | open `url` (popup/redirect) ---------------------------------> consent
  |                                <---- GET /auth/discord/callback?code&state
  |                                validate state (TTL, single-use)
  |                                POST /oauth2/token (code -> access token)
  |                                GET  /users/@me     (identify)
  |                                [if guilds.join] PUT /guilds/{id}/members/{me}
  |                                upsert profile, mint session token
  | <-- 302 /auth?token=...&name=- redirect back into the app
  | adopt token (localStorage), attach `Authorization: Bearer` to API calls
```

Endpoints:

- `GET  /auth/discord/enabled` -> `{ signIn: bool, autoJoin: bool }` (drives whether the button shows).
- `POST /auth/discord/start` -> `{ url, state }`. Persists `state` in `oauth_state`.
- `GET  /auth/discord/callback?code&state` -> exchanges code, upserts profile,
  mints a session, **302-redirects** back to the static frontend's `/auth` route
  with the token (the client "adopts" a session the server minted).
- `GET  /me` -> current profile from the bearer session, or 401.
- `POST /auth/logout` -> delete the session row.

Direct Discord REST calls (v10, no `discord.js`/gateway dependency):

- `POST /oauth2/token` (form-encoded: `client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `redirect_uri`)
- `GET  /users/@me` (Bearer access token) -> `id`, `username`, `avatar`
- `PUT  /guilds/{GUILD_ID}/members/{userId}` (Bot auth, `access_token` body) -> 201/204 on success (only when auto-join is on)

---

## 6. Room, invite, and notification endpoints

All room/seat/chat/invite endpoints require a valid bearer session.

| Method + path | Purpose |
| --- | --- |
| `POST /rooms` | Create a room (title, seed, options, max_players); seats the creator. |
| `GET  /rooms` | List `status=lobby` rooms looking for players. |
| `GET  /rooms/:code` | Room metadata + seat roster. |
| `GET  /rooms/:code/state?since=<seq>` | Snapshot / new actions since a sequence (polling). |
| `POST /rooms/:code/actions` | Submit one action; server validates via the engine. |
| `POST /rooms/:code/seats/:seatId/claim` `/release` | Take or free a seat. |
| `POST /rooms/:code/start` | Owner starts the game (open seats become bots). |
| `GET  /rooms/:code/chat?since=<id>` / `POST .../chat` | In-room chat (polled). |
| `POST /rooms/:code/invite` | `{ discordId }`; records an invite and DMs a room link. |

Server-side action validation (the authoritative check):

1. Resolve the bearer session -> `discord_id`.
2. The user must hold the seat named in `action.player` (`room_seats`).
3. It must be that seat's turn: `activePlayer(replay(state)) === action.player`.
4. Append to `actions`, bump the room sequence.

Bots run **server-side** on a tick so a game advances even when no client is
watching the room.

---

## 7. Direct Discord REST helpers (`server/src/discord.ts`)

Port the High Frontier module. All functions return `{ ok }` / `{ ok:false, error }`
and never throw; errors are truncated to ~200 chars.

- `discordEnabled()` - bot token present.
- `sendDM(userId, content)` - `POST /users/@me/channels` then `POST /channels/{id}/messages`; cache the DM channel per user, delete the cache entry on 404/403 to force a reopen. 1800-char cap.
- `isWebhookUrl(url)` / `sendWebhook(content, url)` - validate the `https://discord.com/api/webhooks/{id}/{token}` shape, then `POST` the content. No bot token needed.
- `oauthEnabled()` / `buildAuthorizeUrl(state, redirect)` / `completeOauth(code, redirect)` - identify (+ optional guilds.join).

---

## 8. Frontend wiring

- **Config:** add `PUBLIC_API_BASE` (the Fly server URL), injected at build time
  in `.github/workflows/deploy.yml` exactly like `BUILD_SHA`. The static client
  reads it to reach the server.
- **Auth store + `/auth` route:** adopt the server-minted token, persist it, and
  attach `Authorization: Bearer <token>` on every API call. Show "Sign in with
  Discord" only when `/auth/discord/enabled` reports `signIn: true`.
- **Fill in `lib/api/client.ts`** (currently stubbed) against Section 6.
- **Lobby (`routes/+page.svelte`):** add a server room browser + create-room next
  to the existing local games.
- **Board:** route `sandbox.svelte.ts`'s `act()` through `submitAction`, and
  hydrate from polled snapshots with **sequence gating** (a poll never stomps an
  in-progress local action). The board, panels, and animations are unchanged -
  the multiplayer UI *is* the sandbox UI (`CLAUDE.md` Section 3.5).
- **Chat panel:** a new tab, polled `since=<id>`; render names with seat colours
  (the `.player-name` convention, `CLAUDE.md` Section 4).
- **Invite UI:** copy-link plus "invite a Discord user"; per Section 4, the
  invite/navigate buttons come last in the popup and never mutate game state.

CORS: the Fly server must allow the GitHub Pages origin (`@fastify/cors`). The
OAuth callback redirects the browser, so it is not subject to CORS, but `/me`,
`/rooms`, and `/chat` XHRs are.

---

## 9. Deployment (Fly.io)

Set secrets once; they persist across deploys:

```sh
fly secrets set \
  DISCORD_CLIENT_ID=... \
  DISCORD_CLIENT_SECRET=... \
  DISCORD_BOT_TOKEN=... \
  DISCORD_GUILD_ID=... \
  DISCORD_WEBHOOK_URL=...
```

Local dev:

```sh
cd server
DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... DISCORD_BOT_TOKEN=... \
DISCORD_GUILD_ID=... DATA_DIR=./data npm run dev
```

The deploy workflow can stage these from GitHub Actions secrets to Fly before
deploying (gated on `FLY_API_TOKEN`, like the existing API job). If a token or
secret leaks, reset it in the Developer Portal - the old value is immediately
invalid.

---

## 10. Security notes

- **Persist OAuth `state`** in SQLite (not memory): single-use, 10-minute TTL.
  Fly machines auto-stop, which would wipe an in-memory store mid-sign-in.
- **Validate the webhook URL** against Discord's host/shape before saving or
  posting; reject typos rather than leaking content to an arbitrary host.
- **Session tokens** are random and opaque, stored server-side with an expiry;
  `logout` deletes the row.
- **Never trust the client** for revenue, turn ownership, or seat identity - the
  server re-validates every action against the replayed state.
- **Snowflakes are public**, but treat bot/client secrets as sensitive and keep
  them out of commits, logs, and the static client bundle.

---

## 11. Suggested rollout (stages gate on verification - `CLAUDE.md` Section 3.8)

1. Extract the engine into a shared package both `frontend/` and `server/` import (prerequisite for authoritative validation).
2. Authoritative server core: rooms + action log + state sync + fixture-replay tests (no Discord yet).
3. Discord sign-in: `profiles` / `sessions` / `oauth_state`, the auth endpoints, the frontend auth store, CORS/config.
4. Lobby + seat claiming + server-side bots.
5. In-room chat.
6. Invites + DM/webhook notifications.
7. Deploy: Fly secrets, `deploy.yml` wiring, redirect URIs, CORS origins.
