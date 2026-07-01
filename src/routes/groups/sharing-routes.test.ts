import { test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

import {
	_shareWithUserEmail as shareWithUserEmail,
	_shareWithGroup as shareWithGroup,
	_mintPublicToken as mintPublicToken
} from '../trips/[id]/share/+page.server';
import {
	_addMember as addMember,
	_removeMember as removeMember,
	_deleteGroup as deleteGroup
} from './+page.server';
import { canView } from '$lib/server/sharing';
import { groups, groupMembers } from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';

function makeUser(email: string) {
	const u = usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
	return { ...u, id: Number(u.id) };
}

function makeTrip(ownerId: number, name: string) {
	return tripsRepo.createTrip(ownerId, { name, calendarToken: randomUUID() });
}

test('sharing with a user grants canView; public token is set', () => {
	const a = makeUser('a@x.c');
	const b = makeUser('b@x.c');
	const t = makeTrip(a.id, 'T');
	shareWithUserEmail(a.id, t.id, 'B@X.c');
	expect(canView(b.id, t)).toBe(true);
	const token = mintPublicToken(a.id, t.id);
	expect(tripsRepo.getTripById(t.id)!.publicToken).toBe(token);
});

test('group share requires the group to belong to the sharer', () => {
	const owner = makeUser('o@x.c');
	const other = makeUser('g@x.c');
	const member = makeUser('m@x.c');
	const t = makeTrip(owner.id, 'T');
	const foreign = tripsRepo.createGroup({ ownerId: other.id, name: 'theirs' });
	expect(() => shareWithGroup(owner.id, t.id, foreign.id)).toThrow();

	const mine = tripsRepo.createGroup({ ownerId: owner.id, name: 'mine' });
	tripsRepo.addGroupMember(mine.id, member.id);
	shareWithGroup(owner.id, t.id, mine.id);
	expect(canView(member.id, t)).toBe(true);
});

test('group owner can remove a member and delete the group', () => {
	const kit = kitDb();
	const owner = makeUser('o2@x.c');
	const member = makeUser('m2@x.c');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'team' });
	addMember(owner.id, g.id, 'm2@x.c');
	expect(kit.selectFrom(groupMembers).where(eq(groupMembers.group_id, BigInt(g.id))).executeSync()).toHaveLength(1);

	removeMember(owner.id, g.id, member.id);
	expect(kit.selectFrom(groupMembers).where(eq(groupMembers.group_id, BigInt(g.id))).executeSync()).toHaveLength(0);

	deleteGroup(owner.id, g.id);
	expect(kit.selectFrom(groups).where(eq(groups.id, BigInt(g.id))).executeSync()[0]).toBeUndefined();
});

test('non-owner cannot remove members or delete a group', () => {
	const kit = kitDb();
	const a = makeUser('a2@x.c');
	const b = makeUser('b2@x.c');
	const member = makeUser('m3@x.c');
	const g = tripsRepo.createGroup({ ownerId: a.id, name: 'private' });
	tripsRepo.addGroupMember(g.id, member.id);

	expect(() => removeMember(b.id, g.id, member.id)).toThrow();
	expect(() => deleteGroup(b.id, g.id)).toThrow();
	expect(kit.selectFrom(groupMembers).where(eq(groupMembers.group_id, BigInt(g.id))).executeSync()).toHaveLength(1);
	expect(kit.selectFrom(groups).where(eq(groups.id, BigInt(g.id))).executeSync()[0]).toBeDefined();
});
