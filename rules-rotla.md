# rules-rotla.md — Railways of the Lost Atlas (engine design spec)

> **Status: design draft (speccing in progress).** This extracts the RoLA ruleset
> and frames it as **deltas from our existing 1889 engine**, so we can plan how to
> generalize the engine to a second title. Not yet implemented — see the staged
> plan at the end.
>
> **Source:** [Railways of the Lost Atlas rulebook (PDF, 09.12)](https://www.asterisk-games.com/s/Railways-Rulebook-0912.pdf)
> — Asterisk Games, designers Jacob Schacht & Kevin Delger, © 2024. There is **no
> `tobymao/18xx` port**, so the rulebook is the only source; cross-check there, not
> against a reference engine. The Landmarks modules and the solo mode are **out of
> scope** and tracked separately in `rules-rotla-expansion.md`.

---

## 0. RoLA in one paragraph

Players are investors who **launch Minor Companies** (won via an auction for
*choice*, not for a specific company), build track on a **map the players assemble
from tri-hex tiles**, run trains for revenue, and **merge Minor Companies into Major
Corporations** in a dedicated round. Capitalization is **incremental** (a company
starts with only its launch bid and grows its treasury by issuing shares and
withholding). The game runs a **fixed number of cycles** (Short = 4, Long = 6),
each cycle = **Stock Round → 2 Operating Rounds → Merger Round**, with a train
**exported** between cycles. Final score = personal cash + share value (treasuries
don't count).

---

## 1. 1889 vs RoLA at a glance

| Dimension | 1889 (today) | RoLA |
| --- | --- | --- |
| Map | Fixed Shikoku (`map1889.ts`, static `HEX_BY_COORD`) | **Built at runtime** from 33 tri-hex tiles + project tiles |
| Companies | 7 public corporations, 10 shares, full cap | **12 Minor** (5 shares) → **6 Major** (10 shares) via merger; **incremental cap** |
| Floating | 50% of IPO sold → treasury = 10×par | **Launch via auction**; treasury = winning bid (then grows by issuing) |
| Initial price | Par diagonal (6 fixed par prices) | **½ the winning bid**, within a phase-gated section of a **linear track** |
| Stock market | 2D grid, par cells | **Linear track**, tokens **stacked** per cell (top operates first) |
| Privates | 6 private companies w/ abilities | none; instead each **Minor has a special ability** (persists into its Major) |
| Round structure | SR ↔ OR-set (phase-dependent OR count) | **Cycle = SR + 2 OR + Merger Round**; fixed # of cycles |
| Tile lay | 1 tile / OR | **2 yellow OR 1 upgrade / OR** |
| Tile colours | yellow → green → brown | yellow → green → **purple → grey** (4 colours) |
| Mountain cost | 80 | **40** |
| Trains | 2..6,D | 2,3,4,5,6,7,**∞**; stops = train number; ∞ unlimited |
| OR financial extras | dividends, buy trains | **+ leadoff train, + issue/redeem one share** |
| Mergers | none | **Minor + Minor → Major** (Merger Round) |
| End game | bank break / bankruptcy | **fixed cycles** (bank-break is a variant); bankruptcy can end it |
| Cert limit | 25..11 | **none** (cert limit only in the Bank-Break variant) |

---

## 2. Engine impact summary

**Prerequisite — multi-title refactor.** The engine currently imports `$lib/data/g1889`
directly in `setup.ts`, `stock.ts`, `operating.ts`, `track.ts`, `routes.ts`. RoLA
requires a `GameConfig`/title interface threaded through the reducer so the engine
is title-agnostic. (Do this first, behaviour-preserving, guarded by the 68 tests.)

**Reuse (with config):** action-log reducer + replay + `rulesVersion` (`index.ts`);
round → step → action shape; "sell drops price"; pay/withhold dividends; depot +
rust; route graph traversal (`routes.ts`); token-blocking; **phase-valued off-board
areas** (RoLA's **Distant Destinations** are exactly this — terminus-only, just with
a randomized set); **market-stack operating order** (we just added this — RoLA uses
exactly it).

**Modify:** capitalization (full → incremental); stock model (2D grid → linear
stacked track + RoLA movement bands); launch instead of float; tile lay count and
colour ladder; mountain cost; train roster + "stops = number" + ∞; add issue/redeem
and leadoff train to the OR.

**New systems (no 1889 analog):** procedural map building; the 3-column Minor matrix
+ auction-for-choice; the Merger Round; export-a-train; the cycle/round tracker;
12 Minor abilities + 6 Majors (2 identities each).

---

## 3. Setup & capital

- **Starting capital** (personal): 3p **300**, 4p **275**, 5p **220** (Long Game);
  2p **450** (Short Game only).
- **Minor matrix:** shuffle the 12 Minor charters into **3 columns of 4** (Short:
  8 minors, 2 columns of 4). **Only the bottom row is launchable**; launching one
  exposes the next in that column.
- **Trains:** single stack low→high, 2-trains on top (see §8 for counts/short-game
  removals).
- **Priority player** chosen at random.
- Place the **stock track**, **earnings board**, **round/cycle tracker** (start at
  Stock Round / Cycle 1). Majors enter later (via merger).
- **Distant Destinations:** draw the **randomized off-board set** (each card holds
  4 phase values) and seat it on the map. These are ordinary 1889-style off-board
  areas; only the selection is randomized.

*Engine:* `initialState` becomes config-driven. New state: `cycle`, the round
tracker (`SR | OR1 | OR2 | Merger`), the minor matrix (3 columns + availability
cursor), the drawn **off-board (Distant Destination) set**, and an (initially
empty) **runtime map**.

---

## 4. Procedural map building (NEW — the headline system)

The map is assembled before play from a stack of **tri-hex map tiles** (33) and
**tri-hex project tiles**:

1. Shuffle tri-hex tiles face down. A random player flips the top tile and places
   it in the centre. Clockwise, each player flips and places the next tile.
2. **Placement rules:** a tile must **share ≥ 3 edges** with already-placed tiles;
   **no tile may share an edge with a black-border hex**; tiles lie flat, no
   overlap. (Pre-printed track need not connect during the build.)
3. **Project tiles** (Capital City): when flipped, place the named component; if it
   can't be placed, bottom of the stack and draw again.
4. If the group agrees no legal placement exists, **restart** the build (rare).
5. Optional **12 single-hex blank tiles** can shore up minor home spaces.

Hexes carry types: **Blank, Water, Basic City, Company Home, Mountain, Distant
Destination (off-board), Border** (map legend). Minor **home hubs are printed on
map tiles**;
an unlaunched minor's home spot stays **reserved**.

*Engine — this is the big lift.* Our board model assumes a static `HEX_BY_COORD`.
For RoLA the map is **data built by actions**:
- A `place_map_tile` action (during a new **map-build phase**) appended to the log,
  so the procedural map is deterministic and replayable (the tri-hex draw order is
  a seeded shuffle recorded in the log).
- Generalize `track.ts`/`routes.ts` to read hexes from `state.map` (a runtime
  `Record<coord, HexDef>` assembled from placed tri-hex tiles) instead of the
  static module. Tri-hex tiles map to **3 hex cells** at fixed relative offsets +
  a rotation.
- New geometry: tri-hex adjacency, the "≥3 shared edges" legality check, and
  black-border adjacency exclusion.

---

## 5. Stock market — the linear stacked track

- A **single linear track** of printed values — **27 spaces** incl. the **CLOSED**
  space at 0, validated against the physical board:
  `0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 180, 200,
  220, 245, 270, 300, 330, 360, 400, 450, 500`.
- New minors enter at a **par space** inside a phase band: **60–90** (yellow),
  **60–110** (green), **60–135** (purple) — the coloured start-zones on the track.
- **Stacking:** tokens in a cell form a **column in entry order**; the **first to
  enter is on top**, new tokens go **below**. **Top operates first** (descending
  price, top-to-bottom within a price) — this matches the `stackSeq` rule we added.
- **Movements:**
  - **Sell:** −1 increment **per sale** (not per share). *(Variant: per share.)*
  - **Pay out** dividends where `0 < payout < price`: **no price change**, but the
    token moves to the **bottom of its column** (re-enters last).
  - **Pay out** `price ≤ payout < 2×price`: **+1**.
  - **Pay out** `payout ≥ 2×price`: **+2** (double jump).
  - **Withhold** (or **no train → revenue 0**): **−1**.
  - **Issue a share** (OR): **−1**. **Redeem:** no change.
  - **Fully owned by players** at end of SR (no shares in pool or treasury): **+1**.
  - **Reaches 0:** the company **dissolves** (shares removed, treasury → bank,
    trains → bank pool, hubs removed).

*Engine:* replace `MARKET` (2D grid + par) with a **1-D ordered price ladder** +
phase→section bounds, and a per-cell stack. `currentPrice`, `moveUp/Down/Left/Right`
in `stock.ts`/`operating.ts` collapse to **`moveUp(n)`/`moveDown(n)` on the ladder**.
The "+0 but re-enter at bottom" case is a stack reorder with no index change. The
`priceStack`/`stackSeq` machinery we already added is reused directly.

---

## 6. Shares, capitalization, certificates

- **Incremental (partial) capitalization.** A launched Minor's treasury = **its
  winning bid only**. It grows treasury by **issuing shares** (OR step 2) and
  **withholding**. *(Contrast 1889 full cap: treasury = 10×par at float.)*
- **Minor shares:** president's certificate = **2 shares (40%)**, plus **3 single
  shares (20% each)** → 5 shares / 100%. Each Minor share pays **20%**.
- **Major shares:** president = **2 shares (20%)**, plus **8 single shares (10%
  each)** → 10 shares / 100%. Each Major share pays **10%**. *(Share counts derived
  from the 20%/10% payout + the 60% cap text + "president cert → two single
  shares"; confirm against the physical charters — §12.)*
- **Per-player cap 60%:** Minor = president + 1 single; Major = president + 4
  singles. **No certificate limit** otherwise.
- **Pool cap 50%.** Buying from a company **treasury** pays into that treasury;
  buying from the **bank pool** pays the bank.
- **Presidency** moves immediately whenever a non-president holds **more shares**
  than the president (tie → next tied player clockwise).
- Owning 2 single shares of a Minor exposes you to **involuntarily becoming its
  president** (a "dumped" company).

*Engine:* `CorporationState` gains `kind: 'minor' | 'major'`, a per-share payout %,
and treasury-as-cash (already have `cash`). `maybeFloat`/full-cap logic in `stock.ts`
is **removed**; launch sets `cash = bid`. Presidency-by-most-shares already exists;
generalize the "2-share president cert" (1889's president cert is 20% = 2×10%, so
the double-cert idea is already partly modeled).

---

## 7. Stock Round

On your turn choose **one**: (1) **Initiate a Minor auction**, (2) **Sell and/or buy
one share**, or (3) **Pass**.

- **Auction (for choice):** bids start at **120**, increments of **5**. The
  initiator sets the first bid; clockwise players raise or pass; **a pass is out**.
  Last player standing picks **any available Minor** and launches it. Initial price
  = **½ winning bid rounded down**, snapped into the current phase's section. Turn
  passes to the player **clockwise from the initiator**.
- **Sell / buy:** sell any number at current price (all at once, once per turn;
  can't orphan a presidency; can't sell a Minor that hasn't operated; pool ≤ 50%);
  then optionally **buy one share** at current price. Can't buy a company you sold
  this SR. Sell drops price −1 per sale.
- **Pass** does **not** remove you from the SR (unlike the auction). **All players
  passing consecutively ends the SR.**
- **End of SR:** priority marker → clockwise from the last non-pass actor;
  fully-player-owned companies **+1**; advance to OR1.

*Engine:* the auction is a **mid-stock-round sub-auction for choice** — different
from our opening `waterfall_auction` (`auction.ts`). It's a new step but can borrow
the bidding/pass-out mechanics. `applyStock` gains `initiate_auction` / `launch`
actions and the "buy one share, treasury vs pool" split.

---

## 8. Trains & phases

| Train | Cost | Stops | First-of-colour → phase | Rusts | Limit (Minor/Major) | Initial-price section |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 100 | 2 | yellow (start) | by 4 | 2 / – | 60–90 |
| 3 | 200 | 3 | **green** | by 6 | 2 / 4 | 60–110 |
| 4 | 300 | 4 | green | by 7/∞ | 2 / 3 | 60–110 |
| 5 | 450 | 5 | **purple** | — | 1 / 2 | 60–135 |
| 6 | 550 | 6 | purple | — | 1 / 2 | 60–135 |
| 7 | 750 | 7 | **grey** | — | 1 / 2 | 60–135 |
| ∞ | 1000 (or **800 + trade-in** a non-rusted train) | unlimited | grey | — | 1 / 2 | 60–135 |

- **Rust events:** first **4** rusts all **2s**; first **6** rusts all **3s**; first
  **7/∞** rusts all **4s**. (5 and 6 rust nothing.)
- **Phase advance** when the **first train of a new colour** (green/purple/grey) is
  bought **or exported**; new train limits apply immediately, over-limit companies
  **discard to the pool**.
- **Train colour → phase mapping is inferred** from the initial-price sections and
  limit drops; **confirm exact train-card colours** (§12). Extra 3- and 6-trains
  for 4+ players; Short Game removes one of each train (except 7/∞).

*Engine:* extend `TrainDef` with `stops` (= distance, with ∞), keep `rustsOn`, add
the ∞ trade-in (we already built a diesel trade-in for 1889 — reuse the mechanism).
`trainLimit` becomes **per company kind** (Minor vs Major). Phase model gains the
4-colour tile ladder + the export-driven phase advance.

---

## 9. Operating Round (per company, in stock order)

Each cycle has **2 ORs**. Actions, **in order**:

1. **Leadoff train** *(Minor's first OR only)* — optionally buy one train from the
   stack or pool at face; it can run this turn.
2. **Issue or redeem one share** — **issue:** treasury gains current price, price
   **−1**; **redeem:** pay current price to buy a share back from the pool, **no**
   price change.
3. **Lay track** — **up to 2 yellow OR 1 upgrade**. Must trace a route to the new
   track (a new track segment must be reachable). Yellow not on water / off-board
   (DD) / border / existing track. **Mountain = 40.** Upgrades replace the
   previous-phase colour and
   **preserve existing track exactly**; cities aren't created/removed; symbol tiles
   need matching symbols.
4. **Place a hub token** *(Majors, or Expansive Company)* — pay printed cost; any
   open, unreserved city you can trace to; **one hub per tile**.
5. **Run trains** — one route per train. A route is continuous track including **≥1
   city with your hub**, reusing **no track**, up to the train's **stop count**;
   may **cross** at cities/some green+purple tiles; **can't pass a fully-tokened
   city** (unless your token is there; may start/end there); **off-board Distant
   Destinations are terminus-only** (start/end, 1889-style); **no city or DD twice**
   per train. **Local routes** (a single stop within your hub city, off-track) let
   trains that can't reach a 2nd city still earn — any number allowed.
6. **Distribute earnings** — **full pay out** (each Minor share 20% / Major share
   10%, incl. treasury-held shares) **or full withhold** (treasury gains all, price
   −1). Price band per §5. No train → revenue 0 → −1.
7. **Buy trains** — if under the phase limit, buy top-of-stack / from the pool / from
   another company (**≥1, both presidents consent**). **Must own ≥1 train** before
   ending (forced purchase → president cash → sell shares → **bankruptcy**). No
   personal cash except a forced purchase.
8. **Pass**; next company. None left → advance the round tracker.

*Engine:* extends `operating.ts` steps. Route engine (`routes.ts`) gains **local
routes**, reuses 1889's **off-board areas** for **Distant Destinations**
(terminus-only, phase-valued), and **stops = train number** counting cities /
towns / DDs. Cross-company train buy with consent reuses our **permission model**
(bots decline → self-only in single-player).

---

## 10. Merger Round (NEW)

After both ORs, **if the first green train has been bought/exported**, run a Merger
Round (else skip to Export-a-Train; a yellow→green export skips that cycle's merger):

- In **descending stock order**, each Minor president may **propose a merger** with
  another Minor they **can trace a route to**, or pass. A declined merger can't be
  re-proposed this round. *(Variant: Hostile Mergers via share voting.)*
- On agreement: new Major's president = **player with most combined shares** (tie →
  earlier in stock order). Choose one of the **6 Majors** (2 identity options each).
  - Minor shares → **equal** Major shares (1:1). Loser's president cert → **2 single
    Major shares**.
  - New token at **average of the two prices, rounded down**; remove both Minor
    tokens.
  - Hubs → Major hubs (dup on a tile → one Major hub, the other returns as
    available; +2 spare hub tokens on the charter).
  - **Combine treasuries and trains**; over the limit → discard one.
  - **Minor abilities persist** in the Major.

*Engine:* a brand-new round type + `propose_merge`/`accept_merge` actions, share/
token conversion, and a connectivity check between the two minors' networks (reuses
`routes.ts` connectivity).

---

## 11. Export-a-train, end of game

- **Export a train** each cycle (before the new SR): remove the top available train.
  May trigger rust / phase changes (treat a removed first-of-type like a purchase).
  Exporting a 2 exports **all** 2s.
- **End:** after **4 cycles (Short)** or **6 (Long)**. Score = **personal cash +
  value of all shares at final price**; **treasuries don't count**. High score wins
  (tie → president of the company acting earliest). **Bankruptcy** commonly ends the
  game immediately. *(Variant: Bank-Break — 8,000 bank ends the game when depleted,
  and adds cert limits 3p 16 / 4p 12 / 5p 10.)*

---

## 12. Minor Company abilities (12) & Majors

Each Minor has one ability (persists into its Major). From the rulebook: **Adaptive**
(choose any empty basic-city home at launch), **Overnight** (skip blocked cities when
tracing), **Bridging** (5 bridge tiles over water; track may enter a water edge),
**Spacious** (+1 train slot), **Expansive** (extra hub token, placeable for 40),
**Suburban** (2 suburb tokens, +10/train through them), **Resourceful** (trains run
once more before rusting; can't be sold/traded), **Agricultural** (lay a yellow tile
after an upgrade), **Tunneling** (+60 to treasury per mountain dug; net +20),
**Eastern Mining** & **Northern Port** (special home tiles with dedicated upgrade
sets), **Express** (+1 stop while owning a single train).

**Majors:** 6 corporations, each with **two identity options** and silkscreened
tokens; **Headquarters** are an expansion/variant feature (out of scope).

*Engine:* model abilities the way we did 1889 privates — a typed `abilities` list on
the company config, read by `track.ts`/`routes.ts`/`operating.ts`. Several map to
hooks we already have (skip-blocked, extra-lay, terrain discount, extra train slot).

---

## 13. Data status (researched — confirm before building data stages)

Sources: the RoLA rulebook (09.12), the **fwtwr.com 18xx inventory** (Keith
Thomasson, 2024) — a factual roster / market / manifest reference — and the fwtwr
stock + tile images (OCR'd, cross-checked against board photos). Derived values are
marked. The stock ladder below is **board-validated**. (Landmarks / solo / variant
content lives in `rules-rotla-expansion.md`; Distant Destinations are **base** —
off-board areas, see below.)

### Resolved (base game)

**Trains** (29 cards):

| Train | Cost | Qty | Rusts | Phase triggered |
| --- | --- | --- | --- | --- |
| 2 | 100 | 7 | — | yellow (start) |
| 3 | 200 | 5 (+1 in 5p) | by first 6 | green |
| 4 | 300 | 4 | by first 7/∞ | green |
| 5 | 450 | 3 | — | purple |
| 6 | 550 | 2 | by first 4 rusts the 2s* | purple |
| 7 / ∞ | 750 / 1000 | 7 | — | grey |

\*Rust events: first **4** rusts all **2s**; first **6** rusts all **3s**; first
**7/∞** rusts all **4s**. The **7 and ∞ are the same physical pile** (7 on the
front, ∞ on the back); ∞ costs **1000, or 800 + trading in a 4/5/6**.

**Shares / tokens** (confirms the derivation):
- **Minor** = president **40%** + **3 × 20%** = **5 shares**; **1** station token
  (Expansive has **2**).
- **Major** = president **20%** + **8 × 10%** = **10 shares**; **4** station
  tokens. **No certificate limit** at any count.
- The **6 Majors**: Conglomerate, Experiment, Federation, International, Syndicate,
  Unlimited (home inherited via merger).

**Minor home tri-hex tiles:** Adaptive = owner's choice; Eastern Mining = tile 2;
Expansive = 1; Agricultural = 3; Resourceful = 4; Express = 5; Suburban = 6;
Northern Port = 7; Tunneling = 8; Bridging = 9; Overnight = 10; Spacious = 11.

**Cash / bank:** 2p 450, 3p 300, 4p 275, 5p 220. Money total 24,500 (285 cards);
no cert limit (the Bank-Break variant uses an 8,000 bank).

**Map composition:** 33 tri-hex tiles (+ optional single-hex), built at runtime;
roughly 105 hexes total — ~57 clear, ~32 city, ~13 water, ~14 mountain, ~2 fixed.

**Tile manifest** (base; standard ids reuse our `tiles.ts` catalogue). RoLA colours
map to the engine ladder: purple → `brown`, grey → `gray`, plus **blue** bridge
tiles for the Bridging minor.
- Yellow (55): 5×5, 6×7, 7×6, 8×14, 9×13, 57×7, 291, 292, 293.
- Green (43): 14×4, 15×5, 16, 17, 19, 20, 21, 22, 23×4, 24×4, 25×2, 26, 27, 28, 29,
  30, 31, 294×2, 295×2, 296, 619×4, 624.
- Brown/purple (27): 39, 40, 41×2, 42×2, 43×2, 44, 45×2, 46×2, 47×2, 70, 125×6,
  297×2.
- Grey (3, base): 51×3. Blue bridge (5): 721×2, 722×2, 723.

**Stock track (board-validated):** linear, 27 spaces incl. **CLOSED** at 0 —
`0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 180, 200,
220, 245, 270, 300, 330, 360, 400, 450, 500`. Par start-zones: yellow **60–90**,
green **100–110**, purple **120–135**.

**Distant Destinations (base — off-board reuse):** a randomized set of **off-board
areas** (1889-style termini), each card carrying **4 phase values**. Mechanically
identical to our existing phase-valued, terminus-only off-board hexes; only the
selection is randomized at setup.

**RoLA-specific tile values (from fwtwr art; exact track curves to confirm):**
yellow city **40** (291/292/293); green twin-city **50** (294/295/296), twin-town
**30** (619), plain track (624); purple city **40** (125) and 70, twin-city **60**
(297); grey city **50** (51); blue **bridge** track over water (721/722/723). The
**4 custom home tiles**: Eastern Mining (pickaxe, 30/20), Northern Port (anchor,
30), Bridging (30), Tunneling (20); the other 8 minors use generic city tiles.

### Still open (photo only)

1. **Distant Destination per-card phase values** (the 4 DD cards × 4 phases).
2. **Major hub / token costs** (printed on the 6 Major charters).
3. The **33 tri-hex map-tile compositions** (hex contents + printed home hubs) and
   the **3 Capital City project tiles** — needed for the map-build stage (Stage 4).
4. The **8 generic minor home tiles** (the 4 custom ones are decoded above).

Best sources: component photos, or the official **TableTop Simulator** mod (built
with Asterisk's assistance). The fwtwr tile-upgrade *paths* (legal upgrades) can be
transcribed next if useful.

---

## 14. Staged implementation plan

Each stage gates on verification (fixture-replay tests), mirroring `design.md` §7.

1. **Engine multi-title refactor. ✅ Done.** A `GameConfig` (`data/types.ts`) +
   title registry (`engine/registry.ts`); every reducer reads config via
   `configFor(state.title)` instead of importing `g1889`. The engine core now
   imports a title's data only through the registry seam; adding a game is a new
   config + a registry entry. 1889 is the first config. Behaviour-preserving (68
   tests green, typecheck + build clean).
2. **RoLA static data** (`data/grola.ts`): trains, phases/tile-colour ladder, linear
   stock ladder, Minors (+abilities), Majors, starting capital — from §§5–8, 12 and
   the §13 confirmations.
3. **Linear stock + incremental cap + launch.** New stock model and launch/issue/
   redeem; no float/full-cap.
4. **Procedural map building.** Runtime map model, tri-hex geometry, `place_map_tile`
   action + the build phase; generalize `track.ts`/`routes.ts` off the static map.
5. **OR extras & routes.** Leadoff train, 2-yellow-or-1-upgrade, local routes,
   off-board Distant Destinations, ∞ train.
6. **Merger Round** + export-a-train + cycle tracker + end-game scoring.
7. **Wire RoLA playable** into the menu (`games.ts` → `status: 'playable'`); fixtures
   throughout.

Per `CLAUDE.md`, the rules stages (2–6) should pause for the §13 confirmations rather
than guess.
