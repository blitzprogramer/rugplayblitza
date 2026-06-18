import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

type Field = 'cash' | 'gems';
type Action = 'set' | 'add' | 'remove';

interface EconomyRequest {
	field: Field;
	action: Action;
	amount: number;
}

// Adjust any user's base currency (cash) or gems. Admin-only. All updates run
// inside a row-locked transaction and clamp the result to >= 0 so a "remove"
// can never drive a balance negative. No persistent audit log yet (out of
// scope) — actions are console.logged with the admin id.
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

	const targetId = parseInt(params.id!);
	if (!Number.isInteger(targetId) || targetId <= 0) {
		return json({ error: 'Invalid user id' }, { status: 400 });
	}

	let body: EconomyRequest;
	try {
		body = (await request.json()) as EconomyRequest;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const { field, action, amount } = body;

	if (field !== 'cash' && field !== 'gems') {
		return json({ error: 'Invalid field' }, { status: 400 });
	}
	if (action !== 'set' && action !== 'add' && action !== 'remove') {
		return json({ error: 'Invalid action' }, { status: 400 });
	}
	if (!Number.isFinite(amount) || amount < 0) {
		return json({ error: 'Amount must be a non-negative number' }, { status: 400 });
	}

	try {
		const result = await db.transaction(async (tx) => {
			const [target] = await tx
				.select({
					baseCurrencyBalance: user.baseCurrencyBalance,
					gems: user.gems,
					username: user.username
				})
				.from(user)
				.where(eq(user.id, targetId))
				.for('update')
				.limit(1);

			if (!target) {
				throw new Error('NOT_FOUND');
			}

			if (field === 'cash') {
				const current = Number(target.baseCurrencyBalance);
				let next: number;
				if (action === 'set') next = amount;
				else if (action === 'add') next = current + amount;
				else next = current - amount;
				next = Math.max(0, next);

				await tx
					.update(user)
					.set({ baseCurrencyBalance: next.toFixed(8), updatedAt: new Date() })
					.where(eq(user.id, targetId));

				return { username: target.username, baseCurrencyBalance: next, gems: Number(target.gems) };
			} else {
				const current = Number(target.gems);
				const delta = Math.floor(amount);
				let next: number;
				if (action === 'set') next = delta;
				else if (action === 'add') next = current + delta;
				else next = current - delta;
				next = Math.max(0, next);

				await tx
					.update(user)
					.set({ gems: next, updatedAt: new Date() })
					.where(eq(user.id, targetId));

				return {
					username: target.username,
					baseCurrencyBalance: Number(target.baseCurrencyBalance),
					gems: next
				};
			}
		});

		console.log(
			`[admin] ${adminId} ${action} ${field} by ${amount} on user ${targetId} (@${result.username}) → cash=${result.baseCurrencyBalance} gems=${result.gems}`
		);

		return json({
			id: targetId,
			username: result.username,
			baseCurrencyBalance: result.baseCurrencyBalance,
			gems: result.gems
		});
	} catch (e) {
		if (e instanceof Error && e.message === 'NOT_FOUND') {
			return json({ error: 'User not found' }, { status: 404 });
		}
		console.error('Economy adjust error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
