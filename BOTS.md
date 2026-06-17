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
- **Easy** (`'easy'`) - the first draft of a strategically-thinking bot (1889). It
  follows the heuristics below. This is the default for new single-player games.
- **Normal** (`'normal'`) - reserved for a future, stronger tier. It currently
  **aliases Easy** (the strongest bot available) and is kept as a valid level so
  stored games and the server's default seats keep working. Not surfaced in the UI
  yet.

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
- **Otherwise**: buy the cheapest company at face if it fits the ~¥325 float reserve,
  or take the last one outright to keep the auction moving. The engine's all-pass
  price reduction guarantees the auction terminates regardless.

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
- **Track**: lay the tile that most increases route revenue (simulated), tie-broken
  toward new revenue centres (cities/towns), then cheaper cost, then the home hex
  (network growth). (Realizes "lay track to maximize profit / toward more revenue.")
- **Token**: place the optional station token only when it increases route revenue;
  otherwise save it.
- **Run**: pay the dividend when the corporation earns (raises the price and pays the
  president); withhold only when it earns nothing.
- **Trains**: buy an optional train only when an extra train would actually raise
  revenue - i.e. there are more profitable routes than trains to run them (simulated).
  Mandatory, emergency, and first-train purchases reuse the robust Testing logic
  (which also buys the cheapest *buyable* train, including a discard in the pool).

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

- **1889 founds a single corporation**: the bot never starts a second corporation,
  so 2-player 1889 games (one corp each) tend to grind at phase 2. Multi-corp play
  is a follow-up. (RoLA does launch multiple minors.)
- **RoLA merger choices are simple**: it always merges a controlled pair and never
  weighs *which* pairing or major is best.
- **Dividend policy** is basic (pay when earning); no withhold-to-save planning yet.
- **Trashing is bounded** to risk-shedding and locked-in strong rivals, rather than
  blanket dumping (which is usually self-defeating); this is a deliberate first-draft
  choice and can be dialed up.
- **No asset shuffling yet**: the bot does not buy private companies into a
  corporation or transfer trains between corporations it controls.
- **No lookahead/search**: these are rule-of-thumb heuristics with one-ply revenue
  simulation, not an optimizer. A future "Normal"/"Hard" tier can add shallow search
  or tuned weights.
