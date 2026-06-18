import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user, predictionQuestion } from '$lib/server/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// Admin-only aggregate snapshot for the /admin dashboard. One round-trip per
// table (user, prediction_question) plus a small recent-signups list.
export const GET: RequestHandler = async ({ request }) => {
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		throw error(401, 'Not authenticated');
	}

	const [currentUser] = await db
		.select({ isAdmin: user.isAdmin })
		.from(user)
		.where(eq(user.id, Number(session.user.id)))
		.limit(1);

	if (!currentUser?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	try {
		// Single aggregate row over the user table.
		const [userStats] = await db
			.select({
				totalUsers: sql<number>`count(*)::int`,
				bannedUsers: sql<number>`count(*) filter (where is_banned = true)::int`,
				newUsers24h: sql<number>`count(*) filter (where created_at > now() - interval '24 hours')::int`,
				totalCash: sql<string>`coalesce(sum(base_currency_balance), 0)::text`,
				totalGems: sql<string>`coalesce(sum(gems), 0)::text`,
				totalWagered: sql<string>`coalesce(sum(total_arcade_wagered), 0)::text`,
				totalWins: sql<string>`coalesce(sum(gambling_wins), 0)::text`,
				totalLosses: sql<string>`coalesce(sum(gambling_losses), 0)::text`,
				totalGames: sql<string>`coalesce(sum(total_arcade_games_played), 0)::text`
			})
			.from(user);

		// Single aggregate row over the prediction_question (Hopium) table.
		const [hopiumStats] = await db
			.select({
				activeQuestions: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
				resolvedQuestions: sql<number>`count(*) filter (where status = 'RESOLVED')::int`,
				cancelledQuestions: sql<number>`count(*) filter (where status = 'CANCELLED')::int`,
				totalQuestions: sql<number>`count(*)::int`,
				hopiumVolume: sql<string>`coalesce(sum(total_yes_amount + total_no_amount), 0)::text`
			})
			.from(predictionQuestion);

		const recentSignups = await db
			.select({
				id: user.id,
				username: user.username,
				name: user.name,
				createdAt: user.createdAt
			})
			.from(user)
			.orderBy(desc(user.createdAt))
			.limit(5);

		// House GGR = what players lost minus what players won.
		const ggr = Number(userStats.totalLosses) - Number(userStats.totalWins);

		return json({
			users: {
				total: userStats.totalUsers,
				banned: userStats.bannedUsers,
				new24h: userStats.newUsers24h
			},
			economy: {
				totalCash: Number(userStats.totalCash),
				totalGems: Number(userStats.totalGems)
			},
			arcade: {
				totalWagered: Number(userStats.totalWagered),
				totalWins: Number(userStats.totalWins),
				totalLosses: Number(userStats.totalLosses),
				ggr,
				totalGames: Number(userStats.totalGames)
			},
			hopium: {
				active: hopiumStats.activeQuestions,
				resolved: hopiumStats.resolvedQuestions,
				cancelled: hopiumStats.cancelledQuestions,
				total: hopiumStats.totalQuestions,
				volume: Number(hopiumStats.hopiumVolume)
			},
			recentSignups
		});
	} catch (e) {
		console.error('Admin stats error:', e);
		throw error(500, 'Internal server error');
	}
};
