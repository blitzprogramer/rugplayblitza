import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { predictionQuestion } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import type { RequestHandler } from './$types';

interface EditBody {
	question?: string;
	resolutionDate?: string;
	requiresWebSearch?: boolean;
}

// Edit a question's text, resolution date, or web-search flag. Does not touch
// resolution outcome or balances — use the resolve/reverse/cancel endpoints for
// those. Works on any status (e.g. fixing a typo on a resolved question).
export const PATCH: RequestHandler = async ({ request, params }) => {
	const adminId = await requireAdmin(request);
	const id = parseInt(params.id!);
	if (!Number.isInteger(id) || id <= 0) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	let body: EditBody;
	try {
		body = (await request.json()) as EditBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const update: Record<string, unknown> = {};
	if (typeof body.question === 'string') {
		const q = body.question.trim().slice(0, 200);
		if (!q) return json({ error: 'Question cannot be empty' }, { status: 400 });
		update.question = q;
	}
	if (typeof body.resolutionDate === 'string') {
		const d = new Date(body.resolutionDate);
		if (Number.isNaN(d.getTime())) return json({ error: 'Invalid resolution date' }, { status: 400 });
		update.resolutionDate = d;
	}
	if (typeof body.requiresWebSearch === 'boolean') {
		update.requiresWebSearch = body.requiresWebSearch;
	}

	if (Object.keys(update).length === 0) {
		return json({ error: 'No fields to update' }, { status: 400 });
	}

	try {
		const [updated] = await db
			.update(predictionQuestion)
			.set(update)
			.where(eq(predictionQuestion.id, id))
			.returning({ id: predictionQuestion.id });

		if (!updated) return json({ error: 'Question not found' }, { status: 404 });

		console.log(`[admin] ${adminId} edited hopium question ${id}:`, Object.keys(update));
		return json({ success: true });
	} catch (e) {
		console.error('Hopium edit error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
