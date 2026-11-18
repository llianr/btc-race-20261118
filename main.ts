// Patient Dip — a conservative cbBTC bot for the make.fun bars replay
// (agent-fun/bars-replay/v1), written for btc-race-24h-20261118-1444.
//
// Idea: a full-size round trip costs roughly 26 bps in fees, slippage and
// price impact, so casual trading bleeds money. This bot stays in cash and
// waits for a real dip: a fast, deep drop over the last two hours whose
// fall has visibly paused — the latest bar closes up and already lifted
// off the recent low. Only then does it buy, with most of its cash, and it
// leaves again on a modest take-profit, a trailing give-back, a stop-loss
// or a time stop — whichever comes first. Few trades, each one planned.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// ---- tunables (basis points unless the name says otherwise) ----
// v2 (after the first local grade lost money): the v1 trigger — "close a
// little under its 90-bar average" — fired twice in a slow sideways bleed
// where no real dip existed, and those two trades ate the one good trade.
// The trigger is now a fast drop plus a visible lift off the low.
const DROP_LOOKBACK = 120; // bars in the trailing-drop measurement
const DROP_BPS = 85; // buy only after a drop at least this deep, this fast
const LIFT_BPS = 12; // the close must already be this far off the recent low
const LIFT_WINDOW = 10; // bars the recent low is taken over
const TAKE_PROFIT_BPS = 55; // sell when the position is worth this over cost
const STOP_LOSS_BPS = 85; // sell when it is worth this under cost
const TRAIL_ARM_BPS = 40; // trailing exit arms once the gain reaches this
const TRAIL_GIVEBACK_BPS = 30; // ...and fires this far under the peak value
const MAX_HOLD_BARS = 300; // time stop: never hold longer than this
const COOLDOWN_BARS = 60; // flat bars to wait after an exit before re-entry
const STOP_COOLDOWN_BARS = 120; // ...and twice that after a stop-loss exit
const SPEND_BPS = 9_700; // share of the cash balance one buy uses, of 10_000
const ORDER_SLIPPAGE_BPS = 200; // max_slippage_bps sent with every order
const LAST_ENTRY_SEQ = 1_380; // no fresh entries this late in a 1,440 bar window

// ---- run state (a pure function of the bars seen; no clock, no random) ----
const closes: number[] = []; // recent closes, oldest first, as plain numbers
let entrySeq = -1; // batch seq on which the open position was decided
let peakRatio = 0; // best value/cost ratio seen for the open position
let lastExitSeq = -10_000; // batch seq of the last decided exit
let cooldownBars = COOLDOWN_BARS; // bars to wait after that exit (longer after a stop)
let pendingSince = -1; // seq a buy or sell was decided on, awaiting its fill

function pushClose(state: BarsState): void {
  const c = state.close(SYMBOL);
  if (c === null) return;
  closes.push(Number(c));
  if (closes.length > 600) closes.shift();
}

/** True after a fast drop whose fall has visibly paused on the latest bars. */
function dipSetup(): boolean {
  const n = closes.length;
  if (n < DROP_LOOKBACK + LIFT_WINDOW) return false;
  const last = closes[n - 1]!;
  const prev = closes[n - 2]!;
  if (last <= prev) return false; // the latest bar must close up, not flat/down
  const ref = closes[n - 1 - DROP_LOOKBACK]!;
  if (((ref - last) / ref) * 10_000 < DROP_BPS) return false; // drop too shallow
  let low = Infinity;
  for (let i = n - LIFT_WINDOW; i < n; i++) if (closes[i]! < low) low = closes[i]!;
  if (((last - low) / low) * 10_000 < LIFT_BPS) return false; // still on the low
  return true;
}

function onBatch(state: BarsState, batch: { seq: number }): OrderInput[] {
  pushClose(state);
  if (state.warmingUp) return [];
  const pos = state.positions.get(SYMBOL);
  const holding = pos !== undefined && pos.qty > 0n;

  // A decided order fills (or is rejected) at the next bar's open and the
  // batch after that reports it; give it two batches before deciding again.
  if (pendingSince >= 0) {
    if (batch.seq - pendingSince < 2) return [];
    pendingSince = -1;
  }

  if (holding) {
    const value = state.value(SYMBOL, pos.qty);
    const ratio = Number(value) / Number(pos.cost);
    if (ratio > peakRatio) peakRatio = ratio;
    const heldBars = batch.seq - entrySeq;
    const takeProfit = ratio >= 1 + TAKE_PROFIT_BPS / 10_000;
    const stopLoss = ratio <= 1 - STOP_LOSS_BPS / 10_000;
    const trailed =
      peakRatio >= 1 + TRAIL_ARM_BPS / 10_000 && ratio <= peakRatio - TRAIL_GIVEBACK_BPS / 10_000;
    const timedOut = heldBars >= MAX_HOLD_BARS;
    if (takeProfit || stopLoss || trailed || timedOut) {
      pendingSince = batch.seq;
      lastExitSeq = batch.seq;
      // A stop-loss means the dip was not finished falling: sit out longer.
      cooldownBars = stopLoss ? STOP_COOLDOWN_BARS : COOLDOWN_BARS;
      return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: ORDER_SLIPPAGE_BPS }];
    }
    return [];
  }

  // Flat: look for the next dip, respecting the cooldown and the late window.
  if (batch.seq - lastExitSeq < cooldownBars) return [];
  if (batch.seq > LAST_ENTRY_SEQ) return [];
  if (!dipSetup()) return [];
  const spend = (state.cash * BigInt(SPEND_BPS)) / 10_000n;
  if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
  pendingSince = batch.seq;
  entrySeq = batch.seq;
  peakRatio = 0;
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: ORDER_SLIPPAGE_BPS }];
}

await runBars({ onBatch });
