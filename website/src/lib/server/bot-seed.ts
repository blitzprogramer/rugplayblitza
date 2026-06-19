// Idempotent seed for the AI-bot feature: 10 popular-ticker coins (so bots have
// a liquid market and new players see activity from signup) + 30 bot traders
// that act on those coins. Safe to re-run — existing symbols/emails are skipped.
//
// Invoked only via the admin endpoint POST /api/admin/seed-bots (requireAdmin).
// NOT wired into the scheduler — that would re-seed prod on every cold start.

import { db } from '$lib/server/db';
import { coin, user } from '$lib/server/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';

// Seed coins: popular-company tickers, priced like normal mid-cap tokens (max
// ~$30/token, NFLX). The `price` in SEED_COINS is only a realistic reference used
// to set RELATIVE prices; the per-token price scales so the priciest reference
// (NFLX) maps to SEED_MAX_TOKEN_PRICE. Supply is a low float so market caps stay
// modest and beatable by player coins (1B supply × $30 would be a $30B mcap).
// Pool is $20k base per side; price impact tracks pool base, not token count.
const POOL_BASE = 20000;
const SEED_MAX_TOKEN_PRICE = 30; // priciest seed coin lists at ~$30/token
const SEED_SUPPLY = 50_000; // low float → beatable market caps (~$70k–$1.5m)

const SEED_COINS: { symbol: string; name: string; price: number }[] = [
    { symbol: 'AAPL', name: 'Apple Inc.', price: 195.5 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', price: 420.3 },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 175.2 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 185.4 },
    { symbol: 'META', name: 'Meta Platforms', price: 505.1 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 122.8 },
    { symbol: 'TSLA', name: 'Tesla Inc.', price: 248.5 },
    { symbol: 'NFLX', name: 'Netflix Inc.', price: 685.2 },
    { symbol: 'AMD', name: 'Advanced Micro Devices', price: 158.4 },
    { symbol: 'INTC', name: 'Intel Corp.', price: 32.1 }
];

// Highest reference price (NFLX 685.2) — used to scale per-token prices so the
// priciest seed coin lands at SEED_MAX_TOKEN_PRICE.
const SEED_MAX_REF_PRICE = Math.max(...SEED_COINS.map((c) => c.price));

// Trader-flavored handles (<=30 chars) so bots blend into the live feed. Each
// maps to a personality; ordering below sets the 18/8/4 contrarian/momentum/degen split.
const BOT_NAMES: { username: string; name: string }[] = [
    { username: 'moon_chaser', name: 'Moon Chaser' },
    { username: 'diamond_hands', name: 'Diamond Hands' },
    { username: 'ape_master', name: 'Ape Master' },
    { username: 'fomo_buyer', name: 'FOMO Buyer' },
    { username: 'dip_hunter', name: 'Dip Hunter' },
    { username: 'rug_survivor', name: 'Rug Survivor' },
    { username: 'whale_watcher', name: 'Whale Watcher' },
    { username: 'pump_rider', name: 'Pump Rider' },
    { username: 'bag_holder', name: 'Bag Holder' },
    { username: 'gamma_squeeze', name: 'Gamma Squeeze' },
    { username: 'leverage_king', name: 'Leverage King' },
    { username: 'short_squeeze', name: 'Short Squeeze' },
    { username: 'alpha_hunter', name: 'Alpha Hunter' },
    { username: 'beta_trader', name: 'Beta Trader' },
    { username: 'sigma_grind', name: 'Sigma Grind' },
    { username: 'delta_neutral', name: 'Delta Neutral' },
    { username: 'theta_decay', name: 'Theta Decay' },
    { username: 'volatility_max', name: 'Volatility Max' },
    // momentum / FOMO
    { username: 'margin_caller', name: 'Margin Caller' },
    { username: 'bull_market', name: 'Bull Market' },
    { username: 'bear_raid', name: 'Bear Raid' },
    { username: 'flip_stonks', name: 'Flip Stonks' },
    { username: 'tendie_lord', name: 'Tendie Lord' },
    { username: 'rocket_emoji', name: 'Rocket Emoji' },
    { username: 'wen_lambo', name: 'Wen Lambo' },
    { username: 'gm_wagmi', name: 'GM Wagmi' },
    // degen
    { username: 'ser_fren', name: 'Ser Fren' },
    { username: 'ngmi_chad', name: 'NGMI Chad' },
    { username: 'liquidation_joe', name: 'Liquidation Joe' },
    { username: 'max_leverage', name: 'Max Leverage' }
];

type Personality = 'contrarian' | 'momentum' | 'degen';

function personalityFor(index: number): Personality {
    if (index < 18) return 'contrarian';
    if (index < 26) return 'momentum';
    return 'degen';
}

const BOT_STARTING_BALANCE = 5000;
const MAX_STORABLE = 1e38;

export interface SeedResult {
    coinsSeeded: number;
    coinsSkipped: number;
    botsSeeded: number;
    botsSkipped: number;
}

export async function seedBotsAndCoins(): Promise<SeedResult> {
    const result: SeedResult = {
        coinsSeeded: 0,
        coinsSkipped: 0,
        botsSeeded: 0,
        botsSkipped: 0
    };

    // --- Coins (idempotent by symbol) ---
    const seedSymbols = SEED_COINS.map((c) => c.symbol);
    const existingCoins = await db
        .select({ symbol: coin.symbol })
        .from(coin)
        .where(inArray(coin.symbol, seedSymbols));
    const existingSymbolSet = new Set(existingCoins.map((c) => c.symbol));

    const coinsToInsert = SEED_COINS.filter((c) => !existingSymbolSet.has(c.symbol)).map((c) => {
        const tokenPrice = (c.price / SEED_MAX_REF_PRICE) * SEED_MAX_TOKEN_PRICE;
        const poolCoin = POOL_BASE / tokenPrice;
        const marketCap = Math.min(tokenPrice * SEED_SUPPLY, MAX_STORABLE);
        return {
            name: c.name,
            symbol: c.symbol,
            icon: null,
            creatorId: null,
            initialSupply: SEED_SUPPLY.toString(),
            circulatingSupply: SEED_SUPPLY.toString(),
            currentPrice: tokenPrice.toString(),
            marketCap: marketCap.toString(),
            volume24h: '0.00',
            change24h: '0.0000',
            poolCoinAmount: poolCoin.toString(),
            poolBaseCurrencyAmount: POOL_BASE.toString(),
            isListed: true,
            tradingUnlocksAt: null,
            isLocked: false,
            isFeatured: true
        };
    });

    result.coinsSkipped = existingSymbolSet.size;
    if (coinsToInsert.length > 0) {
        await db.insert(coin).values(coinsToInsert);
        result.coinsSeeded = coinsToInsert.length;
    }

    // --- Bots (idempotent by email AND username) ---
    const botEmails = BOT_NAMES.map((b) => `${b.username}@bots.internal`);
    const existingBots = await db
        .select({ email: user.email })
        .from(user)
        .where(inArray(user.email, botEmails));
    const existingEmailSet = new Set(existingBots.map((b) => b.email));

    const botsToInsert = BOT_NAMES.filter(
        (b) => !existingEmailSet.has(`${b.username}@bots.internal`)
    ).map((b, index) => ({
        name: b.name,
        username: b.username,
        email: `${b.username}@bots.internal`,
        emailVerified: true,
        image: null,
        baseCurrencyBalance: BOT_STARTING_BALANCE.toString(),
        isBot: true,
        botPersonality: personalityFor(index)
    }));

    result.botsSkipped = existingEmailSet.size;
    if (botsToInsert.length > 0) {
        await db.insert(user).values(botsToInsert);
        result.botsSeeded = botsToInsert.length;
    }

    console.log(
        `[seed] coins: +${result.coinsSeeded} (${result.coinsSkipped} existed), bots: +${result.botsSeeded} (${result.botsSkipped} existed)`
    );

    return result;
}

// Live counts for verification / admin response.
export async function getBotSeedStats(): Promise<{
    botCount: number;
    seedCoinCount: number;
}> {
    const [botCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(user)
        .where(eq(user.isBot, true));

    const [seedCoinCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(coin)
        .where(sql`${coin.creatorId} IS NULL AND ${coin.isFeatured} = true`);

    return {
        botCount: botCount?.count ?? 0,
        seedCoinCount: seedCoinCount?.count ?? 0
    };
}
