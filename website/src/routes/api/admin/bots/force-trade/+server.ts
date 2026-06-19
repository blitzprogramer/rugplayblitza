import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { forceBotTrade } from '$lib/server/bot-trading';
import type { RequestHandler } from './$types';

interface ForceTradeBody {
    botId?: unknown;
    coinSymbol?: unknown;
    type?: unknown;
    amount?: unknown;
}

// Force a single bot to BUY/SELL a specific coin right now, bypassing the 3%
// impact cap (the admin picks the size). Routes through the same executeTrade
// path players/bots use and fans out Redis so /live reflects it.
//   BUY  amount = dollars (base currency) to spend
//   SELL amount = token quantity to sell
export const POST: RequestHandler = async ({ request }) => {
    const adminId = await requireAdmin(request);

    let body: ForceTradeBody;
    try {
        body = (await request.json()) as ForceTradeBody;
    } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const botId = Number(body.botId);
    const coinSymbol =
        typeof body.coinSymbol === 'string' ? body.coinSymbol.trim().toUpperCase() : '';
    const type = body.type;
    const amount = Number(body.amount);

    if (!Number.isInteger(botId) || botId <= 0) {
        return json({ error: 'Invalid botId' }, { status: 400 });
    }
    if (!coinSymbol) {
        return json({ error: 'coinSymbol is required' }, { status: 400 });
    }
    if (type !== 'BUY' && type !== 'SELL') {
        return json({ error: 'type must be BUY or SELL' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        return json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    try {
        const res = await forceBotTrade(botId, coinSymbol, type, amount);
        if (!res.ok) {
            // executeTrade rejected it (insufficient funds, coin not found, sell
            // too large, …) — surface its domain error with its own status.
            console.warn(`[admin/bots] ${adminId} force-trade rejected: ${res.error}`);
            return json({ error: res.error ?? 'Trade failed' }, { status: res.status ?? 400 });
        }
        console.log(`[admin/bots] ${adminId} forced ${type} ${amount} ${coinSymbol} for bot ${botId}`);
        return json({
            success: true,
            result: {
                type: res.type,
                coinSymbol: res.tradeData?.coinSymbol,
                botUsername: res.tradeData?.username,
                newPrice: res.newPrice,
                priceImpact: res.priceImpact,
                newBalance: res.newBalance,
                totalCost: res.totalCost,
                coinsBought: res.coinsBought,
                coinsSold: res.coinsSold
            }
        });
    } catch (e) {
        console.error('[admin/bots] force-trade error:', e);
        return json({ error: 'Internal server error' }, { status: 500 });
    }
};
