import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { DELETE, PATCH } from './+server';
import { makeUser, makeGroup, makeGroupMember } from '../../../../../tests/helpers';
import { groups, groupMembers, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
import { resetRateLimit } from '$lib/server/rateLimit';

beforeEach(() => {
	ctx.kit.deleteFrom(groupMembers).executeSync();
	ctx.kit.deleteFrom(groups).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('delete removes an owned group, logs audit, and returns 204', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const member = makeUser(ctx.kit, { email: 'member@x.c' });
	const group = makeGroup(ctx.kit, owner.id, 'Team');
	makeGroupMember(ctx.kit, group.id, member.id);

	const res = await DELETE(makeEvent({ id: String(group.id) }, owner));
	expect(res.status).toBe(204);

	const groupRows = kit.selectFrom(groups).executeSync();
	expect(groupRows).toHaveLength(0);
	const memberRows = kit.selectFrom(groupMembers).executeSync();
	expect(memberRows).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('group_delete');
	expect(logs[0].entity_type).toBe('group');
	expect(Number(logs[0].entity_id)).toBe(group.id);
});

test('patch renames an owned group', async () => {
	const owner = makeUser(ctx.kit, { email: 'rename@x.c' });
	const group = makeGroup(ctx.kit, owner.id, 'Old');
	const event = makeEvent({ id: String(group.id) }, owner);
	event.request = new Request('https://roamarr.test/api/groups/1', { method: 'PATCH', body: JSON.stringify({ name: 'New' }) });
	const response = await PATCH(event);
	expect(response.status).toBe(200);
	expect(kit.selectFrom(groups).executeSync()[0].name).toBe('New');
});

test('delete by member returns 404', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const member = makeUser(ctx.kit, { email: 'member@x.c' });
	const group = makeGroup(ctx.kit, owner.id, 'Team');
	makeGroupMember(ctx.kit, group.id, member.id);

	await expect(DELETE(makeEvent({ id: String(group.id) }, member))).rejects.toMatchObject({ status: 404 });

	const rows = kit.selectFrom(groups).executeSync();
	expect(rows).toHaveLength(1);
});

test('delete returns 404 for another users group', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const group = makeGroup(ctx.kit, owner.id, 'Team');

	await expect(DELETE(makeEvent({ id: String(group.id) }, other))).rejects.toMatchObject({ status: 404 });

	const rows = kit.selectFrom(groups).executeSync();
	expect(rows).toHaveLength(1);
});

test('delete rejects unauthenticated requests', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});

test('delete rate limits repeated requests', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	for (let i = 0; i < 10; i++) {
		const group = makeGroup(ctx.kit, owner.id, `Group ${i}`);
		const res = await DELETE(makeEvent({ id: String(group.id) }, owner));
		expect(res.status).toBe(204);
	}

	const lastGroup = makeGroup(ctx.kit, owner.id, 'Last');
	await expect(DELETE(makeEvent({ id: String(lastGroup.id) }, owner))).rejects.toMatchObject({ status: 429 });
});
