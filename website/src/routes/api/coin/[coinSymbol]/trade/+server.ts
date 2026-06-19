import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { transaction } from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { checkAndAwardAchievements } from '$lib/server/achievements';
import { executeTrade } from '$lib/server/trading';

export async function POST({ params, request }) {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    const { coinSymbol } = params;
    const { type, amount } = await request.json();

    const userId = Number(session.user.id);
    const normalizedSymbol = coinSymbol.toUpperCase();

    // Core trade (AMM + locks + writes + metrics) runs through the shared
    // executeTrade — the same path AI bots use. This route layers on auth-only
    // concerns: Redis publish + achievement awards.
    const res = await executeTrade(userId, normalizedSymbol, type, amount);
    if (!res.ok || !res.tradeData || !res.priceUpdateData) {
        throw error(res.status ?? 400, res.error ?? 'Trade failed');
    }

    redis.publish(`prices:${normalizedSymbol}`, JSON.stringify(res.priceUpdateData)).catch(console.error);
    redis.publish('trades:all', JSON.stringify({ type: 'all-trades', data: res.tradeData })).catch(console.error);
    if ((res.totalCost ?? 0) >= 1000) {
        redis.publish('trades:large', JSON.stringify({ type: 'live-trade', data: res.tradeData })).catch(console.error);
    }

    if (res.type === 'BUY') {
        checkAndAwardAchievements(userId, ['trading', 'wealth', 'special'], {
            tradeType: 'BUY',
            tradeAmount: res.totalCost,
            coinChange24h: res.coinChange24h,
            newBalance: res.newBalance,
            newPrice: res.newPrice,
            oldPrice: res.oldPrice
        });

        return json({
            success: true,
            type: 'BUY',
            coinsBought: res.coinsBought,
            totalCost: res.totalCost,
            newPrice: res.newPrice,
            priceImpact: res.priceImpact,
            newBalance: res.newBalance
        });
    } else {
        checkAndAwardAchievements(userId, ['trading', 'wealth', 'creation', 'special'], {
            tradeType: 'SELL',
            tradeAmount: res.totalCost,
            coinChange24h: res.coinChange24h,
            newBalance: res.newBalance,
            newPrice: res.newPrice,
            oldPrice: res.oldPrice,
            coinCreatedAt: res.coinCreatedAt,
            firstInvestmentAt: await getFirstBuyTimestamp(userId, res.coinId!)
        });

        return json({
            success: true,
            type: 'SELL',
            coinsSold: res.coinsSold,
            totalReceived: res.totalCost,
            newPrice: res.newPrice,
            priceImpact: res.priceImpact,
            newBalance: res.newBalance
        });
    }
}

async function getFirstBuyTimestamp(userId: number, coinId: number): Promise<Date | undefined> {
    try {
        const [firstBuy] = await db
            .select({ timestamp: transaction.timestamp })
            .from(transaction)
            .where(
                and(
                    eq(transaction.userId, userId),
                    eq(transaction.coinId, coinId),
                    eq(transaction.type, 'BUY')
                )
            )
            .orderBy(asc(transaction.timestamp))
            .limit(1);
        return firstBuy?.timestamp ?? undefined;
    } catch {
        return undefined;
    }
}
