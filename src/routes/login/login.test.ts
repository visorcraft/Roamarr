import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { authenticate } from './+page.server';
import { users } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';

test('authenticate returns user on correct creds, null otherwise', async () => {
	(ctx as any).db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: await hashPassword('correcthorse'), displayName: 'A' })
		.run();
	expect((await authenticate('A@B.c', 'correcthorse'))?.email).toBe('a@b.c');
	expect(await authenticate('a@b.c', 'wrong')).toBeNull();
});
