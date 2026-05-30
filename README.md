# Trains Party

A modern, animated web port of **1889: History of Shikoku Railways**, the most
approachable game in the 18xx family.

- **Frontend:** SvelteKit + TypeScript, static-built, hosted on **GitHub Pages**.
- **Server:** Node + TypeScript + SQLite, hosted on **Fly.io**.
- **Engine:** a pure, deterministic, action-log TypeScript rules engine shared by both.

Built as a TypeScript port of the architecture pioneered by the canonical
[tobymao/18xx](https://github.com/tobymao/18xx) engine. See **[design.md](./design.md)**
for the full design and **[CLAUDE.md](./CLAUDE.md)** for the development guide and the
board-game-service lessons we follow.

## Quick start

```bash
# Frontend
cd frontend && npm install && npm run dev

# Server (in another terminal)
cd server && npm install && npm run dev
```

## Layout

```
frontend/   SvelteKit client  →  GitHub Pages
server/     Node/SQLite API    →  Fly.io
design.md   architecture + 1889 scope
CLAUDE.md   dev guide, engine principles, lessons learned, workflow rules
```

## One-time setup (repo owner)

- **GitHub Pages:** Settings → Pages → Source: GitHub Actions.
- **Fly.io:** create the app + a data volume, then add the `FLY_API_TOKEN` repository
  secret. Until that secret exists, CI deploys the client and **skips** the Fly job with
  a notice.

## Status

Stage 0 — scaffolding and CI. See `design.md` §7 for the build roadmap.
