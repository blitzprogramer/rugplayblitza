import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { getBotsStatus } from '$lib/server/bot-trading';
import type { RequestHandler } from './$types';

// Bot control dashboard data: every bot's balance / personality / holdings /
// portfolio value, the most recent bot trades, and the live market-bias mode.
// Admin-only.
export const GET: RequestHandler = async ({ request }) => {
    await requireAdmin(request);

    try {
        return json(await getBotsStatus());
    } catch (e) {
        console.error('[admin/bots] status error:', e);
        return json({ error: 'Internal server error' }, { status: 500 });
    }
};
