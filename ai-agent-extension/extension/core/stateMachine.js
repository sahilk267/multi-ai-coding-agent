// State Machine — full implementation per reference spec.
//
// Reference state flow:
//   IDLE → PLANNING → CODING → TESTING → DEBUGGING → COMMITTING → DONE
//   Any state can be interrupted by WAITING_APPROVAL and then resumed.
//
// Aliases for backward compat:
//   EXECUTING  = CODING
//   FIXING     = DEBUGGING
//
// Extra states: PAUSED, FAILED (our extensions to the reference spec).

export const STATES = [
  "IDLE",
  "PLANNING",
  "CODING",        // primary coding state (alias EXECUTING)
  "TESTING",       // running test suite
  "DEBUGGING",     // fixing failures (alias FIXING)
  "COMMITTING",    // git stage + commit
  "DONE",
  "WAITING_APPROVAL",
  "PAUSED",
  "FAILED",
  // backward-compat aliases (treated as the canonical states by force())
  "EXECUTING",
  "FIXING",
];

const TRANSITIONS = {
  IDLE:             ["PLANNING"],
  PLANNING:         ["CODING", "EXECUTING", "WAITING_APPROVAL", "PAUSED", "FAILED"],
  CODING:           ["TESTING", "WAITING_APPROVAL", "DEBUGGING", "FIXING", "COMMITTING", "PAUSED", "DONE", "FAILED"],
  EXECUTING:        ["TESTING", "WAITING_APPROVAL", "DEBUGGING", "FIXING", "COMMITTING", "PAUSED", "DONE", "FAILED"],
  TESTING:          ["DEBUGGING", "FIXING", "COMMITTING", "WAITING_APPROVAL", "PAUSED", "FAILED"],
  DEBUGGING:        ["CODING", "EXECUTING", "TESTING", "WAITING_APPROVAL", "PAUSED", "FAILED"],
  FIXING:           ["CODING", "EXECUTING", "TESTING", "WAITING_APPROVAL", "PAUSED", "FAILED"],
  COMMITTING:       ["DONE", "CODING", "EXECUTING", "WAITING_APPROVAL", "PAUSED", "FAILED"],
  DONE:             ["IDLE", "PLANNING"],
  WAITING_APPROVAL: ["CODING", "EXECUTING", "TESTING", "DEBUGGING", "FIXING", "COMMITTING", "PAUSED", "FAILED"],
  PAUSED:           ["CODING", "EXECUTING", "PLANNING", "DEBUGGING", "FIXING", "FAILED", "DONE"],
  FAILED:           ["IDLE", "PLANNING"],
};

export class StateMachine {
  constructor(initial = "IDLE") {
    this.state = initial;
    this.subs = new Set();
    this.history = [{ state: initial, at: Date.now() }];
  }

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  can(next) {
    return (TRANSITIONS[this.state] || []).includes(next);
  }

  to(next) {
    if (!STATES.includes(next)) throw new Error("Unknown state: " + next);
    if (!this.can(next)) throw new Error(`Illegal transition ${this.state} → ${next}`);
    this._set(next);
    return next;
  }

  /** Force any state without transition check (crash recovery, external sync). */
  force(next) {
    this._set(next);
  }

  _set(state) {
    this.state = state;
    this.history.push({ state, at: Date.now() });
    if (this.history.length > 100) this.history = this.history.slice(-100);
    for (const fn of this.subs) try { fn(state); } catch {}
  }

  /** Snapshot for checkpoint persistence. */
  toJSON() {
    return { state: this.state, history: this.history };
  }
}
