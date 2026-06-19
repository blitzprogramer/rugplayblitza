import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { seedBotsAndCoins, getBotSeedStats } from '$lib/server/bot-seed';
import type { RequestHandler } from './$types';

// Seeds the 30 popular-ticker coins + 30 AI bot traders. Idempotent — re-running
// only inserts what's missing. Admin-only. Used once per environment to bring
// the bot market online; the bot loop itself is driven by the scheduler.
export const POST: RequestHandler = async ({ request }) => {
    await requireAdmin(request);

    try {
        const seed = await seedBotsAndCoins();
        const stats = await getBotSeedStats();

        return json({ success: true, ...seed, stats });
    } catch (e) {
        console.error('Bot seed error:', e);
        return json(
            { error: e instanceof Error ? e.message : 'Internal server error' },
            { status: 500 }
        );
    }
};
