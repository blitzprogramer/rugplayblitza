import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import {
    generateCrashPoint,
    getSessionKey,
    CRASH_SESSION_TTL_SECONDS
} from '$lib/server/games/crash';
import { validateBetAmount } from '$lib/utils';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    try {
        const { betAmount, autoCashoutTarget } = await request.json();
        const userId = Number(session.user.id);

        const roundedBet = validateBetAmount(betAmount);

        let target: number | null = null;
        if (autoCashoutTarget != null && !isNaN(Number(autoCashoutTarget))) {
            target = Math.max(1.01, Math.floor(Number(autoCashoutTarget) * 100) / 100);
        }

        const result = await db.transaction(async (tx) => {
            const [userData] = await tx
                .select({ baseCurrencyBalance: user.baseCurrencyBalance })
                .from(user)
                .where(eq(user.id, userId))
                .for('update')
                .limit(1);

            const currentBalance = Number(userData.baseCurrencyBalance);
            const roundedBalance = Math.round(currentBalance * 100000000) / 100000000;

            if (roundedBet > roundedBalance) {
                throw new Error(`Insufficient funds. You need $${roundedBet.toFixed(2)} but only have $${roundedBalance.toFixed(2)}`);
            }

            const randomBytes = new Uint8Array(8);
            crypto.getRandomValues(randomBytes);
            const sessionToken = Array.from(randomBytes)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');

            const now = Date.now();
            const newBalance = roundedBalance - roundedBet;

            await redis.set(
                getSessionKey(sessionToken),
                JSON.stringify({
                    sessionToken,
                    betAmount: roundedBet,
                    crashPoint: generateCrashPoint(), // secret: never returned to the client
                    startTime: now,
                    status: 'active',
                    userId,
                    autoCashoutTarget: target
                }),
                { EX: CRASH_SESSION_TTL_SECONDS }
            );

            await tx
                .update(user)
                .set({
                    baseCurrencyBalance: newBalance.toFixed(8),
                    updatedAt: new Date()
                })
                .where(eq(user.id, userId));

            return {
                sessionToken,
                newBalance,
                startTime: now
            };
        });

        return json(result);
    } catch (e) {
        console.error('Crash start error:', e);
        if (e instanceof Error && e.message.startsWith('Insufficient funds')) {
            return json({ error: e.message }, { status: 400 });
        }
        return json({ error: 'Internal server error' }, { status: 500 });
    }
};
