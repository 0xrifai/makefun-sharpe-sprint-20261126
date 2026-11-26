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

**Mature large-cap momentum entries.** Most pump.fun launches bleed — a random entry
loses ~2% in an hour. The one pocket with positive expectancy on the dev window is
seasoned, large curves (real SOL 30–120, age past ~300 slots) with net inflow still
positive and accelerating, price pressing its window high, and at least 3 distinct buyers
with no single buyer over ~40% of window buy volume. A coin only earns a first buy of
~0.05 SOL, and there are no pyramids: adds only ever bought the top. A coin that was
exited may be bought again after a 600-slot cooldown, up to twice in total — the edge
lives on already-big coins, so one shot per coin wastes it.

**Bundle filter.** A launch whose first 3 slots already show 11+ distinct buyers or 10+
trades is a coordinated bundle (many wallets in, all out together one slot later — one
dev-window bundle dumped 84% in a single slot) and is skipped for good, however big it
grows. A creator selling while a position is held is an instant exit.

**Hourly-Sharpe governor (the core).** The bot tracks its own realized hourly returns
from batch marks and account value and keeps a rolling window of the last 3 hourly
returns. The governor only turns red on a *material* deterioration — the last hour lost
more than 2%, the rolling mean lost more than 1%, or rolling hourly volatility topped 8%.
Small consistent losses must not latch it red: a flat book stays green, and a red state
clears as soon as the window slides past the bad hour, so the governor throttles risk
instead of shutting the bot down for the whole run. When it is red: no new entries, and
exits tighten. The governor gates entries *and* exits — two-sided.

**Exits that harvest, then protect.** A breakeven partial harvest sells ~50% at +10%
and moves the stop to entry cost; a trailing stop (~15% off the peak) arms once the
position is up 10%; a hard stop sits ~15% under cost; positions also exit on net outflow
over a short window, on a single large sell, on creator selling, or after ~300 slots held
(no time exit while the position is comfortably up).

**Guardrail pacing.** Round trips need ≥0.01 SOL on ≥20 distinct mints. A probe mechanism
buys 0.01 SOL of a liquid, non-bundle curve and sells as soon as it lands — but only when
the distinct-coin count lags its prorated pace target (25 coins over the window), so the
main strategy never fee-bleeds to chase the bar when it is already on pace. Fills have no
minimum in this competition, so the probe paces on coins, not fills.

## Fees, sizing, determinism

A round trip costs ~2.5% in curve fees plus ~210k lamports of tx fees per order, so tiny
trades are fee-suicide: entries are a flat 0.05 SOL (the harness cap of 1% of real reserve
allows up to 0.3–1.2 SOL on these big curves, but bigger size only scales the same edge)
and only the pace probe ever trades at the 0.01 SOL minimum. The bot is fully deterministic — insertion-ordered Maps only,
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
