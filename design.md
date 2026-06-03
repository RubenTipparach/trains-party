# Trains Party — Design Document

A modern, web-based port of the **1889: History of Shikoku Railways** 18xx game.

> **Reference implementation:** [tobymao/18xx](https://github.com/tobymao/18xx) — the
> canonical open-source 18xx engine (Ruby). This document references it heavily so any
> agent or contributor can cross-check rules, data, and engine behaviour against the
> source of truth. When in doubt about a rule, find the matching file under
> `lib/engine/` in that repository.
>
> **1889 rulebook (PDF):**
> [Official rules](https://drive.google.com/file/d/14NH7j0hhTQDvJKcP2Qa6mC2Blki14Q0-/view) —
> the authoritative source for 1889's rules and numbers. Cross-check against this PDF and
> the reference engine's `lib/engine/game/g_1889/` before implementing any mechanic.

---

## 1. Goals

1. Implement a modern JavaScript/TypeScript stack (no Ruby/Opal).
2. Deploy the server on the **Fly.io** stack; serve the client from **GitHub Pages**.
3. Deliver a **beautiful, animated UI** that delights 18xx players — the board, tiles,
   trains, stock market, and money must feel tactile and recognisable.
4. Focus exclusively on **1889** first. It is the most approachable 18xx title:
   compact Shikoku map, no loans, no mergers, simple share mechanics.
5. Keep the rules engine **deterministic and replayable** (see §6).

Non-goals (for now): other 18xx titles, loans, mergers, off-board bonus complexity
beyond what 1889 needs, mobile-native apps.

---

## 2. How the reference 18xx engine works

The reference repo ([tobymao/18xx](https://github.com/tobymao/18xx)) is ~99% Ruby. The
browser client is the same Ruby compiled to JavaScript via **Opal**, so the engine runs
identically on server and client. We are *not* copying that approach — but its
**architecture** is the blueprint we port to TypeScript.

### 2.1 Repository layout (reference)

| Path | Responsibility |
| --- | --- |
| `lib/engine/` | The game engine (rules, state, all game definitions) |
| `lib/engine/game/` | One subfolder per title, e.g. `g_1889/` |
| `lib/engine/round/` | Round types — `stock`, `operating`, `auction`, `draft`, `merger` |
| `lib/engine/step/` | ~67 reusable "steps" — the atomic interaction units |
| `lib/engine/action/` | Serializable player actions (the replay log entries) |
| `lib/engine/part/` | Board parts — tiles, hexes, cities, towns, paths, labels |
| `lib/engine/ability/` | Private-company / corporation special abilities |
| `assets/`, `public/` | Frontend assets and JSON game **fixtures** |
| `spec/` | RSpec tests, largely fixture-replay based |
| `models/`, `routes/`, `db/` | Rack web server, persistence (PostgreSQL) |

### 2.2 The core abstractions

The engine is a **deterministic state machine** driven by an ordered list of actions.

- **Game** (`game.rb` + `game/g_1889/game.rb`) — the aggregate root. Holds players,
  corporations, the bank, stock market, the map (hexes/tiles), the train depot, phases,
  and the current round. Each title subclasses the base game and declares its static
  configuration as constants (cash, certificate limits, trains, market, map, companies).
- **Entity** (`entity.rb`) — base for anything that can own things or act: `Player`,
  `Corporation`, `Minor`, `Company` (private), the `Bank`, the `SharePool`, `Depot`.
- **Phase** (`phase.rb`) — global progression (2 → 3 → 4 → 5 → 6 → D in 1889). A phase
  change is triggered by buying the first train of a new type. Phases gate tile colours,
  train rusting, operating-round count, and certificate-limit changes.
- **Round** (`round/*.rb`) — a span of play with a turn order. The two that matter for
  1889 are the **Stock Round** (players buy/sell shares, set par prices) and the
  **Operating Round** (corporations lay track, place tokens, run trains, pay dividends,
  buy trains). The opening **Auction/Draft** distributes the private companies.
- **Step** (`step/*.rb`) — the atomic interaction primitive. A round is composed of an
  ordered list of steps. Each step answers three questions:
  1. *Who can act?* (`active_entities`)
  2. *What actions are legal right now?* (`actions(entity)`)
  3. *How is an action applied?* (`process_<action>`)
  Steps are highly reusable across titles. Relevant ones for 1889:
  `waterfall_auction` (private company auction), `buy_sell_par_shares` (stock round),
  `track` / `special_track` (lay tile), `token` / `special_token` (place station),
  `route` (choose train routes), `dividend` (payout vs withhold), `buy_train`,
  `discard_train`, `emergency_money` (forced train purchase).
- **Action** (`action/*.rb`) — a **serializable, replayable** record of a single
  player decision (e.g. `LayTile`, `BuyShares`, `RunRoutes`, `Dividend`, `BuyTrain`,
  `Pass`). Actions are the *only* way state changes.

### 2.3 The action-log / replay model (the key idea we keep)

A game's entire state is a function of: **static config + ordered action list**.

```
state = reduce(initialState(config), actions)
```

- The server stores the **action list**, not snapshots. Game state is recomputed by
  replaying actions from the start (with periodic memoization for performance).
- This makes games **deterministic, auditable, and reproducible**. Test "fixtures" are
  just JSON action lists; a test replays them and asserts the final state.
- **Pinning:** because rules can change, each stored game is pinned to a code version so
  old games keep replaying correctly. We adopt the same idea (a `rulesVersion` per game).

### 2.4 Board model

The map is a hex grid. Each **hex** has a coordinate and holds a **tile**. A tile is
made of **parts**: `path` segments (track), `city`/`town` revenue centres with token
slots, `label`s, and upgrade rules. Laying track = upgrading a hex's tile to a
higher-colour tile whose paths preserve existing connections. **Routes** are computed by
a graph traversal (`graph.rb`) over connected paths a corporation's trains can run, then
scored against revenue centres for the current phase.

---

## 3. 1889 game specifics (target scope)

Source of truth: the
[1889 rulebook (PDF)](https://drive.google.com/file/d/14NH7j0hhTQDvJKcP2Qa6mC2Blki14Q0-/view)
and [`lib/engine/game/g_1889/`](https://github.com/tobymao/18xx/tree/master/lib/engine/game/g_1889).

- **Players:** 2–6. **Starting cash:** 420 (2–4p), 390 (5–6p).
- **Bank:** 7,000. **Certificate limit:** 25 (2p) … 11 (6p).
- **Map:** Shikoku island, Japan.
- **Private companies (6):** Takamatsu E-Railroad, Mitsubishi Ferry, Ehime Railway,
  Sumitomo Mines Railway, Dougo Railway, South Iyo Railway — with values 20–90 and
  revenues 5–25, plus special tile/token/discount abilities.
- **Corporations:** ten 10-share public companies (e.g. AR, IR, SR, KO, TR, KU, etc.),
  par-priced when floated.
- **Trains:**
  | Train | Cost | Qty | Rusts when |
  | --- | --- | --- | --- |
  | 2 | 80 | 6 | 4-train bought |
  | 3 | 180 | 5 | 6-train bought |
  | 4 | 300 | 4 | D-train bought |
  | 5 | 450 | 3 | — (closes private cos) |
  | 6 | 630 | 2 | — |
  | D (diesel) | 1,100 | ∞ | — (phase 6) |
- **Phases:** 2, 3, 4, 5, 6, D — gate tile colours (yellow→green→brown), OR count
  (1→2→3), and rusting.
- **Stock market:** 2D grid, values ~10–350, par values 'p' around 75–100.
- **Game flow:** initial private auction → alternating Stock Rounds and Operating Rounds
  → ends on bank break / stock-market ceiling. No loans, no mergers.

---

## 4. Target architecture

A **distributed deploy** that mirrors the proven model from the High Frontier fan game
(see `CLAUDE.md`): client and server are independently versioned and deployed.

```
┌──────────────────────┐         REST (authoritative)         ┌───────────────────────┐
│  Frontend (Pages)    │  ── poll / actions ───────────────▶  │  Server (Fly.io)      │
│  SvelteKit + TS      │  ◀── snapshots ──────────────────    │  Node + TS + SQLite   │
│  static adapter      │     (optional WS acceleration)        │  action log + replay  │
└──────────────────────┘                                       └───────────────────────┘
```

### 4.1 Frontend — SvelteKit + TypeScript

- **Why Svelte:** first-class, GPU-friendly transitions/animations out of the box; tiny
  bundles; excellent SVG ergonomics for the hex map, tiles, trains, and the stock-market
  grid. Ideal for the "delight" goal.
- **Build:** `@sveltejs/adapter-static` → fully static site hosted on **GitHub Pages**.
  `paths.base` is set from `BASE_PATH` so it works under `/<repo>/`.
- **Structure:**
  - `src/lib/engine/` — the **ported TypeScript rules engine** (shared shape with the
    server; eventually extracted to a shared package). Pure, deterministic, no I/O.
  - `src/lib/api/` — REST client + polling loop + snapshot/diff applier.
  - `src/lib/components/` — `HexMap`, `Tile`, `StockMarket`, `TrainRoster`,
    `CorporationCard`, `PlayerPanel`, etc.
  - `src/lib/anim/` — animation helpers (tile placement, train runs, money transfers,
    stock-token slides).
  - `src/routes/` — lobby, room (`/room/<CODE>`), sandbox.

### 4.2 Backend — Node + TypeScript + SQLite on Fly.io

- Single Node process (Fastify or Express) in TypeScript.
- **SQLite** on a Fly **volume** for persistence (single-machine, like high-frontier).
- Stores the **action log** per game (not snapshots); replays to derive state; the
  engine code is shared with the client so validation is identical.
- REST is **authoritative**; WebSocket is a best-effort accelerator (see §5).
- Endpoints (initial sketch): `POST /rooms`, `GET /rooms/:code`,
  `POST /rooms/:code/actions`, `GET /rooms/:code/state?since=<seq>`.

### 4.3 The engine is shared, pure, and isomorphic

The TypeScript engine (state model + reducer over actions) is written once and runs in
both the browser (instant local sandbox / optimistic UI) and the server (authoritative
validation). This is the modern analogue of the reference repo's Opal trick — one
engine, two runtimes — without compiling Ruby.

---

## 5. Multiplayer reliability doctrine (inherited)

Adopted wholesale from the High Frontier fan game (documented in `CLAUDE.md`):

- **REST is authoritative; WebSocket is a best-effort optimisation, not a transport
  guarantee.** Never treat a WS broadcast as delivery.
- **Clients poll** (e.g. 5s normal, faster during auctions) and cache the latest
  snapshot. Turn-ownership and budget checks read from cached state.
- **Sequence gating:** only a snapshot with a *new* action sequence number triggers
  re-hydration, so polling never stomps in-progress local UI.
- **Snapshot/diff animation:** compare new snapshot to last-applied, drive animations
  *from* old *to* new state, commit hydrators only after the animation completes.
- **Room lives in the URL** (`/room/<CODE>`) so refreshes, reconnects, and deploy-time
  reloads preserve the session.

---

## 6. Engine porting principles

1. **Deterministic reducer.** `nextState = apply(state, action)`. No randomness outside
   seeded shuffles recorded in the action log.
2. **Actions are the only mutation.** Everything serialisable; the log is the game.
3. **Steps as a state machine.** Port the round→step→action structure: each step exposes
   `activeEntities`, `legalActions`, and `apply`. Start with 1889's needs only.
4. **Static config as data.** 1889's cash, trains, market, map, and companies live as
   typed data modules — the single source of truth, mirroring the reference constants.
   *If a rule/number isn't in the config data, it doesn't exist yet.*
5. **Fixture-replay tests.** Author JSON action lists; assert replayed state. Port a few
   reference fixtures from `public/fixtures` for 1889 as ground truth where feasible.
6. **Rules versioning / pinning** per game so future rule fixes don't break old games.

---

## 7. Build order (stages)

Incremental, each stage gated on verification before the next (mirrors the high-frontier
"stages" discipline):

- **Stage 0 — Scaffold & CI (this stage).** Monorepo, SvelteKit client, Node/SQLite
  server stubs, CI deploy to Pages + Fly.io. No game logic.
- **Stage 1 — Static data & read-only render.** 1889 config data modules; render the
  Shikoku hex map, stock market, train roster, corporation cards (no interaction).
- **Stage 2 — Engine core.** State model, action reducer, phase/round/step skeleton,
  private-company auction, stock round.
- **Stage 3 — Operating round.** Track laying, token placement, route finding & revenue,
  dividends, train buying, rusting.
- **Stage 4 — Multiplayer.** Server action log + replay, polling, rooms, optional WS.
- **Stage 5 — Polish.** Animations, sound, spectating, end-game scoring & summary.

---

## 8. Repository layout (this project)

```
trains-party/
├── design.md            ← this file
├── CLAUDE.md            ← agent/dev guide + lessons learned + workflow rules
├── README.md
├── .github/workflows/deploy.yml   ← Pages + Fly.io deploy (gated)
├── frontend/            ← SvelteKit + TS (deploys to GitHub Pages)
│   └── src/lib/{engine,api,components,anim,data}
└── server/              ← Node + TS + SQLite (deploys to Fly.io)
    ├── Dockerfile
    └── fly.toml
```

---

## 9. Open questions / decisions to revisit

- Final corporation set and exact stock-market grid for 1889 (transcribe from reference
  `g_1889/` once Stage 1 begins).
- Whether to extract the engine into a third shared workspace package vs. importing the
  client copy from the server.
- Seeded RNG strategy for the private-company auction order (must be in the action log).
- Spectator and async-vs-realtime UX details.

When any of these (or new requirements) are ambiguous, **use planning mode and ask**
before building — see `CLAUDE.md`.

---

## 10. Reference rulebooks & future titles

Sources for the games we implement (or plan to). When adding a title, add an entry
to `frontend/src/lib/data/games.ts` (the menu's catalog) and record its sources here.

**Engine reference (all titles):** [tobymao/18xx](https://github.com/tobymao/18xx)
— check `lib/engine/game/g_<title>/` for rules, numbers, and mechanics before
implementing. Not every published game has a port there (see RoLA below).

**1889: History of Shikoku Railways** — Grand Trunk Games, Yasutaka Ikeda.
- Rulebook (PDF): https://drive.google.com/file/d/14NH7j0hhTQDvJKcP2Qa6mC2Blki14Q0-/view
- Reference engine: [`lib/engine/game/g_1889/`](https://github.com/tobymao/18xx/tree/master/lib/engine/game/g_1889)
- Status: **implemented**.

**Railways of the Lost Atlas** — Asterisk Games.
- Rulebooks index: https://www.asterisk-games.com/rulebook
- Title page: https://www.asterisk-games.com/railwaysofthelostatlas
- BoardGameGeek: https://boardgamegeek.com/boardgame/365357/railways-of-the-lost-atlas
- Status: **listed in the menu, rules not yet ported.** Notes for the eventual
  port: the map is **built by players during setup** (no fixed map module), and
  minor companies **merge into majors** — neither mechanic exists in our engine
  yet, and there is **no `tobymao` reference**, so it is a multi-stage effort. The
  **solo mode ships with the expansion** and is out of scope for now.
