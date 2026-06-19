import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { getMarketBias, setMarketBias } from '$lib/server/bot-trading';
import type { RequestHandler } from './$types';

// Live market-bias mode for the bot swarm. In-memory — resets to 'neutral' on
// server restart. 'bull' tilts bots toward buying, 'bear' toward selling.
export const GET: RequestHandler = async ({ request }) => {
    await requireAdmin(request);
    return json({ bias: getMarketBias() });
};

interface ConfigBody {
    bias?: unknown;
}

export const POST: RequestHandler = async ({ request }) => {
    const adminId = await requireAdmin(request);

    let body: ConfigBody;
    try {
        body = (await request.json()) as ConfigBody;
    } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (body.bias !== 'bull' && body.bias !== 'bear' && body.bias !== 'neutral') {
        return json({ error: 'bias must be bull, bear, or neutral' }, { status: 400 });
    }

    const next = setMarketBias(body.bias);
    console.log(`[admin/bots] ${adminId} set market bias → ${next}`);
    return json({ bias: next });
};
