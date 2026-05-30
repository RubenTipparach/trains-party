# CLAUDE.md — Trains Party

Guidance for Claude (and humans) working in this repo. Read `design.md` first for the
full architecture and the 1889 scope.

> **Reference engine:** [tobymao/18xx](https://github.com/tobymao/18xx). When a rule,
> number, or mechanic is unclear, check `lib/engine/` (and `lib/engine/game/g_1889/`)
> there before guessing.

---

## 0. Working agreement (read this first)

- **If you have any questions, use planning mode.** When requirements, rules, scope, or
  approach are ambiguous, STOP and enter plan mode / ask before writing code. Do not
  guess at game rules, deployment topology, or product decisions. A wrong assumption in
  an 18xx rules engine is expensive to unwind. Prefer one good question over a confident
  mistake.
- Work in incremental **stages** (see `design.md` §7). Each stage gates on verification
  before the next. Note the stage in commit messages.
- Keep the engine **pure and deterministic** (see §2).

---

## 1. Project shape

A distributed, independently-deployed app:

- **`frontend/`** — SvelteKit + TypeScript, built static with `adapter-static`, hosted on
  **GitHub Pages**. No SSR. `paths.base` comes from `BASE_PATH` env so it works under
  `/<repo>/`.
- **`server/`** — Node + TypeScript + SQLite, hosted on **Fly.io** (single machine + a
  data volume). Stores the per-game **action log** and replays it to derive state.

Both deploy independently from one CI workflow (`.github/workflows/deploy.yml`).

### Common commands

| Where | Command | Does |
| --- | --- | --- |
| `frontend/` | `npm install` | install deps |
| `frontend/` | `npm run dev` | local dev server |
| `frontend/` | `npm run build` | static build into `frontend/build` |
| `frontend/` | `npm run check` | svelte-check / typecheck |
| `server/` | `npm install` | install deps |
| `server/` | `npm run dev` | run server with tsx watch |
| `server/` | `npm run build` | tsc → `server/dist` |
| `server/` | `npm start` | run compiled server |

---

## 2. Engine principles (non-negotiable)

These come from how the reference 18xx engine works and keep games reproducible:

1. **Deterministic reducer.** State is a pure function of static config + an ordered
   action list: `state = reduce(initialState(config), actions)`.
2. **Actions are the only mutation.** Every state change is a serializable action
   appended to the log. The log *is* the game; the server stores actions, not snapshots.
3. **Steps as a state machine.** Port the reference round → step → action structure. Each
   step exposes `activeEntities`, `legalActions(entity)`, and `apply(action)`.
4. **Static data is the single source of truth.** 1889's cash, trains, stock market,
   map, and companies live in typed data modules. *If a number isn't in the data, it
   doesn't exist yet.* No hand-scattered magic constants.
5. **Fixture-replay tests.** Tests are JSON action lists replayed to an asserted state.
6. **Rules versioning / pinning.** Each game records the `rulesVersion` it was created
   under so future rule fixes don't corrupt old games.
7. **One engine, two runtimes.** The TS engine runs in the browser (sandbox / optimistic
   UI) and on the server (authoritative validation). Keep it free of I/O and framework
   imports so it stays isomorphic.

---

## 3. Lessons learned (ported from the High Frontier fan game)

These hard-won doctrines come from a sibling board-game web service
([RubenTipparach/high-frontier-fan-game](https://github.com/RubenTipparach/high-frontier-fan-game))
and apply directly here.

### 3.1 Multiplayer reliability

- **REST is authoritative. WebSocket is a best-effort optimisation, NOT a reliable
  transport.** Guard against WSS handshake failures, mobile frame drops, proxy timeouts.
  Never treat a WS broadcast as a delivery guarantee — "WS broadcasts cause desync" if
  you do.
- **Clients poll and cache** the latest snapshot (e.g. 5s normal, faster — ~500ms —
  during auctions). Turn-ownership and budget checks read from cached state.
- **Sequence gating:** only a snapshot carrying a *new* operation/action sequence number
  triggers re-hydration, so a polling tick never stomps in-progress local UI.
- **Idempotent, non-destructive hydrators.** Action buttons disable when it is not your
  turn; the server re-validates every operation.

### 3.2 Snapshot application & animation

- Don't replace state wholesale. **Interpret the diff and animate the transition:**
  1. compare new snapshot to last-applied,
  2. drive animations *from* previous *to* new state (tiles dropping, trains running,
     money/tokens sliding, stock price moving),
  3. commit hydrators only *after* the animation completes,
  4. guard against double-animation via sequence gating.

### 3.3 Data as single source of truth

- Game data originates from a structured source (a data module / sheet), and an importer
  generates the consumable artefacts. Hand-authored constants in component code are
  forbidden. (For us: `frontend/src/lib/data/` modules transcribed from the reference.)

### 3.4 Room routing — persistence across deploys

- The active room lives in the **URL path**: `/room/<CODE>`. This survives refreshes,
  reconnects, and deploy-time version-bump reloads.
- A `404.html` fallback stashes the code in `sessionStorage` and redirects to app root;
  on load the app resumes the room from the stash. Version checks preserve the
  `/room/<CODE>` path during reload.
- Codes are lowercase Crockford base32; the server normalises codes before DB queries.

### 3.5 Unified UI principle

- **The multiplayer UI IS the sandbox UI — reuse it, never rebuild it.** Multiplayer
  mounts the same map/board/panels as solo play; the only difference is that actions
  route through the server API instead of mutating local state. The competitive auction
  may be the sole bespoke-multiplayer exception layered on the shared surface.

### 3.6 Visual fidelity

- "Every visual and interaction must feel like the published game." Returning tabletop
  players must recognise tiles, hex conventions, token slots, the stock-market grid, and
  turn structure at a glance. Mechanical innovation is fine; **visual language is not**.

### 3.7 Deploy doctrine

- Client (Pages) and server (Fly) deploy **independently** from one workflow. The Fly job
  is **gated** on the canonical repository and on `FLY_API_TOKEN` being present — it
  skips cleanly (with a notice) rather than failing when secrets/app aren't set up yet.
- Inject a build version (short SHA) so clients can detect new deploys and reload while
  preserving room state.
- Deploys retry with exponential backoff on transient failures.

### 3.8 Stages discipline

- Build incrementally; each stage gates on verification before the next; commit messages
  mark the stage. See `design.md` §7.

---

## 4. Style conventions

- **TypeScript everywhere**, `strict` mode on.
- No em dashes in prose/UI copy; use periods, spaced hyphens, colons, or parentheses.
- Player names render with seat colours (a `.player-name` style convention).
- Sidebar/panel panes never auto-switch; the user controls navigation.
- "Navigate-to / inspect" buttons come last in popups and never change state.
- Keep the engine free of DOM, network, and Svelte imports (isomorphic & testable).
- Prefer small, reviewable commits scoped to one stage/feature.

---

## 5. Deployment notes

- **GitHub Pages:** the `frontend/` static build is uploaded and deployed by CI. The repo
  owner sets up Pages (Settings → Pages → GitHub Actions).
- **Fly.io:** the repo owner creates the app + volume and adds the `FLY_API_TOKEN`
  secret. Until then, the Fly job no-ops with a notice. See `server/fly.toml` and
  `server/Dockerfile`.
- Secrets are configured by the repo owner; do not hard-code tokens.

---

## 6. When to stop and ask

Use planning mode / ask before acting when:

- A game rule or number isn't clearly in the reference repo or our data modules.
- A change affects deployment topology, persistence format, or the action-log schema.
- A reviewer comment is ambiguous or implies an architectural change.
- Scope is larger than the current stage.

One good question beats a confident wrong turn.
