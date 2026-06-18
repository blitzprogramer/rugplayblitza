import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { publishArcadeActivity } from '$lib/server/arcade-activity';
import { checkAndAwardAchievements } from '$lib/server/achievements';
import { validateBetAmount } from '$lib/utils';
import {
	PLINKO_MULTIPLIERS,
	PLINKO_MAX_PAYOUT,
	isValidPlinkoRows,
	isValidPlinkoRisk
} from '$lib/games/plinko';
import type { RequestHandler } from './$types';

interface PlinkoRequest {
	rows: number;
	risk: string;
	amount: number;
}

export const POST: RequestHandler = async ({ request }) => {
	const session = await auth.api.getSession({
		headers: request.headers
	});

	if (!session?.user) {
		throw error(401, 'Not authenticated');
	}

	try {
		const { rows, risk, amount }: PlinkoRequest = await request.json();

		if (!isValidPlinkoRows(rows) || !isValidPlinkoRisk(risk)) {
			return json({ error: 'Invalid rows or risk selection' }, { status: 400 });
		}

		const roundedBet = validateBetAmount(amount);

		const userId = Number(session.user.id);

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
			const roundedBalance = Math.round(currentBalance * 100000000) / 100000000;

			if (roundedBet > roundedBalance) {
				throw new Error(`Insufficient funds. You need $${roundedBet.toFixed(2)} but only have $${roundedBalance.toFixed(2)}`);
			}

			// One random bit per row: 0 = left, 1 = right.
			// bucketIndex = total right-bounces (0..rows).
			const bits = randomBytes(rows);
			const path: ('L' | 'R')[] = [];
			let bucketIndex = 0;
			for (let i = 0; i < rows; i++) {
				const goRight = (bits[i] & 1) === 1;
				path.push(goRight ? 'R' : 'L');
				if (goRight) bucketIndex++;
			}

			const multiplier = PLINKO_MULTIPLIERS[rows][risk][bucketIndex];
			const payout = Math.min(roundedBet * multiplier, PLINKO_MAX_PAYOUT);
			const newBalance = roundedBalance - roundedBet + payout;

			const netResult = payout - roundedBet;
			const isWin = netResult > 0;

			const updateData: any = {
				baseCurrencyBalance: newBalance.toFixed(8),
				updatedAt: new Date()
			};

			if (isWin) {
				updateData.arcadeWins = `${Number(userData.arcadeWins || 0) + netResult}`;
				const newWinStreak = (userData.arcadeWinStreak || 0) + 1;
				updateData.arcadeWinStreak = newWinStreak;
				updateData.arcadeBestWinStreak = Math.max(newWinStreak, userData.arcadeBestWinStreak || 0);
			} else {
				updateData.arcadeLosses = `${Number(userData.arcadeLosses || 0) + Math.abs(netResult)}`;
				updateData.arcadeWinStreak = 0;
			}
			updateData.totalArcadeGamesPlayed = (userData.totalArcadeGamesPlayed || 0) + 1;
			updateData.totalArcadeWagered = `${Number(userData.totalArcadeWagered || 0) + roundedBet}`;

			await tx
				.update(user)
				.set(updateData)
				.where(eq(user.id, userId));

			return {
				won: isWin,
				path,
				bucketIndex,
				multiplier,
				payout,
				newBalance,
				amountWagered: roundedBet,
				rows,
				risk
			};
		});

		await publishArcadeActivity(userId, result.won ? result.payout : result.amountWagered, result.won, 'plinko', 2000);

		await checkAndAwardAchievements(userId, ['arcade', 'wealth'], {
			arcadeWon: result.won,
			arcadeWager: result.amountWagered
		});

		return json(result);
	} catch (e) {
		console.error('Plinko API error:', e);
		if (e instanceof Error && e.message.startsWith('Insufficient funds')) {
			return json({ error: e.message }, { status: 400 });
		}
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
