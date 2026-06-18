import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { coin, user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

interface FeatureRequest {
	featured: boolean;
}

// Toggle the isFeatured flag on a coin. Admin-only. Featured coins are pinned
// to the top of the market + homepage lists and get a ★ badge.
export const POST: RequestHandler = async ({ request, params }) => {
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		throw error(401, 'Not authenticated');
	}

	const adminId = Number(session.user.id);

	const [currentUser] = await db
		.select({ isAdmin: user.isAdmin })
		.from(user)
		.where(eq(user.id, adminId))
		.limit(1);

	if (!currentUser?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	const coinId = parseInt(params.id!);
	if (!Number.isInteger(coinId) || coinId <= 0) {
		return json({ error: 'Invalid coin id' }, { status: 400 });
	}

	let body: FeatureRequest;
	try {
		body = (await request.json()) as FeatureRequest;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (typeof body.featured !== 'boolean') {
		return json({ error: 'featured must be a boolean' }, { status: 400 });
	}

	try {
		const [updated] = await db
			.update(coin)
			.set({ isFeatured: body.featured, updatedAt: new Date() })
			.where(eq(coin.id, coinId))
			.returning({ id: coin.id, symbol: coin.symbol, isFeatured: coin.isFeatured });

		if (!updated) {
			return json({ error: 'Coin not found' }, { status: 404 });
		}

		console.log(`[admin] ${adminId} set coin ${coinId} (*${updated.symbol}) featured=${updated.isFeatured}`);

		return json(updated);
	} catch (e) {
		console.error('Feature toggle error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
