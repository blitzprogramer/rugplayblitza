// Shared trade core. Both the HTTP trade endpoint (real players) and the AI bot
// loop call executeTrade() so bots travel the EXACT same AMM path as players.
//
// executeTrade owns the locked DB transaction (coin + user row locks, AMM math,
// user balance/portfolio/transaction/price_history/coin writes, 24h metrics) and
// returns everything the caller needs to publish Redis + award achievements.
// It deliberately does NOT publish Redis or award achievements — callers decide
// (players get achievements + Redis publish; bots only publish Redis).

import { db } from '$lib/server/db';
import { coin, userPortfolio, user } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { executeBuyTrade, executeSellTrade } from '$lib/server/amm';

export type TradeType = 'BUY' | 'SELL';

export interface TradeResult {
    ok: boolean;
    error?: string;
    status?: number;
    type: TradeType;
    priceUpdateData?: {
        currentPrice: number;
        marketCap: number;
        change24h: number;
        volume24h: number;
        poolCoinAmount: number;
        poolBaseCurrencyAmount: number;
    };
    tradeData?: {
        type: TradeType;
        username: string;
        userImage: string;
        amount: number;
        coinSymbol: string;
        coinName: string;
        coinIcon: string;
        totalValue: number;
        price: number;
        timestamp: number;
        userId: string;
        isBot: boolean;
    };
    totalCost?: number;
    newPrice?: number;
    priceImpact?: number;
    newBalance?: number;
    coinsBought?: number;
    coinsSold?: number;
    coinId?: number;
    coinChange24h?: number;
    oldPrice?: number;
    coinCreatedAt?: Date;
}

const MAX_STORABLE = 1e38;

function failTrade(type: TradeType, error: string, status = 400): TradeResult {
    return { ok: false, error, status, type };
}

export async function executeTrade(
    userId: number,
    coinSymbol: string,
    type: TradeType,
    amount: number
): Promise<TradeResult> {
    if (!['BUY', 'SELL'].includes(type)) return failTrade(type, 'Invalid transaction type');
    if (!amount || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return failTrade(type, 'Invalid amount - must be a positive finite number');
    }
    if (amount > Number.MAX_SAFE_INTEGER) return failTrade(type, 'Amount too large');

    const normalizedSymbol = coinSymbol.toUpperCase();

    try {
        return await db.transaction(async (tx) => {
            const [coinData] = await tx.select({
                id: coin.id,
                symbol: coin.symbol,
                name: coin.name,
                icon: coin.icon,
                currentPrice: coin.currentPrice,
                poolCoinAmount: coin.poolCoinAmount,
                poolBaseCurrencyAmount: coin.poolBaseCurrencyAmount,
                circulatingSupply: coin.circulatingSupply,
                isListed: coin.isListed,
                creatorId: coin.creatorId,
                tradingUnlocksAt: coin.tradingUnlocksAt,
                isLocked: coin.isLocked,
                change24h: coin.change24h,
                createdAt: coin.createdAt
            }).from(coin).where(eq(coin.symbol, normalizedSymbol)).for('update').limit(1);

            if (!coinData) return failTrade(type, 'Coin not found', 404);
            if (!coinData.isListed) return failTrade(type, 'This coin is delisted and cannot be traded');

            if (coinData.isLocked && coinData.tradingUnlocksAt && userId !== coinData.creatorId) {
                const unlockTime = new Date(coinData.tradingUnlocksAt);
                if (new Date() < unlockTime) {
                    const remainingSeconds = Math.ceil((unlockTime.getTime() - Date.now()) / 1000);
                    return failTrade(type, `Trading is locked. Unlocks in ${remainingSeconds} seconds.`);
                }
                await tx.update(coin).set({ isLocked: false }).where(eq(coin.id, coinData.id));
            }

            const [userData] = await tx.select({
                baseCurrencyBalance: user.baseCurrencyBalance,
                username: user.username,
                image: user.image,
                isBot: user.isBot
            }).from(user).where(eq(user.id, userId)).for('update').limit(1);

            if (!userData) return failTrade(type, 'User not found', 404);

            const userBalance = Number(userData.baseCurrencyBalance);
            const poolCoinAmount = Number(coinData.poolCoinAmount);
            const poolBaseCurrencyAmount = Number(coinData.poolBaseCurrencyAmount);
            const currentPrice = Number(coinData.currentPrice);
            const isBot = userData.isBot ?? false;

            if (poolCoinAmount <= 0 || poolBaseCurrencyAmount <= 0) {
                return failTrade(type, 'Liquidity pool is not properly initialized or is empty. Trading halted.');
            }

            if (type === 'BUY') {
                const k = poolCoinAmount * poolBaseCurrencyAmount;
                const newPoolBaseCurrency = poolBaseCurrencyAmount + amount;
                const newPoolCoin = k / newPoolBaseCurrency;
                const coinsBought = poolCoinAmount - newPoolCoin;
                const totalCost = amount;
                const newPrice = newPoolBaseCurrency / newPoolCoin;
                const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;

                if (userBalance < totalCost) {
                    return failTrade(type, `Insufficient funds. You need *${totalCost.toFixed(6)} BUSS but only have *${userBalance.toFixed(6)} BUSS`);
                }
                if (coinsBought <= 0) {
                    return failTrade(type, 'Trade amount too small - would result in zero tokens');
                }

                // executeBuyTrade owns the transaction/price_history/coin writes + metrics.
                const buyResult = await executeBuyTrade(tx, coinData, userId, amount);
                if (!buyResult.success) {
                    return failTrade(type, 'Trade failed - invalid parameters');
                }

                await tx.update(user)
                    .set({
                        baseCurrencyBalance: (userBalance - totalCost).toString(),
                        updatedAt: new Date()
                    })
                    .where(eq(user.id, userId));

                const [existingHolding] = await tx
                    .select({ quantity: userPortfolio.quantity })
                    .from(userPortfolio)
                    .where(and(eq(userPortfolio.userId, userId), eq(userPortfolio.coinId, coinData.id)))
                    .limit(1);

                if (existingHolding) {
                    const newQuantity = Number(existingHolding.quantity) + coinsBought;
                    await tx.update(userPortfolio)
                        .set({ quantity: newQuantity.toString(), updatedAt: new Date() })
                        .where(and(eq(userPortfolio.userId, userId), eq(userPortfolio.coinId, coinData.id)));
                } else {
                    await tx.insert(userPortfolio).values({
                        userId,
                        coinId: coinData.id,
                        quantity: coinsBought.toString()
                    });
                }

                const safeMarketCap = Math.min(Number(coinData.circulatingSupply) * newPrice, MAX_STORABLE);
                const safeVolume = Math.min(buyResult.metrics!.volume24h, MAX_STORABLE);

                const priceUpdateData = {
                    currentPrice: newPrice,
                    marketCap: safeMarketCap,
                    change24h: buyResult.metrics!.change24h,
                    volume24h: safeVolume,
                    poolCoinAmount: newPoolCoin,
                    poolBaseCurrencyAmount: newPoolBaseCurrency
                };

                const tradeData = {
                    type: 'BUY' as const,
                    username: userData.username,
                    userImage: userData.image || '',
                    amount: coinsBought,
                    coinSymbol: normalizedSymbol,
                    coinName: coinData.name,
                    coinIcon: coinData.icon || '',
                    totalValue: totalCost,
                    price: newPrice,
                    timestamp: Date.now(),
                    userId: userId.toString(),
                    isBot
                };

                return {
                    ok: true,
                    type: 'BUY' as const,
                    priceUpdateData,
                    tradeData,
                    totalCost,
                    coinsBought,
                    newPrice,
                    priceImpact,
                    newBalance: userBalance - totalCost,
                    coinChange24h: Number(coinData.change24h || 0),
                    oldPrice: currentPrice,
                    coinId: coinData.id
                };
            } else {
                // SELL
                const [userHolding] = await tx
                    .select({ quantity: userPortfolio.quantity })
                    .from(userPortfolio)
                    .where(and(eq(userPortfolio.userId, userId), eq(userPortfolio.coinId, coinData.id)))
                    .limit(1);

                if (!userHolding || Number(userHolding.quantity) < amount) {
                    return failTrade(type, `Insufficient coins. You have ${userHolding ? Number(userHolding.quantity) : 0} but trying to sell ${amount}`);
                }

                // Allow aggressive selling for rug-pull simulation; prevent only mathematical breakdown.
                const maxSellable = Math.floor(Number(coinData.poolCoinAmount) * 0.995);
                if (amount > maxSellable) {
                    return failTrade(type, `Cannot sell more than 99.5% of pool tokens. Max sellable: ${maxSellable} tokens`);
                }

                // executeSellTrade owns the transaction/price_history/coin writes + metrics.
                const sellResult = await executeSellTrade(tx, coinData, userId, amount);
                if (!sellResult.success) {
                    return failTrade(type, 'Trade failed - insufficient liquidity or invalid parameters');
                }

                const totalCost = sellResult.baseCurrencyReceived ?? 0;
                const newPrice = sellResult.newPrice!;
                const priceImpact = sellResult.priceImpact;

                if (totalCost <= 0) {
                    return failTrade(type, 'Trade amount results in zero base currency received');
                }

                await tx.update(user)
                    .set({
                        baseCurrencyBalance: (userBalance + totalCost).toString(),
                        updatedAt: new Date()
                    })
                    .where(eq(user.id, userId));

                const newQuantity = Number(userHolding.quantity) - amount;
                if (newQuantity > 0.000001) {
                    await tx.update(userPortfolio)
                        .set({ quantity: newQuantity.toString(), updatedAt: new Date() })
                        .where(and(eq(userPortfolio.userId, userId), eq(userPortfolio.coinId, coinData.id)));
                } else {
                    await tx.delete(userPortfolio)
                        .where(and(eq(userPortfolio.userId, userId), eq(userPortfolio.coinId, coinData.id)));
                }

                const metrics = sellResult.metrics!;
                const safeMarketCap = Math.min(Number(coinData.circulatingSupply) * newPrice, MAX_STORABLE);
                const safeVolume = Math.min(metrics.volume24h, MAX_STORABLE);

                const priceUpdateData = {
                    currentPrice: newPrice,
                    marketCap: safeMarketCap,
                    change24h: metrics.change24h,
                    volume24h: safeVolume,
                    poolCoinAmount: sellResult.newPoolCoin!,
                    poolBaseCurrencyAmount: sellResult.newPoolBaseCurrency!
                };

                const tradeData = {
                    type: 'SELL' as const,
                    username: userData.username,
                    userImage: userData.image || '',
                    amount,
                    coinSymbol: normalizedSymbol,
                    coinName: coinData.name,
                    coinIcon: coinData.icon || '',
                    totalValue: totalCost,
                    price: newPrice,
                    timestamp: Date.now(),
                    userId: userId.toString(),
                    isBot
                };

                return {
                    ok: true,
                    type: 'SELL' as const,
                    priceUpdateData,
                    tradeData,
                    totalCost,
                    coinsSold: amount,
                    coinId: coinData.id,
                    newPrice,
                    priceImpact,
                    newBalance: userBalance + totalCost,
                    coinChange24h: metrics.change24h,
                    oldPrice: currentPrice,
                    coinCreatedAt: coinData.createdAt
                };
            }
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Trade failed';
        return failTrade(type, msg, 500);
    }
}
