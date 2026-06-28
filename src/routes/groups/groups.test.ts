import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeGroup, makeGroupMember } from '../../../tests/helpers';


import { load } from './+page.server';

test('load includes groups the user owns and groups they belong to', () => {
	const a = makeUser(kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });

	const owned = makeGroup(kit, a.id, 'Owned');
	const memberGroup = makeGroup(kit, b.id, 'Member');
	makeGroupMember(kit, memberGroup.id, a.id);

	const data = load({ locals: { user: a } } as any) as any;
	expect(data.groups.map((g: any) => g.name).sort()).toEqual(['Member', 'Owned']);
	expect(data.groups.find((g: any) => g.id === owned.id).members).toHaveLength(0);
	expect(data.groups.find((g: any) => g.id === memberGroup.id).members).toHaveLength(1);
});
