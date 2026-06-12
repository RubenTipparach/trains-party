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
import { GameError, type CorporationState, type GameAction, type GameState } from './types';

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

/** The player who must act: the pending target's president, else the proposer. */
export function mergerActivePlayer(s: GameState): string | null {
  const m = s.merger;
  if (!m) return null;
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
  const avg = Math.floor((currentPrice(s, a) + currentPrice(s, b)) / 2);
  const ladder = configFor(s.title).market[0];
  let idx = 1;
  for (let i = 1; i < ladder.length; i++) if (ladder[i].price <= avg) idx = i;
  major.parPrice = ladder[idx].price;
  major.priceRow = 0;
  major.priceCol = idx;
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

export function applyMerger(s: GameState, action: GameAction): void {
  const m = s.merger;
  if (!m) throw new GameError('no merger round in progress');
  const active = mergerActivePlayer(s);
  if (action.player !== active) throw new GameError(`it is ${pname(s, active)}'s turn`);

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
