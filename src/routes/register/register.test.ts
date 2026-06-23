import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { registerUser } from './+page.server';
import { users, settings } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

test('registers a normal user with normalized email; rejects dupes', async () => {
	(ctx as any).db
		.update(settings)
		.set({ setupComplete: true, allowRegistration: true })
		.where(eq(settings.id, 1))
		.run();
	const u = await registerUser('New@User.com', 'correcthorse', 'New');
	expect(u.role).toBe('user');
	expect(u.email).toBe('new@user.com');
	await expect(registerUser('new@user.com', 'correcthorse', 'Dup')).rejects.toThrow();
});
