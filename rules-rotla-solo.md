# rules-rotla-solo.md — Railways of the Lost Atlas: Solo Mode (the Conglomerate)

> **Design spec for RoLA's official Solo Mode.** This is a *distinct ruleset* from
> our AI "bot mode" (where opponents play the standard multiplayer rules): solo
> mode pits one human against an automated **Conglomerate** that runs by its own
> scripted rules, an Action Deck, and a static earnings formula.
>
> **Source:** Railways of the Lost Atlas - Solo Mode rulebook (09.01), stored at
> [`references/RailwaysRulebook-SoloMode.pdf`](./references/RailwaysRulebook-SoloMode.pdf)
> (Asterisk Games). It is **not** the Landmarks expansion. Not yet implemented;
> this captures the rules so the eventual "Solo (Conglomerate)" mode is faithful.

Solo plays on the **Short Game** base (a pre-set Short Game map, or Short Game +
Randomized Minors). The human follows the standard player rules throughout; only
the Conglomerate behaves differently.

---

## 1. The Conglomerate

A single **Major corporation** (the "Conglomerate" charter, or any Major) formed
at setup by merging two Minor companies. It acts as **both a player and a
corporation** sharing one treasury: when "the Conglomerate" gains or spends money,
it is the same treasury. It is driven entirely by scripted rules + an **Action
Deck**, never by tracing routes.

---

## 2. Setup

1. **Map** - pre-set Short Game map, or build one via Short Game + Randomized Minors.
2. **Form the Conglomerate** - reveal one Minor at random (from those on the map)
   and choose another on-map Minor to pair with it.
3. **Conglomerate charter:**
   - 2 hub tokens on the **60 spots**; 2 Major shares (incl. president's cert) in
     the treasury; **3 single Major shares placed *below* the charter** (issued
     later, not treasury); the **final single share** in the bank pool.
   - Shuffle the two chosen Minors' stock certificates into a face-up **Action
     Deck** by the charter.
   - Put **450** in the Conglomerate treasury.
   - **Initial network:** lay yellow track connecting the two merged Minor homes
     (shortest path; the spare open leg points to the closest Capital >
     unlaunched-Minor home > Distant Destination; tile choice priority Capital >
     unlaunched-Minor home > basic city > blank > mountain; costs paid from
     treasury; bridges over water only if no land path).
   - **Initial stock price** = sum of all city revenue in that network, **clamped
     to [60, 90]** (<=60 -> 60, >90 -> 90).
   - Place each included Minor's home hub with a **Conglomerate hub on top** (these
     guide OR actions).
4. **Difficulty** = initial network value: **40-60 Easy / 70-90 Medium / 100+
   Hard** (proximity to Capitals and unlaunched Minors also matters). Medium also
   places a hub on the Capital in OR1; Hard does that **and** absorbs Tunneling in
   the first Merger Round if it is still unlaunched.
5. **Player** - 450 starting capital.
6. **Auction matrix** - the remaining 6 Minor charters into **2 columns of 3**.
7. **Special setup by included company:** Adaptive (home placed relative to the
   other Minor - connect each Minor to the nearest Capital, not to each other);
   Expansive (its token under the Conglomerate token on the 40 spot); Bridging
   (water counts as blank for lays while a bridge is available); Suburban (suburb
   tokens on non-hub basic cities nearest its home, counted in the initial price);
   Tunneling (Conglomerate gains **20 per mountain** covered in the initial lays;
   mountains chosen over blanks); Agricultural (an extra yellow after an upgrade).

---

## 3. Stock rounds

**Player:** always holds priority. May only buy Conglomerate shares from the
**bank pool**; may not sell a company share if that sale would hand its presidency
to the Conglomerate. Launches a Minor by winning its auction at the initial bid.
(In the first SR the Conglomerate has not operated, so its shares can't be sold.)

**Conglomerate:** buys **one share** of any launched company/corporation the player
controls that it does not already hold (funds permitting; dividends go to its
treasury; corporation shares from the pool). **Sells** any non-Conglomerate share
sitting **above the phase's top initial price** (100+ yellow, 120+ green, 150+
purple/gray). No other SR actions.

---

## 4. Operating rounds

**Player:** unchanged from the standard game.

**Conglomerate**, each OR:
- **OR1 of the first three cycles:** issue one of the 3 below-charter shares to the
  pool, gain the current stock value, price **-1**.
- **Buy one train** (before acting): pays the difference between the current
  available train and the last it bought (same rank -> 0). **No train limit; its
  trains never rust**; kept in a stack, newest on top. If it cannot afford the
  current train it skips the buy but still earns using its top train.
- **Act from the Action Deck:** flip the top card = this OR's action (and reveals
  the next OR's). A certificate showing **single shares -> a basic action**; a
  **president's cert -> a special action** (per the company table, then buy an
  *additional* train; if the special can't be performed, do a basic action
  instead). **All Conglomerate upgrades ignore phase restrictions.**
  - **Basic action:** extend the network with **two yellow tiles** toward the
    nearest target, priority **Capital City > unlaunched Minor home > the
    Conglomerate's own companies' homes > Distant Destination > basic city**. Open
    legs point to the nearest revenue generator by the same priority. It won't
    build toward empty edges of existing track; with no viable target it upgrades
    the corresponding tile (or, if its home can't be upgraded, the nearest city).
  - **"Breakthrough":** if it is unconnected to a network and an adjacent pair of
    track/city tiles could be **upgraded** to connect, it upgrades the nearest
    valid tile/pair to make the connection (choosing the network with the most
    Capitals > unlaunched Minor homes > cities). It lays no yellow for this.
  - Connected to a Capital with an open token slot -> place a hub there (pay from
    treasury).
- **Earnings (static formula, no route tracing):** `count = current train value x
  number of Conglomerate hubs on the map`. Sum the **`count` highest-revenue
  cities** (incl. Distant Destinations) it can trace to; **cities with a
  Conglomerate hub count twice** (and consume two of the count). Always pays out to
  shareholders. *Example: a 3-train with 3 hubs -> count 9 -> the 9 highest city
  values, hub cities doubled.*

---

## 5. Merger round / export / end game

- **Merger round** - player standard. Conglomerate: if it has a spare hub and is
  connected to an unlaunched Minor home, it **absorbs** that Minor (Conglomerate
  hub on the home, free), shuffles that company's certs into the remaining Action
  Deck, files the charter by the Conglomerate, and moves its stock price **+1**.
- **Export a train** - none in solo.
- **End of game** - after the **4th cycle**. Score = cash + value of all shares
  held. The Conglomerate scores its **treasury** cash + shares; the player scores
  only **personal** cash + shares. Higher score wins.

---

## 6. Company-specific exceptions & actions

Per included Minor (OR exception / president's special action):

| Company | OR exception | Special action |
| --- | --- | --- |
| Adaptive | - | Breakthrough |
| Agricultural | lays a yellow after any Basic-action upgrade | Breakthrough, then a yellow per upgrade laid |
| Bridging | water = blank for lays; upgrades point as many edges into water as possible | Breakthrough |
| Eastern Mining | - | Breakthrough |
| Expansive | place hubs from the 60 spots before the 40-spot token | place the Expansive hub in the nearest basic city (pay 40); upgrade all Expansive-hub cities |
| Express | - | Breakthrough |
| Northern Port | - | upgrade the port tile to Purple |
| Overnight | ignores fully-tokened cities (revenue 0) when calculating earnings | Breakthrough |
| Resourceful | - | Breakthrough |
| Spacious | - | buy an additional train before calculating revenue |
| Suburban | after acting, drop a suburb token on the nearest hub-less basic city it connects to | upgrade all suburb-token cities; suburbs count +20 this OR |
| Tunneling | prioritizes mountain hexes over blanks when laying yellow | place a Mountain overlay on the blank nearest each open leg in your networks |

---

## 7. Engine notes (for the eventual implementation)

This is a **separate mode from bot mode**, not a reskin. To add it:

- Model the Conglomerate as a scripted **automa**: a special corporation+seat with
  one treasury, an ordered **Action Deck** (the merged/absorbed Minors' certs), and
  a deterministic policy for SR (buy/sell rules above) and OR (train buy, the
  Action-Deck-driven basic/special/breakthrough builder, hub placement).
- Replace route tracing for the Conglomerate with the **static earnings function**
  (`trainValue x hubs` -> top-N city values, hub cities doubled).
- Reuse our map / track / hub / market model; add the **4-cycle clock** and the
  split scoring (Conglomerate treasury vs. player personal).
- Out of scope for the current playable build (bot mode). Tracked here so a future
  **Solo (Conglomerate)** mode is faithful to the 09.01 rulebook.
