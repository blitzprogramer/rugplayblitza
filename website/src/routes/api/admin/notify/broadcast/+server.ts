import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user, notifications } from '$lib/server/db/schema';
import { redis } from '$lib/server/redis';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

interface BroadcastRequest {
	title: string;
	message: string;
	link?: string;
}

const BATCH_CHUNK_SIZE = 500;

// Sends a SYSTEM notification to every user. Persists one row per user in
// chunks (mirrors the prestige chunked-insert pattern), then publishes to each
// user's `notifications:<id>` Redis channel so connected clients get a live
// toast (same payload shape as createNotification). Offline users simply have
// no subscriber and the row waits unread.
export const POST: RequestHandler = async ({ request }) => {
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

	let body: BroadcastRequest;
	try {
		body = (await request.json()) as BroadcastRequest;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const title = body.title?.trim().slice(0, 200) ?? '';
	const message = body.message?.trim() ?? '';
	const link = body.link?.trim() || null;

	if (!title || !message) {
		return json({ error: 'Title and message are required' }, { status: 400 });
	}

	try {
		const allUsers = await db.select({ id: user.id }).from(user);

		// 1. Persist — chunked bulk insert.
		const rows = allUsers.map((u) => ({
			userId: u.id,
			type: 'SYSTEM' as const,
			title,
			message,
			link
		}));

		for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
			await db.insert(notifications).values(rows.slice(i, i + BATCH_CHUNK_SIZE));
		}

		// 2. Live delivery — publish to each user's Redis channel (fire-and-forget).
		const timestamp = new Date().toISOString();
		const payload = JSON.stringify({
			type: 'notification',
			timestamp,
			notificationType: 'SYSTEM',
			title,
			message,
			link
		});

		for (const u of allUsers) {
			try {
				await redis.publish(`notifications:${u.id}`, payload);
			} catch {
				// A single failed publish shouldn't fail the broadcast.
			}
		}

		console.log(
			`[admin] ${adminId} broadcast "${title}" to ${allUsers.length} users`
		);

		return json({ success: true, notifiedCount: allUsers.length });
	} catch (e) {
		console.error('Broadcast error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
