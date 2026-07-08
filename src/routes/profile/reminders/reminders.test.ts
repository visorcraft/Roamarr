import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, reminders } from '$lib/server/db/mongrelSchema';

test('load returns the users timezone only (list is fetched via /api/reminders)', async () => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	const u = kit.insertInto(users).values({ email: 'a@x.c', password_hash: 'x', display_name: 'A' }).executeSync();
	kit.insertInto(reminders).values({
		user_id: u.id,
		kind: 'custom',
		ref_type: 'trip',
		ref_id: 1n,
		fire_at: '2026-01-01T00:00:00Z'
	}).executeSync();

	const data = (await load({ locals: { user: { id: Number(u.id), timezone: u.timezone } as any } } as any)) as {
		timezone: string;
	};
	expect(data.timezone).toBe(u.timezone);
});
