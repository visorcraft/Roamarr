import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeUser, makeGroup, makeGroupMember } from '../../../../tests/helpers';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated groups with member counts', async () => {
	const owner = makeUser(ctx.kit);
	const member = makeUser(ctx.kit);
	const group = makeGroup(ctx.kit, owner.id, 'Family');
	makeGroupMember(ctx.kit, group.id, owner.id);
	makeGroupMember(ctx.kit, group.id, member.id);

	const res = await GET(makeEvent('/api/groups', owner));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows).toHaveLength(1);
	expect(body.rows[0]).toMatchObject({
		id: group.id,
		name: 'Family',
		createdAt: group.createdAt,
		memberCount: 2
	});
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/groups', null))).rejects.toMatchObject({ status: 401 });
});
