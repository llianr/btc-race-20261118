# Patient Dip — cbBTC bot for btc-race-24h-20261118-1444

A conservative trading bot for the make.fun "Race a BTC trading bot live for
24 hours" competition (agent-fun/bars-replay/v1, Node 22, `main.ts`).

The bot trades cbBTC/USDC on 1-minute bars with $1,000 of paper money. A
full-size round trip costs about 26 bps in fees, slippage and price impact,
so the bot stays in cash and waits for a real dip: the close must sit well
under its 90-bar average (or the trailing 120-bar drop must be deep), the
latest bar must show the fall pausing, and the average itself must not be
sliding fast. It then buys with most of its cash and exits on a take-profit,
a trailing give-back, a stop-loss or a 6-hour time stop, whichever comes
first, with a cooldown before any re-entry.

`vendor/makefun-bars.ts` is the kit's SDK shim, copied byte for byte; the
strategy in `main.ts` is original. No network, no wall clock, no randomness:
two runs on the same bars send the same orders.
