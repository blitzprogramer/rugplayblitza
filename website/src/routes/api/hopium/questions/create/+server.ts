import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Hopium 2.0: questions are now AI-generated only (pop-culture, via the
// scheduler in job.ts). User-created questions are permanently disabled.
export const POST: RequestHandler = async () => {
    throw error(403, 'Question creation is disabled — questions are now AI-generated.');
};
