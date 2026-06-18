import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { siteSetting } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import { getHopiumSettings } from '$lib/server/hopium';
import type { RequestHandler } from './$types';

// Read (GET) or update (POST) the admin-tunable Hopium settings:
//   hopium.autogenerate  — whether the scheduler creates AI questions
//   hopium.target_count  — desired number of active questions
export const GET: RequestHandler = async ({ request }) => {
	await requireAdmin(request);
	return json(await getHopiumSettings());
};

interface SettingsBody {
	autogenerate?: boolean;
	targetCount?: number;
}

export const POST: RequestHandler = async ({ request }) => {
	const adminId = await requireAdmin(request);

	let body: SettingsBody;
	try {
		body = (await request.json()) as SettingsBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const updates: Array<{ key: string; value: string }> = [];

	if (typeof body.autogenerate === 'boolean') {
		updates.push({ key: 'hopium.autogenerate', value: body.autogenerate ? 'true' : 'false' });
	}
	if (typeof body.targetCount === 'number' && Number.isFinite(body.targetCount)) {
		const clamped = Math.max(0, Math.floor(body.targetCount));
		updates.push({ key: 'hopium.target_count', value: String(clamped) });
	}

	if (updates.length === 0) {
		return json({ error: 'No valid settings provided' }, { status: 400 });
	}

	try {
		for (const u of updates) {
			// upsert
			await db
				.insert(siteSetting)
				.values({ key: u.key, value: u.value })
				.onConflictDoUpdate({
					target: siteSetting.key,
					set: { value: u.value, updatedAt: new Date() }
				});
		}

		console.log(`[admin] ${adminId} updated hopium settings:`, updates);
		return json(await getHopiumSettings());
	} catch (e) {
		console.error('Hopium settings update error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
