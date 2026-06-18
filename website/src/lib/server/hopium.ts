// Hopium (prediction market) settlement helpers, shared by the background
// scheduler (job.ts) and the admin moderation endpoints. Centralising the
// parimutuel math here means an admin force-resolve uses the EXACT same payout
// formula as the automatic AI resolution.
//
// Parimutuel formula (mirrors the original resolveExpiredQuestions):
//   winnings = (totalPool / winningSideTotal) * betAmount   (winners only)
//
// All money mutations run inside a row-locked transaction; balances are stored
// as decimal(30,8) via toFixed(8), matching the rest of the codebase.

import { db } from '$lib/server/db';
import { predictionQuestion, predictionBet, user, siteSetting } from '$lib/server/db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { createNotification } from '$lib/server/notification';
import { formatValue } from '$lib/utils';
import { HOPium_SETTINGS } from '$lib/server/ai';

class HopiumError extends Error {
	constructor(
		public code: 'NOT_FOUND' | 'NOT_ACTIVE' | 'NOT_RESOLVED' | 'ALREADY_SETTLED',
		message: string
	) {
		super(message);
	}
}

/** Resolve an ACTIVE (or re-opened) question to YES/NO and pay out parimutuel. */
export async function resolveQuestionWithOutcome(
	questionId: number,
	resolution: boolean,
	confidence: number,
	reasoning: string
): Promise<void> {
	const now = new Date();

	await db.transaction(async (tx) => {
		const [question] = await tx
			.select({
				question: predictionQuestion.question,
				status: predictionQuestion.status,
				totalYesAmount: predictionQuestion.totalYesAmount,
				totalNoAmount: predictionQuestion.totalNoAmount
			})
			.from(predictionQuestion)
			.where(eq(predictionQuestion.id, questionId))
			.for('update')
			.limit(1);

		if (!question) throw new HopiumError('NOT_FOUND', 'Question not found');
		if (question.status !== 'ACTIVE') {
			throw new HopiumError('NOT_ACTIVE', 'Question is not active');
		}

		await tx
			.update(predictionQuestion)
			.set({
				status: 'RESOLVED',
				aiResolution: resolution,
				aiReasoning: reasoning,
				aiConfidence: confidence,
				resolvedAt: now
			})
			.where(eq(predictionQuestion.id, questionId));

		const bets = await tx
			.select({
				id: predictionBet.id,
				userId: predictionBet.userId,
				side: predictionBet.side,
				amount: predictionBet.amount
			})
			.from(predictionBet)
			.where(and(eq(predictionBet.questionId, questionId), isNull(predictionBet.settledAt)));

		const totalPool = Number(question.totalYesAmount) + Number(question.totalNoAmount);
		const winningSideTotal = resolution
			? Number(question.totalYesAmount)
			: Number(question.totalNoAmount);

		const notifications: Array<{
			userId: number;
			amount: number;
			winnings: number;
			won: boolean;
		}> = [];

		for (const bet of bets) {
			const won = bet.side === resolution;
			const winnings =
				won && winningSideTotal > 0 ? (totalPool / winningSideTotal) * Number(bet.amount) : 0;

			await tx
				.update(predictionBet)
				.set({ actualWinnings: winnings.toFixed(8), settledAt: now })
				.where(eq(predictionBet.id, bet.id));

			if (won && winnings > 0 && bet.userId !== null) {
				const [userData] = await tx
					.select({ baseCurrencyBalance: user.baseCurrencyBalance })
					.from(user)
					.where(eq(user.id, bet.userId))
					.for('update')
					.limit(1);

				if (userData) {
					const newBalance = Number(userData.baseCurrencyBalance) + winnings;
					await tx
						.update(user)
						.set({ baseCurrencyBalance: newBalance.toFixed(8), updatedAt: now })
						.where(eq(user.id, bet.userId));
				}
			}

			if (bet.userId !== null) {
				notifications.push({
					userId: bet.userId,
					amount: Number(bet.amount),
					winnings,
					won
				});
			}
		}

		for (const n of notifications) {
			const title = n.won ? 'Prediction won! 🎉' : 'Prediction lost ;(';
			const message = n.won
				? `You won ${formatValue(n.winnings)} on "${question.question}"`
				: `You lost ${formatValue(n.amount)} on "${question.question}"`;
			await createNotification(
				n.userId.toString(),
				'HOPIUM',
				title,
				message,
				`/hopium/${questionId}`
			);
		}
	});
}

/** Cancel a question and fully refund every unsettled bet. */
export async function cancelQuestionAndRefund(
	questionId: number,
	reasoning: string,
	confidence: number | null
): Promise<void> {
	const now = new Date();

	await db.transaction(async (tx) => {
		const [question] = await tx
			.select({ question: predictionQuestion.question, status: predictionQuestion.status })
			.from(predictionQuestion)
			.where(eq(predictionQuestion.id, questionId))
			.for('update')
			.limit(1);

		if (!question) throw new HopiumError('NOT_FOUND', 'Question not found');
		// Allow cancelling ACTIVE or RESOLVED questions; CANCELLED is a no-op guard.
		if (question.status === 'CANCELLED') {
			throw new HopiumError('ALREADY_SETTLED', 'Question is already cancelled');
		}

		await tx
			.update(predictionQuestion)
			.set({
				status: 'CANCELLED',
				resolvedAt: now,
				aiReasoning: reasoning,
				aiConfidence: confidence
			})
			.where(eq(predictionQuestion.id, questionId));

		const bets = await tx
			.select({
				id: predictionBet.id,
				userId: predictionBet.userId,
				amount: predictionBet.amount
			})
			.from(predictionBet)
			.where(and(eq(predictionBet.questionId, questionId), isNull(predictionBet.settledAt)));

		const notifications: Array<{ userId: number; amount: number }> = [];

		for (const bet of bets) {
			const refundAmount = Number(bet.amount);

			await tx
				.update(predictionBet)
				.set({ actualWinnings: refundAmount.toFixed(8), settledAt: now })
				.where(eq(predictionBet.id, bet.id));

			if (bet.userId !== null) {
				const [userData] = await tx
					.select({ baseCurrencyBalance: user.baseCurrencyBalance })
					.from(user)
					.where(eq(user.id, bet.userId))
					.for('update')
					.limit(1);

				if (userData) {
					const newBalance = Number(userData.baseCurrencyBalance) + refundAmount;
					await tx
						.update(user)
						.set({ baseCurrencyBalance: newBalance.toFixed(8), updatedAt: now })
						.where(eq(user.id, bet.userId));
				}

				notifications.push({ userId: bet.userId, amount: refundAmount });
			}
		}

		for (const n of notifications) {
			await createNotification(
				n.userId.toString(),
				'HOPIUM',
				'Prediction skipped 🥀',
				`You received a full refund of ${formatValue(n.amount)} for "${question.question}". We recommend predicting on more reliable questions!`,
				`/hopium/${questionId}`
			);
		}
	});
}

/**
 * Reverse a RESOLVED question to the opposite outcome. First claws back the
 * prior payouts (per-bet actualWinnings, clamped at 0 so a balance can never go
 * negative), reopens the question, then re-settles with the new outcome. The
 * bet pool itself is unchanged, so the new parimutuel payout is correct.
 *
 * Note: clamping at 0 means a user who already spent their (wrong) winnings
 * keeps them — an accepted limitation of reversing in a simulation economy.
 */
export async function reverseQuestionResolution(
	questionId: number,
	newResolution: boolean,
	reasoning: string
): Promise<void> {
	const now = new Date();

	await db.transaction(async (tx) => {
		const [question] = await tx
			.select({ status: predictionQuestion.status })
			.from(predictionQuestion)
			.where(eq(predictionQuestion.id, questionId))
			.for('update')
			.limit(1);

		if (!question) throw new HopiumError('NOT_FOUND', 'Question not found');
		if (question.status !== 'RESOLVED') {
			throw new HopiumError('NOT_RESOLVED', 'Only resolved questions can be reversed');
		}

		// Claw back every prior payout, then reopen each bet.
		const settledBets = await tx
			.select({
				id: predictionBet.id,
				userId: predictionBet.userId,
				actualWinnings: predictionBet.actualWinnings
			})
			.from(predictionBet)
			.where(eq(predictionBet.questionId, questionId));

		for (const bet of settledBets) {
			const paid = Number(bet.actualWinnings ?? 0);
			if (paid > 0 && bet.userId !== null) {
				const [userData] = await tx
					.select({ baseCurrencyBalance: user.baseCurrencyBalance })
					.from(user)
					.where(eq(user.id, bet.userId))
					.for('update')
					.limit(1);

				if (userData) {
					const newBalance = Math.max(0, Number(userData.baseCurrencyBalance) - paid);
					await tx
						.update(user)
						.set({ baseCurrencyBalance: newBalance.toFixed(8), updatedAt: now })
						.where(eq(user.id, bet.userId));
				}
			}
			await tx
				.update(predictionBet)
				.set({ actualWinnings: null, settledAt: null })
				.where(eq(predictionBet.id, bet.id));
		}

		// Reopen the question so it can be re-settled.
		await tx
			.update(predictionQuestion)
			.set({
				status: 'ACTIVE',
				aiResolution: null,
				aiConfidence: null,
				resolvedAt: null
			})
			.where(eq(predictionQuestion.id, questionId));
	});

	// Re-settle with the corrected outcome (full parimutuel payout).
	await resolveQuestionWithOutcome(questionId, newResolution, 100, reasoning);
}

export { HopiumError };

/** Admin-tunable Hopium settings, read from the site_setting table. */
export interface HopiumSettings {
	autogenerate: boolean;
	targetCount: number;
}

const DEFAULT_SETTINGS: HopiumSettings = {
	autogenerate: true,
	targetCount: HOPium_SETTINGS.targetQuestionCount
};

/** Read the current Hopium settings (with safe fallbacks to the code defaults). */
export async function getHopiumSettings(): Promise<HopiumSettings> {
	try {
		const rows = await db
			.select({ key: siteSetting.key, value: siteSetting.value })
			.from(siteSetting)
			.where(sql`${siteSetting.key} IN ('hopium.autogenerate', 'hopium.target_count')`);

		const map = new Map(rows.map((r) => [r.key, r.value]));
		const auto = map.get('hopium.autogenerate');
		const count = map.get('hopium.target_count');

		return {
			autogenerate: auto === undefined ? DEFAULT_SETTINGS.autogenerate : auto === 'true',
			targetCount:
				count && Number.isFinite(parseInt(count))
					? Math.max(0, parseInt(count))
					: DEFAULT_SETTINGS.targetCount
		};
	} catch {
		return DEFAULT_SETTINGS;
	}
}
