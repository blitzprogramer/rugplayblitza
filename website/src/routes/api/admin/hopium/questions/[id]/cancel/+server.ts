import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { cancelQuestionAndRefund, HopiumError } from '$lib/server/hopium';
import type { RequestHandler } from './$types';

interface Body {
	reason?: string;
}

// Cancel a question and refund all unsettled bets (full stake returned).
export const POST: RequestHandler = async ({ request, params }) => {
	const adminId = await requireAdmin(request);
	const id = parseInt(params.id!);
	if (!Number.isInteger(id) || id <= 0) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	let body: Body = {};
	try {
		body = (await request.json()) as Body;
	} catch {
		// body is optional
	}

	const reason = (body.reason ?? 'Cancelled by admin').trim();

	try {
		await cancelQuestionAndRefund(id, reason, null);
		console.log(`[admin] ${adminId} cancelled hopium ${id}: ${reason}`);
		return json({ success: true });
	} catch (e) {
		if (e instanceof HopiumError) {
			const status = e.code === 'NOT_FOUND' ? 404 : 400;
			return json({ error: e.message }, { status });
		}
		console.error('Cancel error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
