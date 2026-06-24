import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, groups, groupMembers } from '$lib/server/db/schema';

test('load includes groups the user owns and groups they belong to', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();

	const owned = db.insert(groups).values({ ownerId: a.id, name: 'Owned' }).returning().get();
	const memberGroup = db.insert(groups).values({ ownerId: b.id, name: 'Member' }).returning().get();
	db.insert(groupMembers).values({ groupId: memberGroup.id, userId: a.id }).run();

	const data = load({ locals: { user: a } } as any) as any;
	expect(data.groups.map((g: any) => g.name).sort()).toEqual(['Member', 'Owned']);
	expect(data.groups.find((g: any) => g.id === owned.id).members).toHaveLength(0);
	expect(data.groups.find((g: any) => g.id === memberGroup.id).members).toHaveLength(1);
});
