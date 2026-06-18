import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { getSessionKey } from '$lib/server/games/crash';
import { crashMultiplierFromElapsed } from '$lib/utils';
import { publishArcadeActivity } from '$lib/server/arcade-activity';
import { checkAndAwardAchievements } from '$lib/server/achievements';
import type { RequestHandler } from './$types';

// Polled by the client during an active round. When the curve reaches the
// crash point, the round is resolved here as a loss (the client cannot know
// the crash point, so the server must tell it when it busts).
export const GET: RequestHandler = async ({ url, request }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    const sessionToken = url.searchParams.get('sessionToken');
    if (!sessionToken) {
        return json({ error: 'Missing sessionToken' }, { status: 400 });
    }

    const userId = Number(session.user.id);
    const sessionRaw = await redis.get(getSessionKey(sessionToken));
    const game = sessionRaw ? JSON.parse(sessionRaw) : null;

    if (!game) {
        return json({ status: 'ended' });
    }

    if (game.userId !== userId) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    const elapsed = Date.now() - game.startTime;
    const currentMultiplier = Math.floor(crashMultiplierFromElapsed(elapsed) * 100) / 100;

    // Still rising — tell the client the current multiplier.
    if (currentMultiplier < game.crashPoint) {
        return json({ status: 'active', multiplier: currentMultiplier });
    }

    // Crashed — claim atomically and resolve as a loss.
    const deleted = await redis.del(getSessionKey(sessionToken));
    if (!deleted) {
        // A concurrent cashout/state call claimed it first.
        return json({ status: 'ended' });
    }

    await db.transaction(async (tx) => {
        const [userData] = await tx
            .select({
                arcadeLosses: user.arcadeLosses,
                totalArcadeGamesPlayed: user.totalArcadeGamesPlayed,
                arcadeWinStreak: user.arcadeWinStreak,
                totalArcadeWagered: user.totalArcadeWagered
            })
            .from(user)
            .where(eq(user.id, userId))
            .for('update')
            .limit(1);

        const updateData: any = {
            updatedAt: new Date(),
            arcadeLosses: `${Number(userData.arcadeLosses || 0) + game.betAmount}`,
            arcadeWinStreak: 0,
            totalArcadeGamesPlayed: (userData.totalArcadeGamesPlayed || 0) + 1,
            totalArcadeWagered: `${Number(userData.totalArcadeWagered || 0) + game.betAmount}`
        };

        await tx
            .update(user)
            .set(updateData)
            .where(eq(user.id, userId));
    });

    try {
        await publishArcadeActivity(userId, game.betAmount, false, 'crash', 1000);
        await checkAndAwardAchievements(userId, ['arcade'], {
            arcadeWon: false,
            arcadeWager: game.betAmount
        });
    } catch (sideEffectError) {
        console.error('Crash state side-effect error:', sideEffectError);
    }

    return json({
        status: 'crashed',
        multiplier: game.crashPoint,
        crashPoint: game.crashPoint
    });
};
