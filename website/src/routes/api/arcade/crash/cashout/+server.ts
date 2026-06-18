import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { getSessionKey, CRASH_MAX_PAYOUT } from '$lib/server/games/crash';
import { crashMultiplierFromElapsed } from '$lib/utils';
import { publishArcadeActivity } from '$lib/server/arcade-activity';
import { checkAndAwardAchievements } from '$lib/server/achievements';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    try {
        const { sessionToken } = await request.json();
        const userId = Number(session.user.id);

        const sessionRaw = await redis.get(getSessionKey(sessionToken));
        const game = sessionRaw ? JSON.parse(sessionRaw) : null;

        if (!game) {
            return json({ error: 'Invalid session' }, { status: 400 });
        }

        if (game.userId !== userId) {
            return json({ error: 'Unauthorized: Session belongs to another user' }, { status: 403 });
        }

        // Atomic claim — prevents double-cashout / cashout-after-crash races.
        const deleted = await redis.del(getSessionKey(sessionToken));
        if (!deleted) {
            return json({ error: 'Session already processed' }, { status: 400 });
        }

        const elapsed = Date.now() - game.startTime;
        const currentMultiplier = Math.floor(crashMultiplierFromElapsed(elapsed) * 100) / 100;
        const won = currentMultiplier < game.crashPoint;

        const result = await db.transaction(async (tx) => {
            const [userData] = await tx
                .select({
                    baseCurrencyBalance: user.baseCurrencyBalance,
                    arcadeLosses: user.arcadeLosses,
                    arcadeWins: user.arcadeWins,
                    totalArcadeGamesPlayed: user.totalArcadeGamesPlayed,
                    arcadeWinStreak: user.arcadeWinStreak,
                    arcadeBestWinStreak: user.arcadeBestWinStreak,
                    totalArcadeWagered: user.totalArcadeWagered
                })
                .from(user)
                .where(eq(user.id, userId))
                .for('update')
                .limit(1);

            const currentBalance = Number(userData.baseCurrencyBalance);

            let payout = 0;
            // When cashed out in time, use the live multiplier; if too late, it crashed.
            let multiplier = game.crashPoint;

            if (won) {
                multiplier = currentMultiplier;
                payout = Math.min(game.betAmount * currentMultiplier, CRASH_MAX_PAYOUT);
            }

            const roundedPayout = Math.round(payout * 100000000) / 100000000;
            const newBalance = Math.round((currentBalance + roundedPayout) * 100000000) / 100000000;
            const netResult = Math.round((roundedPayout - game.betAmount) * 100000000) / 100000000;

            const updateData: any = {
                baseCurrencyBalance: newBalance.toFixed(8),
                updatedAt: new Date()
            };

            if (netResult > 0) {
                updateData.arcadeWins = `${Number(userData.arcadeWins || 0) + netResult}`;
                const newWinStreak = (userData.arcadeWinStreak || 0) + 1;
                updateData.arcadeWinStreak = newWinStreak;
                updateData.arcadeBestWinStreak = Math.max(newWinStreak, userData.arcadeBestWinStreak || 0);
            } else if (netResult < 0) {
                updateData.arcadeLosses = `${Number(userData.arcadeLosses || 0) + Math.abs(netResult)}`;
                updateData.arcadeWinStreak = 0;
            }
            updateData.totalArcadeGamesPlayed = (userData.totalArcadeGamesPlayed || 0) + 1;
            updateData.totalArcadeWagered = `${Number(userData.totalArcadeWagered || 0) + game.betAmount}`;

            await tx
                .update(user)
                .set(updateData)
                .where(eq(user.id, userId));

            return {
                won,
                multiplier,
                crashPoint: game.crashPoint,
                payout: roundedPayout,
                newBalance,
                amountWagered: game.betAmount
            };
        });

        try {
            await publishArcadeActivity(
                userId,
                result.won ? result.payout : result.amountWagered,
                result.won,
                'crash',
                1000
            );
            await checkAndAwardAchievements(userId, ['arcade', 'wealth'], {
                arcadeWon: result.won,
                arcadeWager: result.amountWagered,
                crashMultiplier: result.multiplier
            });
        } catch (sideEffectError) {
            console.error('Crash cashout side-effect error:', sideEffectError);
        }

        return json(result);
    } catch (e) {
        console.error('Crash cashout error:', e);
        return json({ error: 'Internal server error' }, { status: 500 });
    }
};
