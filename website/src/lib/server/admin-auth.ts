import { auth } from '$lib/auth';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

// Shared admin auth guard. Returns the authenticated admin's user id, or
// throws 401 (not signed in) / 403 (not an admin). Used by the Hopium admin
// endpoints to avoid repeating the session + isAdmin boilerplate.
export async function requireAdmin(request: Request): Promise<number> {
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		throw error(401, 'Not authenticated');
	}

	const adminId = Number(session.user.id);

	const [currentUser] = await db
		.select({ isAdmin: user.isAdmin })
		.from(user)
		.where(eq(user.id, adminId))
		.limit(1);

	if (!currentUser?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	return adminId;
}
