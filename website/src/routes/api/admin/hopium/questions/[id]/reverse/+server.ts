import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { reverseQuestionResolution, HopiumError } from '$lib/server/hopium';
import type { RequestHandler } from './$types';

interface Body {
	resolution: boolean;
	reasoning: string;
}

// Reverse a RESOLVED question: claw back the (wrong) prior payouts, reopen, and
// re-settle with the corrected outcome. See reverseQuestionResolution for the
// clamp-at-0 limitation on already-spent winnings.
export const POST: RequestHandler = async ({ request, params }) => {
	const adminId = await requireAdmin(request);
	const id = parseInt(params.id!);
	if (!Number.isInteger(id) || id <= 0) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (typeof body.resolution !== 'boolean' || !body.reasoning?.trim()) {
		return json({ error: 'resolution (boolean) and reasoning are required' }, { status: 400 });
	}

	try {
		await reverseQuestionResolution(id, body.resolution, body.reasoning.trim());
		console.log(`[admin] ${adminId} reversed hopium ${id} → ${body.resolution ? 'YES' : 'NO'}`);
		return json({ success: true });
	} catch (e) {
		if (e instanceof HopiumError) {
			const status = e.code === 'NOT_FOUND' ? 404 : 400;
			return json({ error: e.message }, { status });
		}
		console.error('Reverse error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
