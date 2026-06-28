import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeGroup, makeGroupMember } from '../../../tests/helpers';


import { load } from './+page.server';
import { users, groups, groupMembers } from '$lib/server/db/schema';

test('load includes groups the user owns and groups they belong to', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(db, kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(db, kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });

	const owned = makeGroup(db, kit, a.id, 'Owned');
	const memberGroup = makeGroup(db, kit, b.id, 'Member');
	makeGroupMember(db, kit, memberGroup.id, a.id);

	const data = load({ locals: { user: a } } as any) as any;
	expect(data.groups.map((g: any) => g.name).sort()).toEqual(['Member', 'Owned']);
	expect(data.groups.find((g: any) => g.id === owned.id).members).toHaveLength(0);
	expect(data.groups.find((g: any) => g.id === memberGroup.id).members).toHaveLength(1);
});
