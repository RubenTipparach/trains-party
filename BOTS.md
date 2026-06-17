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

The strategic layer focuses on **1889**. For **RoLA** and the **merger round**, the
Easy bot reuses the proven Testing logic, so it still drives those games legally.
Improving RoLA strategy is a follow-up.

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

## Limitations / next

- **RoLA strategy**: the Easy bot delegates RoLA (and mergers) to the Testing logic.
- **Dividend policy** is basic (pay when earning); no withhold-to-save planning yet.
- **Trashing is bounded** to risk-shedding and locked-in strong rivals, rather than
  blanket dumping (which is usually self-defeating); this is a deliberate first-draft
  choice and can be dialed up.
- **No asset shuffling yet**: the bot does not buy private companies into a
  corporation or transfer trains between corporations it controls.
- **No lookahead/search**: these are rule-of-thumb heuristics with one-ply revenue
  simulation, not an optimizer. A future "Normal"/"Hard" tier can add shallow search
  or tuned weights.
