// AI bot trading loop. Bots trade REAL volume through executeTrade() — the
// exact same locked AMM path players use — so the market + live feed have ambient
// activity regardless of real-player count. Reactive personalities (contrarian /
// momentum / degen) decide BUY/SELL/HOLD from recent price action, and every
// trade is impact-capped (~3%, rare 8% degen) so bots can't single-handedly
// pump/dump a coin. Re-balance injects cash when a bot is broke or fat.
//
// Driven by setInterval in hooks.server.ts (trading tick 30s, rebalance 10min).

import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { coin, userPortfolio, user, priceHistory } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { executeTrade } from '$lib/server/trading';

// Kill-switch (default on). Set BOTS_ENABLED=false to freeze the loop without a
// redeploy in dev. BOTS_TRADE_PROB overrides the per-bot trade chance.
export const BOTS_ENABLED = (env.BOTS_ENABLED ?? 'true') !== 'false';
const TRADE_PROB_PER_BOT = Number(env.BOTS_TRADE_PROB ?? '0.05');

// Sizing / liquidity gates.
const MIN_POOL_BASE = 2000; // ignore illiquid coins
const MAX_PRICE_IMPACT = 0.03; // ~3% target cap per trade
const DEGEN_PRICE_IMPACT = 0.08; // rare aggressive degen move

// Re-balance thresholds (cash only — never liquidates holdings).
const REBALANCE_LOW = 500;
const REBALANCE_HIGH = 50000;
const REBALANCE_TO = 5000;

const CACHE_TTL_BOTS = 60_000; // 60s
const CACHE_TTL_COINS = 30_000; // 30s
const MAX_ACTORS_PER_TICK = 5;

type Personality = 'contrarian' | 'momentum' | 'degen';

interface BotRow {
    id: number;
    username: string;
    image: string | null;
    baseCurrencyBalance: string;
    botPersonality: string | null;
}

interface LiquidCoinMeta {
    id: number;
    symbol: string;
    name: string;
    icon: string | null;
    circulatingSupply: string;
}

let running = false; // overlap guard — a tick never runs concurrently with itself

// --- caches (in-process; rebuilt per server instance) ---
let botsCache: BotRow[] | null = null;
let botsCacheAt = 0;
let coinsCache: LiquidCoinMeta[] | null = null;
let coinsCacheAt = 0;

async function loadBots(): Promise<BotRow[]> {
    const now = Date.now();
    if (botsCache && now - botsCacheAt < CACHE_TTL_BOTS) return botsCache;

    const rows = await db
        .select({
            id: user.id,
            username: user.username,
            image: user.image,
            baseCurrencyBalance: user.baseCurrencyBalance,
            botPersonality: user.botPersonality
        })
        .from(user)
        .where(eq(user.isBot, true));

    botsCache = rows;
    botsCacheAt = now;
    return rows;
}

async function loadLiquidCoins(): Promise<LiquidCoinMeta[]> {
    const now = Date.now();
    if (coinsCache && now - coinsCacheAt < CACHE_TTL_COINS) return coinsCache;

    const rows = await db
        .select({
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            icon: coin.icon,
            circulatingSupply: coin.circulatingSupply,
            poolBaseCurrencyAmount: coin.poolBaseCurrencyAmount
        })
        .from(coin)
        .where(
            and(
                eq(coin.isListed, true),
                eq(coin.isLocked, false)
            )
        );

    // Keep only coins with meaningful liquidity (pool > MIN_POOL_BASE). Compared
    // in JS because pool_base_currency_amount is numeric.
    const liquid = rows.filter((r) => Number(r.poolBaseCurrencyAmount) > MIN_POOL_BASE);
    coinsCache = liquid.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        icon: r.icon,
        circulatingSupply: r.circulatingSupply
    }));
    coinsCacheAt = now;
    return coinsCache;
}

function invalidateBotCache() {
    botsCache = null;
}

// % move across the most recent ~10 price_history samples for a coin. Returns 0
// when there isn't enough history to measure (fresh coins have none) — bots then
// hold/random until trades build a price trail.
async function getRecentPriceAction(coinId: number): Promise<number> {
    const rows = await db
        .select({ price: priceHistory.price })
        .from(priceHistory)
        .where(eq(priceHistory.coinId, coinId))
        .orderBy(desc(priceHistory.timestamp))
        .limit(10);

    if (rows.length < 2) return 0;
    const newest = Number(rows[0].price);
    const oldest = Number(rows[rows.length - 1].price);
    if (oldest <= 0) return 0;
    return ((newest - oldest) / oldest) * 100;
}

interface Decision {
    action: 'BUY' | 'SELL' | 'HOLD';
    impactFraction: number;
    sellFraction: number;
}

function decideAction(personality: Personality, recentPct: number): Decision {
    const base = { impactFraction: MAX_PRICE_IMPACT, sellFraction: 0.25 };
    const degenRoll = Math.random();

    if (personality === 'degen') {
        // Ignores signals: mostly buys, occasionally a bigger swing.
        const action: 'BUY' | 'SELL' = Math.random() < 0.7 ? 'BUY' : 'SELL';
        return {
            action,
            impactFraction: degenRoll < 0.05 ? DEGEN_PRICE_IMPACT : MAX_PRICE_IMPACT,
            sellFraction: 0.25
        };
    }

    if (personality === 'momentum') {
        if (recentPct >= 1) return { action: 'BUY', ...base, sellFraction: 0.5 };
        if (recentPct <= -1) return { action: 'SELL', ...base, sellFraction: 0.5 };
        return { action: 'HOLD', ...base };
    }

    // contrarian (majority)
    if (recentPct >= 2) return { action: 'SELL', ...base };
    if (recentPct <= -2) return { action: 'BUY', ...base };
    // Flat: mostly hold, sometimes a small poke to keep the tape moving.
    const roll = Math.random();
    if (roll < 0.75) return { action: 'HOLD', ...base };
    return {
        action: Math.random() < 0.5 ? 'BUY' : 'SELL',
        impactFraction: MAX_PRICE_IMPACT,
        sellFraction: 0.25
    };
}

// Current pool snapshot (no lock) for honest impact-capped sizing. executeTrade
// does the authoritative locked re-read; this is only to size the order.
async function getCurrentPool(coinId: number): Promise<{
    poolBase: number;
    poolCoin: number;
} | null> {
    const [row] = await db
        .select({
            poolBase: coin.poolBaseCurrencyAmount,
            poolCoin: coin.poolCoinAmount
        })
        .from(coin)
        .where(eq(coin.id, coinId))
        .limit(1);
    if (!row) return null;
    return { poolBase: Number(row.poolBase), poolCoin: Number(row.poolCoin) };
}

async function getHolding(botId: number, coinId: number): Promise<number> {
    const [row] = await db
        .select({ quantity: userPortfolio.quantity })
        .from(userPortfolio)
        .where(and(eq(userPortfolio.userId, botId), eq(userPortfolio.coinId, coinId)))
        .limit(1);
    return row ? Number(row.quantity) : 0;
}

// Constant-product AMM (k = poolCoin * poolBase, P = poolBase/poolCoin). Solving
// for the order size that produces exactly impact `f`:
//   BUY dollars:  x = poolBase * (sqrt(1+f) - 1)
//   SELL tokens:  q = poolCoin * (1/(1-f) - 1)
function impactCappedBuyDollars(poolBase: number, f: number, cash: number): number {
    let x = poolBase * (Math.sqrt(1 + f) - 1);
    x = Math.min(x, cash * 0.1); // never more than 10% of cash in one shot
    if (cash - x < 50) x = Math.max(0, cash - 50); // keep a small floor
    return x;
}

function impactCappedSellTokens(poolCoin: number, f: number, holding: number, fraction: number): number {
    let q = poolCoin * (1 / (1 - f) - 1);
    q = Math.min(q, holding * fraction);
    return q;
}

async function maybeTrade(bot: BotRow, coins: LiquidCoinMeta[]) {
    if (coins.length === 0) return;

    const picked = coins[Math.floor(Math.random() * coins.length)];
    const personality = (bot.botPersonality as Personality) ?? 'contrarian';
    const recentPct = await getRecentPriceAction(picked.id);
    const decision = decideAction(personality, recentPct);

    if (decision.action === 'HOLD') return;

    const pool = await getCurrentPool(picked.id);
    if (!pool || pool.poolBase <= 0 || pool.poolCoin <= 0) return;

    const cash = Number(bot.baseCurrencyBalance);

    if (decision.action === 'BUY') {
        const dollars = impactCappedBuyDollars(pool.poolBase, decision.impactFraction, cash);
        if (dollars < 1 || dollars > cash) return; // too small or can't afford

        const res = await executeTrade(bot.id, picked.symbol, 'BUY', Number(dollars.toFixed(2)));
        if (res.ok) publishTradeResult(res);
    } else {
        // SELL
        const holding = await getHolding(bot.id, picked.id);
        if (holding <= 1e-8) return;
        const tokens = impactCappedSellTokens(pool.poolCoin, decision.impactFraction, holding, decision.sellFraction);
        if (tokens <= 1e-8) return;
        // Round to 8 decimals (column scale) and guard the whole holding.
        const sellQty = Math.min(Number(tokens.toFixed(8)), holding);

        const res = await executeTrade(bot.id, picked.symbol, 'SELL', sellQty);
        if (res.ok) publishTradeResult(res);
    }
}

// Mirrors the player trade endpoint's Redis fan-out. tradeData.isBot is already
// set inside executeTrade (read from the user row), so the live feed shows the
// BOT badge with no extra plumbing here.
function publishTradeResult(res: Awaited<ReturnType<typeof executeTrade>>) {
    if (!res.tradeData || !res.priceUpdateData) return;
    try {
        redis.publish(`prices:${res.tradeData.coinSymbol}`, JSON.stringify(res.priceUpdateData)).catch(console.error);
        redis.publish('trades:all', JSON.stringify({ type: 'all-trades', data: res.tradeData })).catch(console.error);
        if ((res.totalCost ?? 0) >= 1000) {
            redis.publish('trades:large', JSON.stringify({ type: 'live-trade', data: res.tradeData })).catch(console.error);
        }
    } catch (e) {
        console.error('[bots] publish failed:', e);
    }
}

// Every 30s: pick a few bots at random and let each attempt one trade.
export async function runBotTradingTick() {
    if (!BOTS_ENABLED || running) return;
    running = true;
    try {
        const bots = await loadBots();
        if (bots.length === 0) return;
        const coins = await loadLiquidCoins();
        if (coins.length === 0) return;

        const actors = bots.filter(() => Math.random() < TRADE_PROB_PER_BOT).slice(0, MAX_ACTORS_PER_TICK);
        for (const bot of actors) {
            try {
                await maybeTrade(bot, coins);
            } catch (e) {
                console.error(`[bots] trade error for ${bot.username}:`, e);
            }
        }
    } catch (e) {
        console.error('[bots] tick error:', e);
    } finally {
        running = false;
    }
}

// Every 10min: cash-only re-balance. A bot under REBALANCE_LOW gets topped back
// up to REBALANCE_TO; one over REBALANCE_HIGH is trimmed (claws injected cash).
// Holdings are never touched.
export async function runBotRebalance() {
    if (!BOTS_ENABLED) return;
    try {
        const bots = await loadBots();
        for (const bot of bots) {
            const cash = Number(bot.baseCurrencyBalance);
            if (cash < REBALANCE_LOW || cash > REBALANCE_HIGH) {
                await db
                    .update(user)
                    .set({ baseCurrencyBalance: REBALANCE_TO.toString(), updatedAt: new Date() })
                    .where(eq(user.id, bot.id));
            }
        }
        invalidateBotCache();
    } catch (e) {
        console.error('[bots] rebalance error:', e);
    }
}
