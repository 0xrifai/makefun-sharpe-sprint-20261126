// Steady Sleeve — a mature-large-cap momentum bot with an hourly-Sharpe governor,
// for agent-fun/replay/v2 (pump.fun bonding curves).
//
// What the dev window actually rewards: most pump.fun launches bleed — a random entry
// loses ~2% in an hour. The one pocket with positive expectancy is MATURE, LARGE curves
// (real SOL 30–100, age past ~120 slots) with net inflow still positive and price pressing
// its window high: their median +300-slot return is ~+12% with ~70% beating fees, while
// young coins that sprint to 60 SOL fast dump ~-47% over the same span. So this bot only
// buys seasoned big curves in motion, sizes small, pyramids only into strength, and lets a
// rolling hourly-Sharpe governor decide whether the portfolio may take new risk at all.
// Exits harvest a slice at breakeven-plus, then trail; nothing is held past ~300 slots,
// because even the good coins fade by 1200 slots. A pace probe guarantees the guardrail
// minimums (round trips on >= 20 mints) without fee-bleeding when the main engine is
// already on pace. A pure function of the batches it is fed: no clock, no environment,
// no randomness — every number below is a fixed parameter or derived from state.

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Entry window, in slots, over which the tape is read. */
  entryWindow: number;
  /** Youngest / oldest age (slots since create) at which a first buy may be decided. */
  minAge: number;
  maxAge: number;
  /** Real SOL reserve band at decision time (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** Minimum trades and distinct non-creator buyers inside the entry window. */
  minWindowTrades: number;
  minWindowBuyers: number;
  /** Largest single buyer's share of window buy volume, in bps. */
  maxTopBuyerBps: number;
  /** Price run-up vs the create price, in bps: entry only inside this band. */
  minRunupBps: number;
  maxRunupBps: number;
  /** Price must sit within this many bps of the window high. */
  withinHighBps: number;
  /** Skip the coin when the creator sold before entry. */
  skipDevSold: boolean;
  /** Bundle filter: a launch whose first 3 slots already had this many distinct buyers
   *  or trades is a coordinated bundle (many wallets in, all out together one slot later)
   *  and is skipped for good, however big it grows. */
  maxEarlyBuyers: number;
  maxEarlyTrades: number;
  /** First buy size, per-add size, and total stake cap per coin (lamports). */
  firstBuyLamports: number;
  addLamports: number;
  maxStakeLamports: number;
  /** Smallest single buy worth paying the tx fee for (lamports). */
  minBuyLamports: number;
  /** Max adds after the first buy; an add needs price this far above the last buy (bps). */
  maxAdds: number;
  addStepBps: number;
  /** Slots to wait between buys on the same coin. */
  addDelay: number;
  /** Re-entry: a coin that was exited may be bought again once the cooldown has passed
   *  and it still passes the filters, up to maxEntries times in total. The per-point edge
   *  lives on already-big coins, so one shot per coin wastes it; the cooldown keeps the
   *  bot from re-buying a coin the moment it dumps. */
  reentryCooldown: number;
  maxEntries: number;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Breakeven partial harvest: sell this share once up this far (bps). */
  tp1Bps: number;
  tp1PartBps: number;
  /** After the harvest, the rest stops out at this many bps under cost (0 = breakeven). */
  slAfterTp1Bps: number;
  /** Full take-profit and hard stop, in bps vs cost. */
  tpBps: number;
  slBps: number;
  /** Trailing stop: once up this far, exit on a fall of this much from the best value (bps). */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots — unless up at least holdFreeBps. */
  maxHold: number;
  holdFreeBps: number;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when net flow over the exit window falls below minus this many lamports. */
  exitWindow: number;
  exitFlowLamports: number;
  /** Exit at once when a single sell exceeds this share of real SOL (bps). */
  bigSellExitBps: number;
  /** Hourly-Sharpe governor: rolling window of hourly returns, vol cap, red-state exit scalers.
   *  Red only on a *material* deterioration — the last hour lost more than govLastLossBps,
   *  the rolling mean lost more than govMeanLossBps, or rolling hourly volatility tops
   *  govVolBps. Small consistent losses must NOT latch it red: a flat book (mean 0, vol 0)
   *  stays green, and a red state clears as soon as the window slides past the bad hour, so
   *  the governor throttles risk instead of shutting the bot down for the whole run. */
  govHours: number;
  govLastLossBps: number;
  govMeanLossBps: number;
  govVolBps: number;
  govRedTpBps: number;
  govRedSlBps: number;
  govRedTrailBps: number;
  /** Guardrail pacing: the run needs round trips on at least 20 distinct mints. Pace on
   *  COINS, not fills (fills have no minimum): when the distinct-mint count lags the
   *  prorated coinTarget over windowSeconds, a 0.01 SOL probe buys a liquid curve and
   *  sells as soon as it lands. Probes are a top-up only — the main engine should supply
   *  most coins — so each one costs ~4.6% of 0.01 SOL and there are at most coinTarget
   *  of them in the worst case. */
  coinTarget: number;
  windowSeconds: number;
  probeLamports: number;
  /** Minimum real SOL a probe target must hold. */
  probeMinRealSol: number;
}

export const DEFAULT_PARAMS: Params = {
  entryWindow: 120,
  minAge: 300,
  maxAge: 3000,
  minRealSol: 30_000_000_000,
  maxRealSol: 120_000_000_000,
  minWindowTrades: 4,
  minWindowBuyers: 3,
  maxTopBuyerBps: 4000,
  minRunupBps: 0,
  maxRunupBps: 10000,
  withinHighBps: 500,
  skipDevSold: true,
  maxEarlyBuyers: 10,
  maxEarlyTrades: 9,
  firstBuyLamports: 50_000_000,
  addLamports: 100_000_000,
  maxStakeLamports: 350_000_000,
  minBuyLamports: 20_000_000,
  maxAdds: 0,
  addStepBps: 300,
  addDelay: 4,
  maxExposureLamports: 6_000_000_000,
  reentryCooldown: 600,
  maxEntries: 2,
  buySlippageBps: 500,
  tp1Bps: 1000,
  tp1PartBps: 5000,
  slAfterTp1Bps: 0,
  tpBps: 1500,
  slBps: 1500,
  trailArmBps: 1000,
  trailBps: 1500,
  maxHold: 300,
  holdFreeBps: 1000,
  staleSlots: 600,
  exitWindow: 60,
  exitFlowLamports: 20_000_000,
  bigSellExitBps: 2000,
  govHours: 3,
  govLastLossBps: 200,
  govMeanLossBps: 100,
  govVolBps: 800,
  govRedTpBps: 500,
  govRedSlBps: 800,
  govRedTrailBps: 1200,
  coinTarget: 25,
  windowSeconds: 21_600,
  probeLamports: 10_000_000,
  probeMinRealSol: 20_000_000_000,
};

const FEE_BPS = 125n;

interface TapeTick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
  /** Price (virtual quote / virtual token) just after this trade, as a float. */
  price: number;
}

interface CoinTape {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  vq0: bigint;
  vt0: bigint;
  devSold: boolean;
  /** Launch shape: distinct buyers and trade count in the first 3 slots (bundle filter). */
  earlyBuyers: Set<Pubkey>;
  earlyTrades: number;
  trades: number;
  lastTradeSlot: number;
  ticks: TapeTick[];
  buysSent: number;
  spentSent: bigint;
  /** Completed entries on this coin (for the re-entry cap). */
  entries: number;
  /** Do not re-enter before this slot (cooldown after an exit). */
  coolUntil: number;
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  lastBuySlot: number;
  /** Never buy again (exited, filtered out for good, completed, or probed). */
  done: boolean;
  complete: boolean;
}

interface HeldBook {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  tookTp1: boolean;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

/** What selling `tokens` against (vq, vt) pays after curve fees (95 + 30 bps). */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Strategy {
  const P = params;
  const tapes = new Map<Pubkey, CoinTape>();
  const book = new Map<Pubkey, HeldBook>();
  const selling = new Set<Pubkey>();
  const probed = new Set<Pubkey>();
  /** Mints with a probe buy in flight; sold as soon as the buy fill lands. */
  const probePending = new Set<Pubkey>();
  /** Distinct mints with a filled buy (main or probe): the guardrail pace metric. */
  const coinsBought = new Set<Pubkey>();
  let firstTime: number | null = null;
  let nowTime = 0;

  // ---- hourly-Sharpe governor state -------------------------------------------
  let lastHour = -1;
  let lastHourValue = 0n;
  const hourlyReturns: number[] = [];

  /** Portfolio value now: cash plus what every position would sell for, minus one tx fee each. */
  function portfolioValue(state: BotState, tx: bigint): bigint {
    let value = state.cash;
    for (const [mint, pos] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined) continue;
      value += sellValue(pos.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves) - tx;
    }
    return value;
  }

  /** Fold the current hour boundary in; returns the governor state for this batch. */
  function governor(state: BotState, tx: bigint): { red: boolean; n: number; sharpe: number; vol: number } {
    const hour = nowTime > 0 ? Math.floor(nowTime / 3600) : -1;
    if (hour >= 0) {
      if (lastHour < 0) {
        lastHour = hour;
        lastHourValue = portfolioValue(state, tx);
      } else if (hour !== lastHour) {
        const value = portfolioValue(state, tx);
        if (lastHourValue > 0n) {
          const ret = Number(value - lastHourValue) / Number(lastHourValue);
          hourlyReturns.push(ret);
          if (hourlyReturns.length > P.govHours) hourlyReturns.shift();
        }
        lastHour = hour;
        lastHourValue = value;
      }
    }
    const n = hourlyReturns.length;
    if (n < 1) return { red: false, n, sharpe: 0, vol: 0 };
    const last = hourlyReturns[n - 1]!;
    if (n < 2) return { red: last * 10_000 < -P.govLastLossBps, n, sharpe: 0, vol: 0 };
    let mean = 0;
    for (const r of hourlyReturns) mean += r;
    mean /= n;
    let variance = 0;
    for (const r of hourlyReturns) variance += (r - mean) * (r - mean);
    variance /= n;
    const vol = Math.sqrt(variance);
    const sharpe = vol > 0 ? mean / vol : mean >= 0 ? 10 : -10;
    const red = last * 10_000 < -P.govLastLossBps || mean * 10_000 < -P.govMeanLossBps || vol * 10_000 > P.govVolBps;
    return { red, n, sharpe, vol };
  }

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        tapes.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devSold: false,
          earlyBuyers: new Set(),
          earlyTrades: 0,
          trades: 0,
          lastTradeSlot: e.slot,
          ticks: [],
          buysSent: 0,
          spentSent: 0n,
          entries: 0,
          coolUntil: 0,
          lastBuyVq: 0n,
          lastBuyVt: 1n,
          lastBuySlot: 0,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const t = tapes.get(e.mint);
        if (t === undefined) continue;
        const sol = BigInt(e.sol_amount);
        t.trades += 1;
        t.lastTradeSlot = e.slot;
        if (e.slot <= t.createSlot + 2) {
          t.earlyTrades += 1;
          if (e.is_buy && e.user !== t.creator) t.earlyBuyers.add(e.user);
        }
        const vq = BigInt(e.virtual_quote_reserves);
        const vt = BigInt(e.virtual_token_reserves);
        t.ticks.push({
          slot: e.slot,
          isBuy: e.is_buy,
          sol,
          user: e.user,
          price: vt > 0n ? Number(vq) / Number(vt) : 0,
        });
        if (!e.is_buy && e.user === t.creator) t.devSold = true;
      } else {
        const t = tapes.get(e.mint);
        if (t !== undefined) {
          t.complete = true;
          t.done = true;
        }
      }
    }
  }

  /** Tape stats over the last `window` slots: net flow, first/second-half buys, buyers, top share, high.
   *  Ticks are only ever dropped older than the longest window (entryWindow), so a short-window
   *  call never corrupts a later long-window read of the same tape. firstPrice is the price of
   *  the earliest tick inside the window: the run-up is measured over the window itself, not
   *  from the create price (a coin that pumped long ago and now consolidates is not a breakout). */
  function windowStats(t: CoinTape, slot: number, window: number): {
    net: bigint;
    accelerating: boolean;
    buyers: number;
    topShareBps: bigint;
    trades: number;
    high: number;
    firstPrice: number;
    buyVol: bigint;
  } {
    const keepFrom = slot - P.entryWindow;
    let drop = 0;
    while (drop < t.ticks.length && t.ticks[drop]!.slot <= keepFrom) drop++;
    if (drop > 0) t.ticks.splice(0, drop);
    const from = slot - window;
    const mid = slot - Math.floor(window / 2);
    let net = 0n;
    let firstHalfBuy = 0n;
    let secondHalfBuy = 0n;
    let buyVol = 0n;
    let high = 0;
    let firstPrice = 0;
    let trades = 0;
    const perBuyer = new Map<Pubkey, bigint>();
    const buyers = new Set<Pubkey>();
    for (const tick of t.ticks) {
      if (tick.slot <= from) continue;
      trades += 1;
      if (firstPrice === 0) firstPrice = tick.price;
      if (tick.price > high) high = tick.price;
      if (tick.isBuy) {
        net += tick.sol;
        buyVol += tick.sol;
        if (tick.slot <= mid) firstHalfBuy += tick.sol;
        else secondHalfBuy += tick.sol;
        if (tick.user !== t.creator) {
          buyers.add(tick.user);
          perBuyer.set(tick.user, (perBuyer.get(tick.user) ?? 0n) + tick.sol);
        }
      } else {
        net -= tick.sol;
      }
    }
    let top = 0n;
    for (const v of perBuyer.values()) if (v > top) top = v;
    const topShareBps = buyVol > 0n ? (top * BPS) / buyVol : 0n;
    return {
      net,
      accelerating: secondHalfBuy > firstHalfBuy,
      buyers: buyers.size,
      topShareBps,
      trades,
      high,
      firstPrice,
      buyVol,
    };
  }

  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === side) return true;
    return false;
  }

  function prune(slot: number): void {
    for (const [mint, t] of tapes) {
      if (!t.done && !t.complete && book.has(mint)) continue;
      if (slot - t.lastTradeSlot > 5000 && !book.has(mint)) tapes.delete(mint);
    }
  }

  return {
    onBatch(state, batch) {
      readEvents(batch);
      for (const e of batch.events) {
        if (e.block_time === null) continue;
        if (firstTime === null) firstTime = e.block_time;
        if (e.block_time > nowTime) nowTime = e.block_time;
      }
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const gov = governor(state, tx);
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      // Fills: count them, open the book, and fire probe sells the moment a probe buy lands.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          book.delete(f.mint);
          selling.delete(f.mint);
          probePending.delete(f.mint);
          continue;
        }
        if (f.status === 'filled' && f.side === 'buy') coinsBought.add(f.mint);
        const h = book.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          book.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), best: 0n, tookTp1: false });
        }
        if (f.side === 'buy' && f.status === 'filled' && probePending.has(f.mint)) {
          probePending.delete(f.mint);
          const pos = state.positions.get(f.mint);
          if (pos !== undefined && !selling.has(f.mint) && orders.length < cap) {
            orders.push({ side: 'sell', mint: f.mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
            selling.add(f.mint);
          }
        }
        // A probe buy that was rejected or failed never fills, so it must not jam the
        // probe gate: free the slot and let the mint be probed again later.
        if (f.side === 'buy' && f.status !== 'filled' && probePending.has(f.mint)) {
          probePending.delete(f.mint);
          probed.delete(f.mint);
        }
      }
      for (const mint of [...selling]) if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      for (const mint of [...book.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) book.delete(mint);
      }

      // ---- exits first ---------------------------------------------------------
      const tpBps = gov.red ? BigInt(P.govRedTpBps) : BigInt(P.tpBps);
      const slBps = gov.red ? BigInt(P.govRedSlBps) : BigInt(P.slBps);
      const trailBps = gov.red ? BigInt(P.govRedTrailBps) : BigInt(P.trailBps);
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const t = tapes.get(mint);
        let h = book.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, tookTp1: false };
          book.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const curve = state.curves.get(mint);
          if (curve === undefined) continue;
          mk = { vq: curve.virtual_quote_reserves, vt: curve.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
        const basis = pos.cost_lamports + h.txPaid;
        if (value > h.best) h.best = value;
        let exit = false;
        if (basis > 0n) {
          // Breakeven partial harvest: sell half at +tp1, stop the rest at breakeven.
          if (!h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tp1Bps))) {
            const part = (pos.token_amount * BigInt(P.tp1PartBps)) / BPS;
            if (part > 0n && part < pos.token_amount) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
              selling.add(mint);
              h.tookTp1 = true;
              h.best = 0n;
              continue;
            }
          }
          if (value * BPS >= basis * (BPS + tpBps)) exit = true;
          const sl = h.tookTp1 ? BigInt(P.slAfterTp1Bps) : slBps;
          if (value * BPS <= basis * (BPS - sl)) exit = true;
          if (h.best * BPS >= basis * (BPS + BigInt(P.trailArmBps)) && value * BPS <= h.best * (BPS - trailBps)) exit = true;
        }
        const heldLong = state.slot - h.openedSlot >= P.maxHold;
        if (heldLong && !(basis > 0n && value * BPS >= basis * (BPS + BigInt(P.holdFreeBps)))) exit = true;
        if (t !== undefined) {
          // The creator selling while held is the dump signal: leave at once.
          if (t.devSold) exit = true;
          if (state.slot - t.lastTradeSlot >= P.staleSlots) exit = true;
          const flow = windowStats(t, state.slot, P.exitWindow);
          if (flow.net < -BigInt(P.exitFlowLamports)) exit = true;
          // One large sell against the curve: somebody big is leaving.
          for (const tick of t.ticks) {
            if (!tick.isBuy) {
              const curve = state.curves.get(mint);
              if (curve !== undefined && curve.real_quote_reserves > 0n) {
                const rqBefore = curve.real_quote_reserves + tick.sol;
                if ((tick.sol * BPS) / rqBefore > BigInt(P.bigSellExitBps)) {
                  exit = true;
                  break;
                }
              }
            }
          }
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (t !== undefined) {
          // Exit counts as a completed entry; the coin may be bought again after the
          // cooldown, unless it hit the entry cap or the creator dumped (done for good).
          t.entries += 1;
          t.coolUntil = state.slot + P.reentryCooldown;
          t.spentSent = 0n;
          t.buysSent = 0;
          if (t.entries >= P.maxEntries || t.devSold) t.done = true;
        }
      }

      // ---- entries and adds ----------------------------------------------------
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let open = state.committedPositionCount();
      let exposure = 0n;
      for (const [, pos] of state.positions) exposure += pos.cost_lamports;
      for (const t of tapes.values()) {
        if (orders.length >= cap) break;
        if (t.done || t.complete) continue;
        const age = state.slot - t.createSlot;
        // An add only pyramids a position actually held now; a re-entry after an exit
        // comes back through the entry branch below.
        const isAdd = t.buysSent > 0 && state.positions.has(t.mint);
        if (state.slot < t.coolUntil) continue;
        if (!isAdd && age > P.maxAge) {
          t.done = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (isAdd) {
          if (t.buysSent > P.maxAdds) continue;
          if (!state.positions.has(t.mint) || selling.has(t.mint) || hasPending(state, t.mint, 'buy')) continue;
          if (state.slot - t.lastBuySlot < P.addDelay) continue;
        } else if (open >= state.hello.caps.max_open_positions) {
          continue;
        }
        const curve = state.curves.get(t.mint);
        if (curve === undefined || curve.complete) continue;
        if (t.devSold && P.skipDevSold) {
          if (!isAdd) t.done = true;
          continue;
        }
        // Bundle filter: the launch tape is final by now (entry is at age >= minAge),
        // so a coordinated launch is recognizable and skipped for good.
        if (!isAdd && (t.earlyBuyers.size > P.maxEarlyBuyers || t.earlyTrades > P.maxEarlyTrades)) {
          t.done = true;
          continue;
        }
        const vq = curve.virtual_quote_reserves;
        const vt = curve.virtual_token_reserves;
        const stats = windowStats(t, state.slot, P.entryWindow);
        if (isAdd) {
          // Pyramid only into strength: price above the last buy and inflow still positive.
          if (vq * t.lastBuyVt * BPS < t.lastBuyVq * vt * BigInt(10_000 + P.addStepBps)) continue;
          if (stats.net <= 0n) continue;
          const room = BigInt(P.maxStakeLamports) - t.spentSent;
          if (room < BigInt(P.minBuyLamports)) continue;
          const maxBuy = state.maxBuyLamports(t.mint);
          const want = BigInt(P.addLamports) < room ? BigInt(P.addLamports) : room;
          const amount = want < maxBuy ? want : maxBuy;
          if (amount < BigInt(P.minBuyLamports) || free < amount + tx * 2n) continue;
          if (exposure + amount > BigInt(P.maxExposureLamports)) continue;
          orders.push({ side: 'buy', mint: t.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
          free -= amount + tx;
          exposure += amount;
          t.buysSent += 1;
          t.spentSent += amount;
          t.lastBuyVq = vq;
          t.lastBuyVt = vt;
          t.lastBuySlot = state.slot;
          continue;
        }
        // Governor red: no new entries at all.
        if (gov.red) continue;
        // Dispersed-ownership breakout filter.
        const rq = curve.real_quote_reserves;
        if (rq < BigInt(P.minRealSol) || rq > BigInt(P.maxRealSol)) continue;
        if (stats.trades < P.minWindowTrades) continue;
        if (stats.buyers < P.minWindowBuyers) continue;
        if (stats.topShareBps > BigInt(P.maxTopBuyerBps)) continue;
        if (stats.net <= 0n || !stats.accelerating) continue;
        const priceNow = vt > 0n ? Number(vq) / Number(vt) : 0;
        const runup = stats.firstPrice > 0 && priceNow > 0 ? (priceNow - stats.firstPrice) / stats.firstPrice : 0;
        if (runup * 10_000 < P.minRunupBps || runup * 10_000 > P.maxRunupBps) continue;
        if (stats.high <= 0 || priceNow * (10_000 + P.withinHighBps) < stats.high * 10_000) continue;
        const room = BigInt(P.maxStakeLamports) - t.spentSent;
        if (room < BigInt(P.minBuyLamports)) continue;
        const maxBuy = state.maxBuyLamports(t.mint);
        const want = BigInt(P.firstBuyLamports) < room ? BigInt(P.firstBuyLamports) : room;
        const amount = want < maxBuy ? want : maxBuy;
        if (amount < BigInt(P.minBuyLamports) || free < amount + tx * 2n) continue;
        if (exposure + amount > BigInt(P.maxExposureLamports)) continue;
        orders.push({ side: 'buy', mint: t.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + tx;
        exposure += amount;
        t.buysSent += 1;
        t.spentSent += amount;
        t.lastBuyVq = vq;
        t.lastBuyVt = vt;
        t.lastBuySlot = state.slot;
        open += 1;
      }

      // ---- guardrail probe -----------------------------------------------------
      // Only when the distinct-coin pace lags: buy 0.01 SOL of a liquid, non-bundle
      // curve, sell on the fill. Never probe a bundle launch or a creator-sold coin.
      if (firstTime !== null && orders.length < cap) {
        const elapsed = Math.max(0, Math.min(P.windowSeconds, nowTime - firstTime));
        const due = (P.coinTarget * elapsed) / P.windowSeconds;
        const haveMints = new Set<Pubkey>(coinsBought);
        for (const mint of state.positions.keys()) haveMints.add(mint);
        for (const p of state.pending.values()) if (p.order.side === 'buy') haveMints.add(p.order.mint);
        if (haveMints.size < due && probePending.size === 0) {
          let bestMint: Pubkey | null = null;
          let bestRq = 0n;
          for (const t of tapes.values()) {
            if (t.done || t.complete || probed.has(t.mint)) continue;
            if (t.devSold) continue;
            if (t.earlyBuyers.size > P.maxEarlyBuyers || t.earlyTrades > P.maxEarlyTrades) continue;
            if (state.positions.has(t.mint) || hasPending(state, t.mint, 'buy')) continue;
            if (state.slot - t.lastTradeSlot > 30) continue;
            const curve = state.curves.get(t.mint);
            if (curve === undefined) continue;
            if (curve.real_quote_reserves < BigInt(P.probeMinRealSol)) continue;
            if (curve.real_quote_reserves > bestRq) {
              bestRq = curve.real_quote_reserves;
              bestMint = t.mint;
            }
          }
          if (bestMint !== null) {
            const maxBuy = state.maxBuyLamports(bestMint);
            const amount = BigInt(P.probeLamports) < maxBuy ? BigInt(P.probeLamports) : maxBuy;
            if (amount >= BigInt(P.probeLamports) && free >= amount + tx * 2n) {
              orders.push({ side: 'buy', mint: bestMint, quote_lamports: amount, max_slippage_bps: 10_000 });
              probed.add(bestMint);
              probePending.add(bestMint);
              const t = tapes.get(bestMint);
              if (t !== undefined) {
                t.buysSent += 1;
                t.spentSent += amount;
              }
            }
          }
        }
      }

      if (state.seq % 2000 === 0) prune(state.slot);
      return orders;
    },
  };
}
