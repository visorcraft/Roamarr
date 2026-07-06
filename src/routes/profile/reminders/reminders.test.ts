import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { users, reminders } from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';

test('load returns the users reminders', async () => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	const u = kit.insertInto(users).values({ email: 'a@x.c', password_hash: 'x', display_name: 'A' }).executeSync();
	const other = kit.insertInto(users).values({ email: 'b@x.c', password_hash: 'x', display_name: 'B' }).executeSync();
	kit.insertInto(reminders).values({
		user_id: u.id,
		kind: 'custom',
		ref_type: 'trip',
		ref_id: 1n,
		fire_at: '2026-01-01T00:00:00Z'
	}).executeSync();
	kit.insertInto(reminders).values({
		user_id: other.id,
		kind: 'custom',
		ref_type: 'trip',
		ref_id: 2n,
		fire_at: '2026-01-02T00:00:00Z'
	}).executeSync();

	const data = (await load({ locals: { user: u } } as any)) as { reminders: { userId: number }[]; timezone: string };
	expect(data.reminders).toHaveLength(1);
	expect(data.reminders[0].userId).toBe(Number(u.id));
	expect(data.timezone).toBe(u.timezone);
});

test('cancel action deletes the users own reminder', async () => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	const u = kit.insertInto(users).values({ email: 'c@x.c', password_hash: 'x', display_name: 'C' }).executeSync();
	const r = kit.insertInto(reminders).values({
		user_id: u.id,
		kind: 'custom',
		ref_type: 'trip',
		ref_id: 3n,
		fire_at: '2026-01-01T00:00:00Z'
	}).executeSync();

	await expect(
		actions.cancel({
			request: new Request('http://x', { method: 'POST', body: new URLSearchParams({ id: String(r.id) }) }),
			locals: { user: { id: Number(u.id) } }
		} as any)
	).rejects.toSatisfy((e: any) => e.status === 303 && e.location === '/profile/reminders');

	expect(kit.selectFrom(reminders).where(eq(reminders.id, BigInt(r.id))).executeSync()[0]).toBeUndefined();
});
