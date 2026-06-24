import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const allUsers = db
		.select({
			id: users.id,
			email: users.email,
			displayName: users.displayName,
			role: users.role,
			disabled: users.disabled,
			createdAt: users.createdAt
		})
		.from(users)
		.orderBy(users.email)
		.all();
	return { users: allUsers };
};

function parseAction(formData: FormData) {
	const userId = Number(formData.get('userId'));
	const role = String(formData.get('role') ?? '');
	const disabled = formData.get('disabled') === 'on';
	if (!Number.isInteger(userId) || userId <= 0) return { error: 'Invalid user.' };
	if (role && role !== 'admin' && role !== 'user') return { error: 'Invalid role.' };
	return { userId, role: role as 'admin' | 'user' | '', disabled };
}

function countAdmins() {
	return db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.role, 'admin')).get()!.c;
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		requireAdmin(locals);
		const f = await request.formData();
		const parsed = parseAction(f);
		if ('error' in parsed) return fail(400, { error: parsed.error });
		const { userId, role, disabled } = parsed;

		const target = db.select().from(users).where(eq(users.id, userId)).get();
		if (!target) return fail(404, { error: 'User not found.' });

		// Prevent locking out the last admin: if this change would remove the only
		// admin's access, reject it.
		const adminsBefore = countAdmins();
		const demotingSelf = target.id === locals.user!.id && role === 'user';
		const disablingSelf = target.id === locals.user!.id && disabled;
		if ((demotingSelf || disablingSelf) && adminsBefore <= 1) {
			return fail(400, { error: 'Cannot remove the last admin.' });
		}

		const patch: Partial<typeof users.$inferInsert> = {};
		if (role) patch.role = role;
		patch.disabled = disabled;
		db.update(users).set(patch).where(eq(users.id, userId)).run();
		throw redirect(303, '/settings/users');
	}
};
