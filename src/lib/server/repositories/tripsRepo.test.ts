import { test, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@mongreldb/kit';
import * as tripsRepo from './tripsRepo';
import * as usersRepo from './usersRepo';
import {
	users,
	trips,
	tripShares,
	tripComments,
	groups,
	groupMembers
} from '$lib/server/db/mongrelSchema';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

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

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(tripComments).executeSync();
	kit.deleteFrom(tripShares).executeSync();
	kit.deleteFrom(groupMembers).executeSync();
	kit.deleteFrom(groups).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('CRUD trips', () => {
	const kit = kitDb();
	const owner = makeUser('owner@x.c');
	const t = makeTrip(owner.id, 'Tokyo');
	expect(t.name).toBe('Tokyo');
	expect(tripsRepo.getTripById(t.id)?.name).toBe('Tokyo');
	expect(tripsRepo.listTripsForUser(owner.id)).toHaveLength(1);

	const stored = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0];
	expect(stored?.name).toBe('Tokyo');

	const updated = tripsRepo.updateTrip(t.id, { name: 'Kyoto' });
	expect(updated?.name).toBe('Kyoto');
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]?.name).toBe('Kyoto');

	tripsRepo.deleteTrip(t.id);
	expect(tripsRepo.getTripById(t.id)).toBeNull();
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]).toBeUndefined();
});

test('shares and permission helpers', () => {
	const owner = makeUser('owner@x.c');
	const friend = makeUser('friend@x.c');
	const t = makeTrip(owner.id, 'Shared');

	const share = tripsRepo.createShare({ tripId: t.id, sharedWithUserId: friend.id, permission: 'edit' });
	expect(share.permission).toBe('edit');
	expect(tripsRepo.getDirectShareForTrip(t.id, friend.id)?.permission).toBe('edit');
	expect(tripsRepo.listSharesForTrip(t.id)).toHaveLength(1);

	tripsRepo.updateShare(share.id, { permission: 'read' });
	expect(tripsRepo.getDirectShareForTrip(t.id, friend.id)?.permission).toBe('read');

	tripsRepo.deleteShare(share.id);
	expect(tripsRepo.getDirectShareForTrip(t.id, friend.id)).toBeNull();
});

test('group shares resolve via group membership', () => {
	const owner = makeUser('owner@x.c');
	const member = makeUser('member@x.c');
	const t = makeTrip(owner.id, 'Group');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'fam' });
	tripsRepo.addGroupMember(g.id, member.id);
	tripsRepo.createShare({ tripId: t.id, sharedWithGroupId: g.id, permission: 'edit' });

	expect(tripsRepo.getGroupShareForTrip(t.id, member.id)?.permission).toBe('edit');
	expect(tripsRepo.listViewableTripIdsForUser(member.id)).toContain(t.id);
	expect(tripsRepo.listEditableTripIdsForUser(member.id)).toContain(t.id);
});

test('groups and members persist', () => {
	const kit = kitDb();
	const owner = makeUser('owner@x.c');
	const member = makeUser('member@x.c');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'team' });
	expect(tripsRepo.getGroupById(g.id)?.name).toBe('team');
	expect(tripsRepo.listGroupsForUser(owner.id)).toHaveLength(1);
	expect(kit.selectFrom(groups).where(eq(groups.id, BigInt(g.id))).executeSync()[0]?.name).toBe('team');

	tripsRepo.addGroupMember(g.id, member.id);
	expect(
		kit.selectFrom(groupMembers).where(eq(groupMembers.group_id, BigInt(g.id))).executeSync()
	).toHaveLength(1);

	tripsRepo.updateGroup(g.id, { name: 'crew' });
	expect(tripsRepo.getGroupById(g.id)?.name).toBe('crew');

	tripsRepo.removeGroupMember(g.id, member.id);
	expect(
		kit.selectFrom(groupMembers).where(eq(groupMembers.group_id, BigInt(g.id))).executeSync()
	).toHaveLength(0);

	tripsRepo.deleteGroup(g.id);
	expect(tripsRepo.getGroupById(g.id)).toBeNull();
	expect(kit.selectFrom(groups).where(eq(groups.id, BigInt(g.id))).executeSync()[0]).toBeUndefined();
});

test('comments and public/calendar tokens', () => {
	const kit = kitDb();
	const owner = makeUser('owner@x.c');
	const t = makeTrip(owner.id, 'Tokens');

	tripsRepo.createComment(owner.id, t.id, 'First note');
	expect(tripsRepo.listCommentsForTrip(t.id)).toHaveLength(1);
	expect(
		kit.selectFrom(tripComments).where(eq(tripComments.trip_id, BigInt(t.id))).executeSync()
	).toHaveLength(1);

	tripsRepo.updateTrip(t.id, { publicToken: 'abc123', publicShowDetails: true });
	expect(tripsRepo.getTripByPublicToken('abc123')?.id).toBe(t.id);

	tripsRepo.updateTrip(t.id, { calendarToken: 'cal456' });
	expect(tripsRepo.getTripByCalendarToken('cal456')?.id).toBe(t.id);
});

test('repo reads see directly inserted trips', () => {
	const kit = kitDb();
	const owner = makeUser('owner@x.c');
	const inserted = kit
		.insertInto(trips)
		.values({ owner_id: BigInt(owner.id), name: 'Direct Trip' })
		.executeSync();
	const found = tripsRepo.getTripById(Number(inserted.id));
	expect(found?.name).toBe('Direct Trip');
});
