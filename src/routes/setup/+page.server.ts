import { fail, redirect, type Actions } from '@sveltejs/kit';
import { hashPassword, createSession } from '$lib/server/auth';
import { db, sqlite } from '$lib/server/db';
import { users, settings } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';

export function createAdmin(
	i: { email: string; password: string; displayName: string; instanceName: string; timezone: string },
	passwordHash?: string
) {
	const email = i.email.trim().toLowerCase();
	const tx = sqlite.transaction(() => {
		const s = db.select().from(settings).where(eq(settings.id, 1)).get()!;
		const n = db.select({ c: sql<number>`count(*)` }).from(users).get()!.c;
		if (s.setupComplete || n > 0) throw new Error('already set up');
		const u = db
			.insert(users)
			.values({
				email,
				passwordHash: passwordHash ?? 'PLACEHOLDER',
				displayName: i.displayName,
				role: 'admin',
				timezone: i.timezone
			})
			.returning()
			.get();
		db.update(settings)
			.set({ setupComplete: true, instanceName: i.instanceName, defaultTimezone: i.timezone })
			.where(eq(settings.id, 1))
			.run();
		return u;
	});
	return tx.immediate();
}

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const f = await request.formData();
		const email = String(f.get('email') ?? ''),
			password = String(f.get('password') ?? '');
		const displayName = String(f.get('displayName') ?? ''),
			instanceName = String(f.get('instanceName') ?? 'Roamarr');
		const timezone = String(f.get('timezone') ?? 'UTC');
		if (!email || password.length < 8 || !displayName)
			return fail(400, { error: 'All fields required; password ≥ 8 chars.' });
		let user;
		try {
			user = createAdmin(
				{ email, password, displayName, instanceName, timezone },
				await hashPassword(password)
			);
		} catch {
			return fail(409, { error: 'Setup is already complete.' });
		}
		cookies.set('session', await createSession(user.id), {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});
		throw redirect(303, '/');
	}
};
