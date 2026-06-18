import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { predictionQuestion, predictionBet } from '$lib/server/db/schema';
import { eq, ilike, desc, sql, and } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import type { RequestHandler } from './$types';

interface CreateQuestionBody {
	question: string;
	resolutionDate: string;
	requiresWebSearch?: boolean;
}

// Manually create a Hopium question (admin-created; creatorId = null like the
// AI-generated ones). The public create endpoint is disabled, so this is the
// only way to add a hand-written question.
export const POST: RequestHandler = async ({ request }) => {
	const adminId = await requireAdmin(request);

	let body: CreateQuestionBody;
	try {
		body = (await request.json()) as CreateQuestionBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const question = body.question?.trim().slice(0, 200) ?? '';
	const resolutionDate = body.resolutionDate ? new Date(body.resolutionDate) : null;

	if (!question) {
		return json({ error: 'Question text is required' }, { status: 400 });
	}
	if (!resolutionDate || Number.isNaN(resolutionDate.getTime())) {
		return json({ error: 'A valid resolution date is required' }, { status: 400 });
	}

	try {
		const [created] = await db
			.insert(predictionQuestion)
			.values({
				question,
				status: 'ACTIVE',
				resolutionDate,
				requiresWebSearch: body.requiresWebSearch === true,
				creatorId: null,
				totalYesAmount: '0.00000000',
				totalNoAmount: '0.00000000'
			})
			.returning({ id: predictionQuestion.id });

		console.log(`[admin] ${adminId} created hopium question ${created.id}: "${question}"`);
		return json({ id: created.id });
	} catch (e) {
		console.error('Hopium create error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};

// Admin Hopium question list. Returns pools + bet counts + AI resolution state,
// filterable by status and free-text search. Powers the moderation table.
export const GET: RequestHandler = async ({ request, url }) => {
	await requireAdmin(request);

	const status = url.searchParams.get('status') || 'ALL';
	const search = url.searchParams.get('search')?.trim() || '';

	const conditions = [];
	if (['ACTIVE', 'RESOLVED', 'CANCELLED'].includes(status)) {
		conditions.push(eq(predictionQuestion.status, status as 'ACTIVE' | 'RESOLVED' | 'CANCELLED'));
	}
	if (search) {
		conditions.push(ilike(predictionQuestion.question, `%${search}%`));
	}

	const where = conditions.length ? and(...conditions) : undefined;

	try {
		const questions = await db
			.select({
				id: predictionQuestion.id,
				question: predictionQuestion.question,
				status: predictionQuestion.status,
				resolutionDate: predictionQuestion.resolutionDate,
				aiResolution: predictionQuestion.aiResolution,
				aiConfidence: predictionQuestion.aiConfidence,
				aiReasoning: predictionQuestion.aiReasoning,
				totalYesAmount: predictionQuestion.totalYesAmount,
				totalNoAmount: predictionQuestion.totalNoAmount,
				createdAt: predictionQuestion.createdAt,
				resolvedAt: predictionQuestion.resolvedAt,
				betCount: sql<number>`(select count(*)::int from ${predictionBet} where ${predictionBet.questionId} = ${predictionQuestion.id})`
			})
			.from(predictionQuestion)
			.where(where)
			.orderBy(desc(predictionQuestion.createdAt))
			.limit(100);

		return json(
			questions.map((q) => ({
				id: q.id,
				question: q.question,
				status: q.status,
				resolutionDate: q.resolutionDate,
				aiResolution: q.aiResolution,
				aiConfidence: q.aiConfidence,
				aiReasoning: q.aiReasoning,
				totalYes: Number(q.totalYesAmount),
				totalNo: Number(q.totalNoAmount),
				betCount: q.betCount,
				createdAt: q.createdAt,
				resolvedAt: q.resolvedAt
			}))
		);
	} catch (e) {
		console.error('Admin hopium list error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
