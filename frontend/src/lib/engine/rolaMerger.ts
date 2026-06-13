/**
 * Railways of the Lost Atlas Merger Round: after both ORs (once the first green
 * train has been bought or exported), minors may pair up into Major
 * Corporations, in descending stock order (rulebook p.18).
 *
 * - A minor's president proposes to a connected minor (one with a hub token the
 *   proposer can trace a route to). Same president on both sides merges at
 *   once; otherwise the other president must accept (bots decline).
 * - A declined pairing cannot be re-proposed this round.
 * - The merged Major: president = most combined shares (tie: earlier in stock
 *   order); shares convert 1:1 by certificate count (20% minor -> 10% major);
 *   price = average of the two, rounded down onto the ladder; hubs merge with
 *   one-per-hex dedupe; treasuries and trains combine (over-limit discards to
 *   the pool); the minors' abilities persist via `mergedFrom`.
 */

import { configFor } from './registry';
import { network } from './track';
import { stampPrice, currentPrice } from './stock';
import { advanceCycleAfterOrs, discardOverLimit } from './operating';
import {
  GameError,
  type CorporationState,
  type GameAction,
  type GameState,
  type MergerState
} from './types';

function corp(s: GameState, sym: string): CorporationState {
  const c = s.corporations.find((x) => x.sym === sym);
  if (!c) throw new GameError(`unknown company ${sym}`);
  return c;
}
const pname = (s: GameState, id: string | null) =>
  s.players.find((p) => p.id === id)?.name ?? id ?? '-';
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Stock-order sort used for the proposal queue and presidency tie-breaks. */
function stockOrder(s: GameState, syms: string[]): string[] {
  return [...syms].sort((a, b) => {
    const ca = corp(s, a);
    const cb = corp(s, b);
    return (
      currentPrice(s, cb) - currentPrice(s, ca) || ca.stackSeq - cb.stackSeq || a.localeCompare(b)
    );
  });
}

/** The new major's starting market cell: average of the two minor prices,
 *  rounded down onto the ladder. Drives both the major's price and the
 *  hostile-vote "would my shares gain value?" test. */
function mergedPriceCell(s: GameState, aSym: string, bSym: string): { idx: number; price: number } {
  const avg = Math.floor((currentPrice(s, corp(s, aSym)) + currentPrice(s, corp(s, bSym))) / 2);
  const ladder = configFor(s.title).market[0];
  let idx = 1;
  for (let i = 1; i < ladder.length; i++) if (ladder[i].price <= avg) idx = i;
  return { idx, price: ladder[idx].price };
}

/** Start the merger round if the title mergers and the green phase has begun. */
export function maybeStartMergerRound(s: GameState): boolean {
  const cfg = configFor(s.title);
  if (!cfg.minors) return false;
  const phaseIdx = cfg.phases.findIndex((p) => p.name === s.phase);
  const greenIdx = cfg.phases.findIndex((p) => p.name === '3');
  if (greenIdx < 0 || phaseIdx < greenIdx) return false;
  const minors = s.corporations
    .filter((c) => c.kind === 'minor' && c.floated && !c.dissolved)
    .map((c) => c.sym);
  if (minors.length < 2) return false;
  if (!s.corporations.some((c) => c.kind === 'major' && !c.floated)) return false;
  s.round = 'merger';
  s.merger = { queue: stockOrder(s, minors), index: 0, declined: [], pending: null };
  s.log.push('Merger round begins');
  return true;
}

/** The player who must act: the next unvoted shareholder during a hostile vote,
 *  else the pending target's president, else the proposer at the queue front. */
export function mergerActivePlayer(s: GameState): string | null {
  const m = s.merger;
  if (!m) return null;
  if (m.vote) return m.vote.voters.find((id) => !(id in m.vote!.ballots)) ?? null;
  if (m.pending) return corp(s, m.pending.to).president;
  const sym = m.queue[m.index];
  return sym ? corp(s, sym).president : null;
}

/** Minors the queue-front company may propose to right now. */
export function mergePartners(s: GameState, sym: string): string[] {
  const m = s.merger;
  const a = corp(s, sym);
  const net = network(s, a);
  return s.corporations
    .filter(
      (c) =>
        c.kind === 'minor' &&
        c.floated &&
        !c.dissolved &&
        c.sym !== sym &&
        !(m?.declined ?? []).includes(pairKey(sym, c.sym)) &&
        c.tokenHexes.some((h) => net.has(h))
    )
    .map((c) => c.sym);
}

/** Unfloated majors available to take in a merge. */
export function availableMajors(s: GameState): string[] {
  return s.corporations.filter((c) => c.kind === 'major' && !c.floated).map((c) => c.sym);
}

function doMerge(s: GameState, aSym: string, bSym: string, majorSym: string): void {
  const a = corp(s, aSym);
  const b = corp(s, bSym);
  const major = corp(s, majorSym);
  if (major.kind !== 'major' || major.floated) throw new GameError(`${majorSym} is not available`);

  // President: most combined shares; tie -> president of the company that
  // operates earlier (stock order).
  let best: { id: string; pct: number } | null = null;
  const firstSym = stockOrder(s, [aSym, bSym])[0];
  for (const p of s.players) {
    const pct = (p.shares[aSym] ?? 0) + (p.shares[bSym] ?? 0);
    if (pct > (best?.pct ?? -1)) best = { id: p.id, pct };
    else if (best && pct === best.pct && p.id === corp(s, firstSym).president) best = { id: p.id, pct };
  }

  // Shares convert 1:1 by certificate count: each 20% minor share -> 10% major.
  for (const p of s.players) {
    const certs = ((p.shares[aSym] ?? 0) + (p.shares[bSym] ?? 0)) / 20;
    delete p.shares[aSym];
    delete p.shares[bSym];
    if (certs > 0) p.shares[majorSym] = certs * 10;
  }
  major.poolShares = ((a.poolShares + b.poolShares) / 20) * 10;
  const held = s.players.reduce((n, p) => n + (p.shares[majorSym] ?? 0), 0);
  major.ipoShares = 100 - held - major.poolShares;
  major.president = best?.id ?? null;

  // Price: average of the two, rounded down onto the ladder.
  const cell = mergedPriceCell(s, aSym, bSym);
  major.parPrice = cell.price;
  major.priceRow = 0;
  major.priceCol = cell.idx;
  stampPrice(s, major);

  // Hubs merge (one per hex; duplicates return), treasuries and trains combine.
  major.tokenHexes = [...new Set([...a.tokenHexes, ...b.tokenHexes])];
  major.cash = a.cash + b.cash;
  major.trains = [...a.trains, ...b.trains];
  major.companies = [...a.companies, ...b.companies];
  major.floated = true;
  major.operated = true;
  major.mergedFrom = [aSym, bSym];
  discardOverLimit(s, major);

  // The minors leave the game (certificates and tokens return to the box).
  for (const c of [a, b]) {
    c.dissolved = true;
    c.floated = false;
    c.president = null;
    c.priceRow = null;
    c.priceCol = null;
    c.tokenHexes = [];
    c.trains = [];
    c.cash = 0;
    c.ipoShares = 0;
    c.poolShares = 0;
  }
  s.log.push(
    `${aSym} and ${bSym} merge into ${majorSym} (president ${pname(s, major.president)}, price ${major.parPrice})`
  );
}

function endMergerRound(s: GameState): void {
  s.merger = null;
  s.log.push('Merger round complete');
  advanceCycleAfterOrs(s);
}

function advanceQueue(s: GameState): void {
  const m = s.merger!;
  m.queue = m.queue.filter((sym) => !corp(s, sym).dissolved);
  if (m.index >= m.queue.length) endMergerRound(s);
}

/** Hostile-mergers variant: open a share vote on a refused cross-player proposal.
 *  The proposer's holdings are pre-counted `for`; every other holder of either
 *  minor must still vote. With no other shareholders, the vote resolves at once. */
function startVote(
  s: GameState,
  m: MergerState,
  from: string,
  to: string,
  major: string,
  proposer: string
): void {
  const voters = s.players
    .filter((p) => (p.shares[from] ?? 0) > 0 || (p.shares[to] ?? 0) > 0)
    .map((p) => p.id)
    .filter((id) => id !== proposer);
  m.vote = { from, to, major, ballots: { [proposer]: 'for' }, voters };
  s.log.push(`${from} makes a hostile bid to merge ${to} into ${major}; shareholders vote`);
  if (voters.every((id) => id in m.vote!.ballots)) resolveVote(s, m);
}

/** Tally a completed hostile vote, then merge or reject. Treasury (IPO) shares
 *  abstain; each minor's pooled shares vote with that minor's value change (up
 *  = for, down = against, unchanged = abstain); a player's ballot carries their
 *  combined holdings in both minors. A strict majority `for` forces the merge. */
function resolveVote(s: GameState, m: MergerState): void {
  const v = m.vote!;
  const newPrice = mergedPriceCell(s, v.from, v.to).price;
  let forPct = 0;
  let againstPct = 0;
  for (const sym of [v.from, v.to]) {
    const c = corp(s, sym);
    if (!c.poolShares) continue;
    const price = currentPrice(s, c);
    if (newPrice > price) forPct += c.poolShares;
    else if (newPrice < price) againstPct += c.poolShares;
  }
  for (const p of s.players) {
    const w = (p.shares[v.from] ?? 0) + (p.shares[v.to] ?? 0);
    if (!w) continue;
    if (v.ballots[p.id] === 'for') forPct += w;
    else if (v.ballots[p.id] === 'against') againstPct += w;
  }
  const { from, to, major } = v;
  m.vote = null;
  if (forPct > againstPct) {
    s.log.push(`Hostile merger of ${from} and ${to} carries ${forPct}% to ${againstPct}%`);
    doMerge(s, from, to, major);
    advanceQueue(s);
  } else {
    m.declined.push(pairKey(from, to));
    s.log.push(`Hostile merger of ${from} with ${to} fails ${forPct}% to ${againstPct}%`);
  }
}

export function applyMerger(s: GameState, action: GameAction): void {
  const m = s.merger;
  if (!m) throw new GameError('no merger round in progress');
  const active = mergerActivePlayer(s);
  if (action.player !== active) throw new GameError(`it is ${pname(s, active)}'s turn`);

  if (m.vote) {
    // A hostile share vote is open: the active shareholder casts their ballot.
    if (action.type !== 'cast_merge_vote') throw new GameError('cast your merger vote first');
    m.vote.ballots[action.player] = action.vote;
    if (m.vote.voters.every((id) => id in m.vote!.ballots)) resolveVote(s, m);
    return;
  }

  if (m.pending) {
    // The target's president answers a cross-player proposal.
    const { from, to, major } = m.pending;
    if (action.type === 'accept_merge') {
      m.pending = null;
      doMerge(s, from, to, major);
      advanceQueue(s);
      return;
    }
    if (action.type === 'decline_merge' || action.type === 'pass') {
      m.declined.push(pairKey(from, to));
      m.pending = null;
      s.log.push(`${pname(s, active)} declines merging ${to} with ${from}`);
      return;
    }
    throw new GameError('answer the pending merger proposal first');
  }

  const sym = m.queue[m.index];
  switch (action.type) {
    case 'propose_merge': {
      if (action.from !== sym) throw new GameError(`${sym} is proposing now, not ${action.from}`);
      if (!mergePartners(s, sym).includes(action.to)) {
        throw new GameError(`${sym} cannot reach ${action.to} (or it was already declined)`);
      }
      if (!availableMajors(s).includes(action.major)) {
        throw new GameError(`${action.major} is not an available corporation`);
      }
      const target = corp(s, action.to);
      if (target.president === action.player) {
        doMerge(s, sym, action.to, action.major);
        advanceQueue(s);
      } else if (s.hostileMergers) {
        startVote(s, m, sym, action.to, action.major, action.player);
      } else {
        m.pending = { from: sym, to: action.to, major: action.major };
        s.log.push(`${sym} proposes merging with ${action.to} into ${action.major}`);
      }
      break;
    }
    case 'pass':
      m.index += 1;
      s.log.push(`${sym} passes on merging`);
      advanceQueue(s);
      break;
    default:
      throw new GameError('unsupported merger-round action');
  }
}
