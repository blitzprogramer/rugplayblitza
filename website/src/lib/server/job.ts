import { db } from '$lib/server/db';
import { predictionQuestion, predictionBet, user, accountDeletionRequest, session, account, promoCodeRedemption, userPortfolio, commentLike, comment, transaction, coin } from '$lib/server/db/schema';
import { eq, and, lte, isNull } from 'drizzle-orm';
import { resolveQuestion, getRugplayData, generateQuestions } from '$lib/server/ai';
import { cancelQuestionAndRefund, resolveQuestionWithOutcome, getHopiumSettings } from '$lib/server/hopium';

export async function resolveExpiredQuestions() {
    const now = new Date();

    try {
        const expiredQuestions = await db
            .select({
                id: predictionQuestion.id,
                question: predictionQuestion.question,
                requiresWebSearch: predictionQuestion.requiresWebSearch,
                totalYesAmount: predictionQuestion.totalYesAmount,
                totalNoAmount: predictionQuestion.totalNoAmount,
            })
            .from(predictionQuestion)
            .where(and(
                eq(predictionQuestion.status, 'ACTIVE'),
                lte(predictionQuestion.resolutionDate, now),
                isNull(predictionQuestion.aiResolution)
            ));

        console.log(`Found ${expiredQuestions.length} questions to resolve`);

        for (const question of expiredQuestions) {
            try {
                console.log(`Resolving question: ${question.question}`);

                const rugplayData = await getRugplayData(question.question);
                const resolution = await resolveQuestion(
                    question.question,
                    question.requiresWebSearch,
                    rugplayData
                );
                console.log('Resolution result:', resolution);

                if (resolution.confidence < 50) {
                    console.log(`Cancelling question ${question.id} due to low confidence: ${resolution.confidence}`);
                    await cancelQuestionAndRefund(question.id, resolution.reasoning, resolution.confidence);
                    continue;
                }

                await resolveQuestionWithOutcome(
                    question.id,
                    resolution.resolution,
                    resolution.confidence,
                    resolution.reasoning
                );
            } catch (error) {
                console.error(`Failed to resolve question ${question.id}:`, error);
            }
        }

    } catch (error) {
        console.error('Error in resolveExpiredQuestions:', error);
    }
}

export async function processAccountDeletions() {
    const now = new Date();

    try {
        const expiredRequests = await db.select()
            .from(accountDeletionRequest)
            .where(
                and(
                    lte(accountDeletionRequest.scheduledDeletionAt, now),
                    eq(accountDeletionRequest.isProcessed, false)
                )
            );

        console.log(`🗑️ Processing ${expiredRequests.length} expired account deletion requests`);

        for (const request of expiredRequests) {
            try {
                await db.transaction(async (tx) => {
                    const userId = request.userId;

                    await tx.update(transaction)
                        .set({ userId: null })
                        .where(eq(transaction.userId, userId));

                    await tx.update(comment)
                        .set({ userId: null, content: "[deleted]", isDeleted: true })
                        .where(eq(comment.userId, userId));

                    await tx.update(predictionBet)
                        .set({ userId: null })
                        .where(eq(predictionBet.userId, userId));

                    await tx.update(predictionQuestion)
                        .set({ creatorId: null })
                        .where(eq(predictionQuestion.creatorId, userId));

                    await tx.update(coin)
                        .set({ creatorId: null })
                        .where(eq(coin.creatorId, userId));

                    await tx.delete(session).where(eq(session.userId, userId));
                    await tx.delete(account).where(eq(account.userId, userId));
                    await tx.delete(promoCodeRedemption).where(eq(promoCodeRedemption.userId, userId));
                    await tx.delete(userPortfolio).where(eq(userPortfolio.userId, userId));
                    await tx.delete(commentLike).where(eq(commentLike.userId, userId));

                    await tx.update(accountDeletionRequest)
                        .set({ isProcessed: true })
                        .where(eq(accountDeletionRequest.id, request.id));

                    await tx.delete(user).where(eq(user.id, userId));
                });

                console.log(`✅ Successfully processed account deletion for user ID: ${request.userId}`);
            } catch (error: any) {
                console.error(`❌ Failed to process account deletion for user ID: ${request.userId}`, error);

                await db.update(accountDeletionRequest)
                    .set({
                        isProcessed: true, // Mark as processed to avoid retries, but log the failure
                        reason: request.reason ? `${request.reason} - FAILED: ${error.message}` : `FAILED: ${error.message}`
                    })
                    .where(eq(accountDeletionRequest.id, request.id));
            }
        }
    } catch (error) {
        console.error('Error processing account deletions:', error);
    }
}

// Hopium 2.0: keep the pool of AI-generated pop-culture questions topped up to
// the target count. AI-only (creatorId = null). Called every minute by the
// scheduler alongside resolveExpiredQuestions().
export async function topUpHopiumQuestions() {
    try {
        const settings = await getHopiumSettings();
        if (!settings.autogenerate) {
            return; // Admin has paused AI question generation.
        }

        const active = await db
            .select({ question: predictionQuestion.question })
            .from(predictionQuestion)
            .where(eq(predictionQuestion.status, 'ACTIVE'));

        const deficit = settings.targetCount - active.length;
        if (deficit <= 0) {
            return;
        }

        const existing = active.map((a) => a.question);
        const generated = await generateQuestions(deficit, existing);

        if (generated.length === 0) {
            return;
        }

        await db.insert(predictionQuestion).values(
            generated.map((g) => ({
                question: g.question.slice(0, 200), // varchar(200) safety cap
                status: 'ACTIVE' as const,
                resolutionDate: g.resolutionDate,
                requiresWebSearch: g.requiresWebSearch,
                creatorId: null,
                totalYesAmount: '0.00000000',
                totalNoAmount: '0.00000000'
            }))
        );

        console.log(
            `🤖 Hopium: generated ${generated.length} new questions ` +
                `(active ${active.length} → ${active.length + generated.length})`
        );
    } catch (error) {
        console.error('Error topping up Hopium questions:', error);
    }
}