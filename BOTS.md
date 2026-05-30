# Trains Party Bots (1889)

How the single-player AI opponents decide their moves, and the strategy they are
based on. Bots are pure functions of game state: `botAction(state, level)` returns
one legal `GameAction` for the active player (or `null` when it has nothing to do,
e.g. the unimplemented operating round). Because the chosen action is appended to
the same action log as a human move, games stay deterministic and replayable.

## Strategy basis

Heuristics are grounded in community 1889 strategy, primarily:

- [1889 Strategy: Guidance Towards Skillful Play](https://www.tckroleplaying.com/bg/1889/strategy)
- [18xx Games - 1889 Rules Summary](http://www.fwtwr.com/18xx/info/rs-1889.asp)
- [18xx beginner strategy guide (Erik Twice)](https://eriktwice.com/en/2020/08/07/18xx-beginner-strategy-guide/)

Key principles encoded:

1. **Keep enough to float.** Floating a corporation needs 50% (president 20% + 30%),
   i.e. ~5x the par price. The minimum par is ¥65, so a player wants to keep about
   **¥325** in reserve during the private auction rather than overspending on privates.
2. **Privates are good value** but not worth bankrupting your float. Buy the cheapest
   when it fits the reserve; grab the last one promptly so the auction ends.
3. **Dougo Railway (DR)** is especially strong: it exchanges for a free IR share,
   lowering the cost to float Iyo Railway. Bots value it slightly higher.
4. **Par to float.** In the stock round a bot pars a corporation only if it can afford
   to actually float it (~5x par), choosing the highest par price it can sustain so the
   corporation is better capitalized.
5. **Float what you start.** After paring, the bot buys IPO shares of its own
   corporation until it floats (50%), then stops.
6. **Don't dump early.** Bots do not sell in the opening stock round (a 1889 rule of
   thumb / restriction); selling logic is reserved for later, price-driven decisions.

## Decision procedure

### Private auction (`round === 'auction'`)
- **In a sub-auction** (the bot is the current low bidder): raise to the minimum bid
  if that is within budget and at or below the company's value plus a small overpay
  tolerance; otherwise pass.
- **On a normal turn**: buy the cheapest company at face if it fits the float reserve
  (or if it is the only one left and affordable, to keep the auction moving); otherwise
  pass. All-pass price reductions are handled by the engine, so the auction always
  terminates.

### Stock round (`round === 'stock'`)
1. If the bot is president of an un-floated corporation and can buy an IPO share, buy it
   (drive toward the float).
2. Else, if the bot owns no presidency and can afford to float one, par a corporation at
   the highest par price it can sustain (~cash / 5).
3. Else, optionally pick up a cheap share of a floated corporation within the hold (60%)
   and certificate limits.
4. Otherwise pass. A full lap of passes ends the round.

All buy/par/sell candidates come from the engine's `stockLegalActions`, so a bot never
proposes an illegal move (which keeps the auto-play loop from stalling).

## Levels

- **Easy** — smaller float reserve and a higher tendency to pass; weaker, more passive.
- **Normal** — the heuristics above with the full float reserve.

## Limitations / next

- No operating-round play yet (Stage 3): track laying, routes, dividends, and train
  buying. Bots return `null` there for now.
- No lookahead/search; these are rule-of-thumb heuristics, not an optimizer. A future
  pass can add shallow search or tune weights against self-play.
