# Trains Party Bots

How the single-player AI opponents decide their moves. Bots are pure functions of
game state: `botAction(state, level)` returns one legal `GameAction` for the active
player (or `null` when it has nothing to do). Every action a bot returns is drawn
from an engine `*LegalActions` / `*View` helper, so a bot never proposes an illegal
move (which would stall the auto-play loop). Because the chosen action is appended to
the same action log as a human move, games stay deterministic and replayable.

## Levels (`BotLevel`)

- **Testing** (`'testing'`) - the original keep-the-game-moving heuristics. They
  make legal, unsurprising moves so a game always advances; they are *not* trying to
  win. Use them to fill empty seats or to exercise the engine quickly.
- **Easy** (`'easy'`) - a strategically-thinking bot (1889 + RoLA). It follows the
  heuristics below: founds and floats multiple corporations, steals, times the train
  rush, banks toward a permanent train when trailing, and buys privates into its
  corporations. The default for new single-player games.
- **Normal** (`'normal'`) - reserved for a tier between Easy and Hard. It currently
  **aliases Easy** and is kept as a valid level so stored games and the server's
  default seats keep working. Not surfaced in the UI.
- **Hard** (`'hard'`) - Easy plus signature 1830 tactics: **dumping** a doomed
  presidency onto a rival, **ganging up on the leader** (spite-selling the
  front-runner's strong corporations), and a **sharper train rush** (a thinner cash
  cushion to land a rust). See the Hard section below. Selectable on the new-game
  pages and in Watch mode.

The Easy bot now plays **both 1889 and RoLA** strategically; only the **merger
round** reuses the Testing logic (a bot merges two minors it controls, declines
others, and votes against hostile bids). See the RoLA section below.

## Strategy basis

Heuristics are grounded in community 18xx / 1889 strategy:

- [1889 Strategy: Guidance Towards Skillful Play](https://www.tckroleplaying.com/bg/1889/strategy)
- [18xx Games - 1889 Rules Summary](http://www.fwtwr.com/18xx/info/rs-1889.asp)
- [18xx beginner strategy guide (Erik Twice)](https://eriktwice.com/en/2020/08/07/18xx-beginner-strategy-guide/)

Key principles encoded: keep ~¥325 in reserve to float a corporation; **Dougo
Railway (DR)** is the premium private (a free IR share lowers IR's float cost to
~¥260); par to float and float what you start; selling crashes a share price while
paying dividends raises it; trains rust, so buying bigger trains is timed to route
need; the president's certificate passes to whoever **out-holds** the president, and
a player **cannot re-buy a corporation they sold this round** (the dump/steal tactic).

> **Engine rule used by the steal logic:** 1889 now transfers the president's
> certificate to a buyer who comes to out-hold the sitting president (standard 18xx;
> RoLA already did this). See `stock.ts#maybeTakePresidency`; pinned via
> `RULES_VERSION` so older games still replay.

## Easy bot decision procedure (1889)

### Private auction (`round === 'auction'`)
- **Sub-auction** (the bot is the current low bidder): raise to the minimum bid while
  it stays at or below **140% of the company's face value** and is affordable; else
  drop out. (Realizes "bid up privates, but never overpay above 140%.")
- **Chase Dougo Railway**: on a normal turn, bid DR up to 140% of face (dipping the
  reserve, since its free IR share pays for itself), unless already the high bidder.
- **Otherwise**: buy the cheapest company at face whenever affordable. Every 1889
  private is worth owning, and since a unanimous pass no longer ends the round (once
  the cheapest is sold, an all-pass pays each private its revenue and play continues),
  an eager buyer keeps the auction moving instead of stalling it.

### Stock round (`round === 'stock'`)
On its turn the bot sells (if warranted) before its one purchase, then ends the turn.

1. **Sell / trash** (not in the opening stock round):
   - *Avoid owning 2+ shares unless it is a safe buy*: shed the excess above 10% of an
     **unsafe** company. A holding is *safe* when the president is locked in (≥50%, so
     they cannot bail) or the company is not train-fragile (2+ trains, or a single
     train that will not rust soon).
   - *Trash a rival*: cash out a non-controlling stake in a strong rival
     (price ≥ ¥90) whose president is locked at ≥50% (so a takeover is impossible
     anyway), banking cash and knocking their share price down - once the bot is
     established with its own floated corp.
2. **Buy** (one purchase):
   1. **Float** an owned, un-floated corporation (drive it to 50%).
   2. **Found** a corporation if it runs none: par at the highest price it can sustain
      to float, so the company is well capitalized with room to appreciate (favoring
      higher-value stocks).
   3. **Steal** an undervalued / cash-rich company: out-buy a weak president
      (holding < 50%) of a floated corp that is cash-rich (≥¥100) or holds good
      non-rusting trains. Buying past the president seizes the presidency, and a
      president who sold cannot buy back.
   4. **Speculate**: with comfortable spare cash, take a single share of the strongest
      appreciating (floated, earning) company - never a 2nd share of an unsafe one.
3. Otherwise **pass**. A full lap of passes ends the round.

### Operating round (`round === 'operating'`)
- **Track**: lay the tile that wires the network to the most **city/town revenue**
  (`connectedRevenue` - a cheap connectivity flood from the corp's tokens, any
  distance), tie-broken by near-term route potential (two bounded probe trains), then
  new revenue centres on the tile, then cheaper cost, then the home hex. Scoring by
  connectivity (not just what one short train can run now) stops a bot from fattening
  its home tile when running a line out to a neighbouring city would earn far more -
  important on RoLA's spread map, where trains reach much farther than a probe.
- **Token**: place the optional station token only when it increases route revenue;
  otherwise save it.
- **Run**: paying out is preferred - it climbs the share price, which is most of a
  player's value. But the bot chases **two permanent trains** (ideally the diesel),
  and a treasury only grows by withholding, so when a short burst of withholds (about
  one operating set, capped at ~3) would secure the next permanent train, it banks
  the cash instead. A zero-revenue run always withholds.
- **Trains** - the goal is **two permanent trains as fast as possible** (1889's 5/6/D
  never rust):
  1. **Grab the diesel** (the D, runs every stop, never rusts) the moment it is
     affordable - directly or via the cheapest trade-in (which works even at the train
     limit). `cheapestBuyableTrain` hides the diesel while cheaper trains remain, so
     it is handled explicitly - otherwise the bot would sit on a 5-train forever.
  2. Buy any buyable **permanent** train while it owns fewer than two.
  3. Otherwise the **earn / rust** rush (a Hard bot accepts a thinner cushion to
     rust). A corp that owns the diesel or already has two perms buys nothing more
     and skips the (expensive) route evaluation.

  Then it banks the president's privates into the corporation (up to 2x face, before
  the 5-train closes them). Mandatory / emergency / first-train purchases reuse the
  robust Testing logic.

> **Route-search budget:** the diesel's unlimited reach makes the best-route search
> exponential on a built-up network, so `routes.ts` caps node visits per search
> (`ROUTE_NODE_BUDGET`). It is deterministic (games still replay identically) and high
> enough that ordinary routes are exact - it only ever approximates a pathological
> diesel network.

## Easy bot decision procedure (RoLA)

RoLA differs from 1889 (a launch auction instead of a private auction, a linear
price ladder, share issue/redeem, and a merger round), so the stock round has its
own logic; the operating round reuses the shared strategic track/token/train code.

- **Launch auction** - open one to get a base of operations, and again for a
  second minor (so the merger round has a pairing to fold into a major) when cash
  allows. Bid up to ~45% of cash (a bigger bid buys a higher par and a fuller
  treasury); raise a contested bid to that ceiling, then drop out; launch the
  first available minor when won.
- **Shares** - steal a beatable, valuable minor/major by out-buying a weak
  president (RoLA transfers the presidency to whoever out-holds), shed risky 2+
  holdings, and pick up an appreciating share with spare cash.
- **Operating** - same as 1889: grow network potential with track, buy trains only
  when they raise revenue, place a token only when it helps. RoLA extras are
  honoured: issue a treasury share to fund a first train, take the leadoff train,
  and lay a second yellow when allowed.
- **Merger round** - merges two minors the bot controls into a major (no permission
  needed), declines other players' proposals, and votes shares against hostile bids.

## Hard bot decision procedure

Hard reuses the entire Easy policy and layers on three tactics drawn from the 1830 /
18xx strategy canon (the DOS *1830: Railroads & Robber Barons* AI is famous for the
first and third, and for ganging up on the leader at higher difficulty):

- **Dump a doomed presidency** (1889 stock round, before any other action): if the
  bot presides over a *sinking ship* - no permanent train, a treasury that cannot
  afford the next train, and about to be train-less (none, or all rust soon) - it
  sells the maximum allowed, handing the presidency (and the forced train buy) to the
  largest remaining holder. The engine requires a successor holding >=20%, so the
  dump only fires when it can actually transfer the certificate.
- **Gang up on the leader** (1889 stock round): otherwise, spite-sell a
  non-controlling stake in the **front-runner's** strong (price >= ¥90),
  locked-in (>=50%, so it cannot be stolen) corporation - banking cash and knocking
  the leader's share price down.
- **Sharper train rush** (1889 + RoLA operating): when buying a train purely to rust
  rivals, accept **half** the normal cash cushion - more willing to take a hit to
  inflict one.

Everything else (auction, founding, stealing, track, tokens, the permanent-train
logic, the merger round) is identical to Easy. RoLA Hard currently gets the sharper
train rush but reuses Easy's stock round; a RoLA-flavoured dump is a follow-up.

## Simulator

`frontend/scripts/simulate.ts` runs whole games driven entirely by bots and reports
how long they last (steps, stock rounds, end phase), the winning margin, and timing -
handy for gauging game length and confirming bots never stall or emit an illegal move.

```
cd frontend
npm run sim                                          # default matrix (1889 + RoLA)
npm run sim -- --title=1889 --players=4 --level=easy  # one config
npm run sim -- --title=rola --games=20 --trace        # sample 20 seeds, print each
npm run sim:verify                                    # pass/fail gate (exits non-zero
                                                      # if any game stalls or doesn't finish)
npm run sim:render                                    # 4p 1889 game: render the board +
                                                      # Entities panel at every OR boundary
npm run screenshots                                   # capture board PNGs of bot games
                                                      # (needs a dev server + a browser:
                                                      # npm run dev; npx playwright install chromium)
```

The engine and bots are deterministic, so a 1889 game is identical for a given
(players, level); RoLA derives its map/minor order from a seed, so seeds vary games.
Rough current shape: 1889 Easy reaches phase 4-5 in ~8-10 stock rounds at 3-6
players (2-player still grinds at phase 2 - see below); Testing stays at phase 2.
RoLA Easy launches several minors, merges them into majors, and runs the fixed ~6
cycles; its strategic operating runs route simulations on the larger procedural map,
so RoLA Easy games are a few seconds each (fine live; the default matrix keeps RoLA
to 3-4 players to stay quick).

## Limitations / next

- **RoLA Hard reuses Easy's stock round**: the dump / leader-collusion tactics are
  1889-only so far; RoLA Hard gets only the sharper train rush. A RoLA-flavoured dump
  (minor presidency, issue/redeem) is a follow-up.
- **RoLA merger choices are simple**: it always merges a controlled pair and never
  weighs *which* pairing or major is best.
- **Dividend policy** is still coarse: pay when earning, or withhold to bank toward a
  permanent train when trailing. No price-zone planning (withholding to line up a
  market jump) yet.
- **No train shuffling**: the bot buys privates into a corporation, but never moves
  trains between corporations it controls.
- **No lookahead/search**: these are rule-of-thumb heuristics with one-ply revenue
  simulation, not an optimizer. A stronger "Normal" tier could add shallow search or
  tuned weights between Easy and Hard.
- **1889 is deterministic**, so a given (players, level) always plays the same game;
  Hard diverges from Easy but is itself fixed. Seeded bot variation is a possible
  future touch for more varied Watch games.
