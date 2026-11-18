// Patient Dip — a conservative cbBTC bot for the make.fun bars replay
// (agent-fun/bars-replay/v1), written for btc-race-24h-20261118-1444.
//
// Idea: a full-size round trip costs roughly 26 bps in fees, slippage and
// price impact, so casual trading bleeds money. This bot stays in cash and
// waits for a real dip: the latest close has to sit well under its recent
// average (or the trailing drop has to be deep) AND the last bar must show
// the fall pausing. Only then does it buy, with most of its cash, and it
// leaves again on a modest take-profit, a trailing give-back, a stop-loss
// or a time stop — whichever comes first. Few trades, each one planned.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// ---- tunables (basis points unless the name says otherwise) ----
const BASELINE_BARS = 90; // closes in the average a dip is measured against
const DIP_BPS = 55; // buy when the close is this far under the baseline
const DROP_LOOKBACK = 120; // bars in the trailing-drop measurement
const DROP_BPS = 65; // ...or when that trailing drop is at least this deep
const KNIFE_BPS = 70; // skip entries while the baseline falls faster than this
const KNIFE_LOOKBACK = 30; // bars over which the baseline's fall is measured
const TAKE_PROFIT_BPS = 60; // sell when the position is worth this over cost
const STOP_LOSS_BPS = 110; // sell when it is worth this under cost
const TRAIL_ARM_BPS = 45; // trailing exit arms once the gain reaches this
const TRAIL_GIVEBACK_BPS = 35; // ...and fires this far under the peak value
const MAX_HOLD_BARS = 360; // time stop: never hold longer than this
const COOLDOWN_BARS = 45; // flat bars to wait after an exit before re-entry
const SPEND_BPS = 9_700; // share of the cash balance one buy uses, of 10_000
const ORDER_SLIPPAGE_BPS = 200; // max_slippage_bps sent with every order
const LAST_ENTRY_SEQ = 1_380; // no fresh entries this late in a 1,440 bar window

// ---- run state (a pure function of the bars seen; no clock, no random) ----
const closes: number[] = []; // recent closes, oldest first, as plain numbers
let entrySeq = -1; // batch seq on which the open position was decided
let peakRatio = 0; // best value/cost ratio seen for the open position
let lastExitSeq = -10_000; // batch seq of the last decided exit
let pendingSince = -1; // seq a buy or sell was decided on, awaiting its fill

function pushClose(state: BarsState): void {
  const c = state.close(SYMBOL);
  if (c === null) return;
  closes.push(Number(c));
  if (closes.length > 600) closes.shift();
}

function meanOfLast(n: number): number {
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i]!;
  return sum / n;
}

/** True when the dip is real and the fall looks paused on the latest bar. */
function dipSetup(): boolean {
  const n = closes.length;
  if (n < Math.max(BASELINE_BARS, DROP_LOOKBACK) + KNIFE_LOOKBACK) return false;
  const last = closes[n - 1]!;
  const prev = closes[n - 2]!;
  if (last < prev) return false; // still falling on the latest bar: wait
  const baseline = meanOfLast(BASELINE_BARS);
  const underBaseline = ((baseline - last) / baseline) * 10_000 >= DIP_BPS;
  const trailing = ((closes[n - 1 - DROP_LOOKBACK]! - last) / closes[n - 1 - DROP_LOOKBACK]!) * 10_000;
  const deepDrop = trailing >= DROP_BPS;
  if (!underBaseline && !deepDrop) return false;
  // Knife guard: a baseline that is itself sliding fast means the dip is
  // part of a slide, not a pause in one.
  let oldSum = 0;
  for (let i = n - KNIFE_LOOKBACK - BASELINE_BARS; i < n - KNIFE_LOOKBACK; i++) oldSum += closes[i]!;
  const oldBaseline = oldSum / BASELINE_BARS;
  if (((oldBaseline - baseline) / oldBaseline) * 10_000 > KNIFE_BPS) return false;
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
      return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: ORDER_SLIPPAGE_BPS }];
    }
    return [];
  }

  // Flat: look for the next dip, respecting the cooldown and the late window.
  if (batch.seq - lastExitSeq < COOLDOWN_BARS) return [];
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
