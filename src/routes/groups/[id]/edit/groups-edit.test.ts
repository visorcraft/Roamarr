import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(groupMembers).executeSync();
	ctx.kit.deleteFrom(groups).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { groups, groupMembers, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUser } from '../../../../../tests/helpers';

function event(user: { id: number } | null, params: Record<string, string>, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null, { id: '1' }))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns 404 for a missing or non-owned group', () => {
	const user = makeUser(ctx.kit);
	expect(() => load(event(user, { id: '999' }))).toThrow(expect.objectContaining({ status: 404 }));
});

test('load returns group and members for owner', () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const member = makeUser(ctx.kit, { email: 'member@x.c' });
	const group = ctx.kit
		.insertInto(groups)
		.values({ owner_id: BigInt(owner.id), name: 'Team' } as any)
		.executeSync();
	const groupId = Number(group.id);
	ctx.kit.insertInto(groupMembers).values({ group_id: BigInt(groupId), user_id: BigInt(member.id) } as any).executeSync();

	const result = load(event(owner, { id: String(groupId) })) as {
		group: { id: number; name: string };
		members: Array<{ id: number; email: string }>;
	};
	expect(result.group.id).toBe(groupId);
	expect(result.group.name).toBe('Team');
	expect(result.members).toHaveLength(1);
	expect(result.members[0].email).toBe('member@x.c');
});

test('update action edits an owned group, logs audit, and redirects', async () => {
	const user = makeUser(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const group = ctx.kit
		.insertInto(groups)
		.values({ owner_id: BigInt(user.id), name: 'Old' } as any)
		.executeSync();
	const groupId = Number(group.id);

	const f = new FormData();
	f.set('name', 'Updated');

	await expect(actions.update(event(user, { id: String(groupId) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(groups).where(kitEq(groups.id, BigInt(groupId))).executeSync()[0];
	expect(row!.name).toBe('Updated');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('group_update');
	expect(logs[0].entity_type).toBe('group');
	expect(Number(logs[0].entity_id)).toBe(groupId);

	const hijack = new FormData();
	hijack.set('name', 'Hijacked');
	await expect(actions.update(event(other, { id: String(groupId) }, hijack))).rejects.toMatchObject({
		status: 404
	});

	const after = ctx.kit.selectFrom(groups).where(kitEq(groups.id, BigInt(groupId))).executeSync()[0];
	expect(after!.name).toBe('Updated');
});

test('update action rejects empty name', async () => {
	const user = makeUser(ctx.kit);
	const group = ctx.kit
		.insertInto(groups)
		.values({ owner_id: BigInt(user.id), name: 'Team' } as any)
		.executeSync();
	const groupId = Number(group.id);

	const f = new FormData();
	f.set('name', '  ');

	const result = (await actions.update(event(user, { id: String(groupId) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('Group name is required');

	const row = ctx.kit.selectFrom(groups).where(kitEq(groups.id, BigInt(groupId))).executeSync()[0];
	expect(row!.name).toBe('Team');
});

test('addMember action adds a member by email, logs audit, and redirects', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const member = makeUser(ctx.kit, { email: 'member@x.c' });
	const group = ctx.kit
		.insertInto(groups)
		.values({ owner_id: BigInt(owner.id), name: 'Team' } as any)
		.executeSync();
	const groupId = Number(group.id);

	const f = new FormData();
	f.set('email', 'MEMBER@X.C');

	await expect(actions.addMember(event(owner, { id: String(groupId) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(groupMembers).where(kitEq(groupMembers.group_id, BigInt(groupId))).executeSync();
	expect(rows).toHaveLength(1);
	expect(Number(rows[0].user_id)).toBe(member.id);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('group_member_add');
	expect(logs[0].entity_type).toBe('group');
	expect(Number(logs[0].entity_id)).toBe(groupId);
});

test('addMember action fails when email is not found', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const group = ctx.kit
		.insertInto(groups)
		.values({ owner_id: BigInt(owner.id), name: 'Team' } as any)
		.executeSync();
	const groupId = Number(group.id);

	const f = new FormData();
	f.set('email', 'missing@x.c');

	const result = (await actions.addMember(event(owner, { id: String(groupId) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('User not found');

	expect(ctx.kit.selectFrom(groupMembers).executeSync()).toHaveLength(0);
	expect(ctx.kit.selectFrom(auditLogs).executeSync()).toHaveLength(0);
});

test('removeMember action removes a member, logs audit, and redirects', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const member = makeUser(ctx.kit, { email: 'member@x.c' });
	const group = ctx.kit
		.insertInto(groups)
		.values({ owner_id: BigInt(owner.id), name: 'Team' } as any)
		.executeSync();
	const groupId = Number(group.id);
	ctx.kit.insertInto(groupMembers).values({ group_id: BigInt(groupId), user_id: BigInt(member.id) } as any).executeSync();

	const f = new FormData();
	f.set('userId', String(member.id));

	await expect(actions.removeMember(event(owner, { id: String(groupId) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(groupMembers).where(kitEq(groupMembers.group_id, BigInt(groupId))).executeSync();
	expect(rows).toHaveLength(0);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('group_member_remove');
	expect(logs[0].entity_type).toBe('group');
	expect(Number(logs[0].entity_id)).toBe(groupId);
});
