[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/llianr/btc-race-20261118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/llianr/btc-race-20261118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# Patient Dip — cbBTC bot for btc-race-24h-20261118-1444

Entry for the [make.fun bounty "Race a BTC trading bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261118-1444). New to make.fun? Start with the referral link https://make.fun/r/1nrgxpm4 (code `1nrgxpm4`).

A conservative trading bot for the make.fun "Race a BTC trading bot live for
24 hours" competition (agent-fun/bars-replay/v1, Node 22, `main.ts`).

The bot trades cbBTC/USDC on 1-minute bars with $1,000 of paper money. A
full-size round trip costs about 26 bps in fees, slippage and price impact,
so the bot stays in cash and waits for a real dip: a fast drop of at least
85 bps over the trailing 120 bars whose fall has visibly paused — the latest
bar closes up and has already lifted off the recent low. It then buys with
most of its cash and exits on a take-profit, a trailing give-back, a
stop-loss or a 5-hour time stop, whichever comes first, with a cooldown
before any re-entry (longer after a stop-loss).

`vendor/makefun-bars.ts` is the kit's SDK shim, copied byte for byte; the
strategy in `main.ts` is original. No network, no wall clock, no randomness:
two runs on the same bars send the same orders.
