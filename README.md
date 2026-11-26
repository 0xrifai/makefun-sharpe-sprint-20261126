[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/competition/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/0xrifai/makefun-sharpe-sprint-20261126/rank.svg)](https://make.fun/competition/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/0xrifai/makefun-sharpe-sprint-20261126/reward.svg)](https://make.fun/competition/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# Steady Sleeve — Pump.fun Sharpe Sprint Bot

A paper-trading bot for the make.fun **Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins**
competition (`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`). It trades pump.fun
bonding curves on the `agent-fun/replay/v2` protocol with one goal: the highest **hourly
Sharpe ratio** on a 6-hour forward replay, not the wildest PnL. Steady, controlled gains
beat one lucky moonshot — so this bot is built to be boring on purpose.

## How it trades

**Dispersed-ownership breakout entries.** A coin only earns a first buy when its launch
tape looks retail, not bundled: the curve is mature enough to have a tape, net inflow over
the recent window is positive *and* accelerating (the second half of the window buys more
than the first), at least 5 distinct non-creator buyers showed up, no single buyer owns
more than ~40% of the window's buy volume, the price is up 5–50% over the window and
sitting within 5% of its window high, and real SOL sits in a sane 2–60 SOL band. The
creator must not have sold. Whale-dominated or bundle-looking launches are skipped.

**Small first buys, pyramid only into strength.** The first buy is ~0.05 SOL. Adds only
happen when the price is above the last buy and inflow is still positive, up to ~0.3–0.5
SOL per position, with total exposure capped near 4–6 SOL of the 10 SOL paper capital.
Every buy respects the harness cap of 1% of the curve's real SOL reserve.

**Hourly-Sharpe governor (the core).** The bot tracks its own realized hourly returns
from batch marks and account value and keeps a rolling window of the last 6 hourly
returns. When the rolling Sharpe goes negative, or rolling hourly volatility spikes above
its threshold, the governor turns red: no new entries, and exits accelerate. When it is
green, the bot trades normally. The governor gates entries *and* exits — two-sided.

**Exits that harvest, then protect.** A breakeven partial harvest sells ~50% at +8–12%
and moves the stop to entry cost; a trailing stop (~20–30% off the peak) arms once the
position is up; a hard stop sits ~12–15% under cost; positions also exit on net outflow
over a short window, on a single large sell, or after ~1000–1500 slots held (no time exit
while the position is comfortably up).

**Guardrail pacing.** Round trips need ≥0.01 SOL on ≥20 distinct mints. A probe mechanism
buys 0.01 SOL of a liquid curve and sells as soon as it lands — but only when the fill /
distinct-coin pace lags its target, so the main strategy never fee-bleeds to chase the bar
when it is already on pace.

## Fees, sizing, determinism

A round trip costs ~2.5% in curve fees plus ~210k lamports of tx fees per order, so tiny
trades are fee-suicide: entries are sized 0.05–0.5 SOL and only the pace probe ever trades
at the 0.01 SOL minimum. The bot is fully deterministic — insertion-ordered Maps only,
no clock, no environment, no `Math.random`; any randomness would be seeded only from
`state.hello.seed`. It is executed twice by the grader and the two action logs must match
byte-for-byte.

## Run it

```sh
node main.ts   # speaks agent-fun/replay/v2 on stdin/stdout
```

`main.ts` wires the strategy in `strategy.ts` to the vendored SDK shim in
`vendor/agentfun-bot.ts` (copied byte-for-byte from the competition kit, excluded from
authorship counts). Node 22. No dependencies, no network, no secrets.
