import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { coin, user } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// Admin coin list for the Featured Coins management page. Returns the fields
// needed to render the table + toggle isFeatured. Ordered featured-first, then
// by market cap. Capped at 100 (matches the market endpoint ceiling).
export const GET: RequestHandler = async ({ request, url }) => {
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

	const search = (url.searchParams.get('search') || '').trim().toLowerCase();

	try {
		// Fetch a wide window then filter in-app; coin counts are modest and this
		// avoids ILIKE special-character pitfalls on user-typed symbols.
		const coins = await db
			.select({
				id: coin.id,
				name: coin.name,
				symbol: coin.symbol,
				icon: coin.icon,
				isFeatured: coin.isFeatured,
				isListed: coin.isListed,
				marketCap: coin.marketCap,
				createdAt: coin.createdAt
			})
			.from(coin)
			.orderBy(desc(coin.isFeatured), desc(coin.marketCap))
			.limit(100);

		const filtered = search
			? coins.filter(
					(c) =>
						c.name.toLowerCase().includes(search) || c.symbol.toLowerCase().includes(search)
				)
			: coins;

		return json(
			filtered.map((c) => ({
				id: c.id,
				name: c.name,
				symbol: c.symbol,
				icon: c.icon,
				isFeatured: c.isFeatured,
				isListed: c.isListed,
				marketCap: Number(c.marketCap),
				createdAt: c.createdAt
			}))
		);
	} catch (e) {
		console.error('Admin coins list error:', e);
		throw error(500, 'Internal server error');
	}
};
