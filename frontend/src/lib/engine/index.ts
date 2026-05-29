/**
 * Trains Party rules engine (TypeScript port of the 18xx engine model).
 *
 * This engine is pure, deterministic, and isomorphic: it runs in the browser
 * (sandbox / optimistic UI) and on the server (authoritative validation). It must
 * stay free of DOM, network, and framework imports.
 *
 * Core idea (see design.md / CLAUDE.md): state is a function of static config plus
 * an ordered action list.
 *
 *     state = actions.reduce(apply, initialState(config))
 *
 * Stage 0: type sketch only. The 1889 state model, action union, and the
 * round -> step -> action state machine arrive in later stages.
 */

/** Monotonic action index; a snapshot is identified by its highest sequence. */
export type Sequence = number;

/** A serializable player decision. The action log IS the game. */
export interface GameAction {
  /** Discriminant, e.g. "lay_tile" | "buy_shares" | "run_routes" | "pass". */
  type: string;
  /** Entity id that performed the action (player or corporation). */
  entity: string;
  /** Action-specific payload. Typed per action in later stages. */
  readonly [key: string]: unknown;
}

/** Opaque engine state. Defined concretely once the 1889 model lands. */
export interface GameState {
  rulesVersion: string;
  sequence: Sequence;
}

/** Apply one action to produce the next state. Pure; no I/O. */
export function apply(_state: GameState, _action: GameAction): GameState {
  throw new Error('engine.apply not implemented yet (Stage 2)');
}

/** Replay an ordered action list from an initial state. */
export function replay(initial: GameState, actions: readonly GameAction[]): GameState {
  return actions.reduce(apply, initial);
}
