import { test, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq } from '@mongreldb/kit';
import * as tripsRepo from './tripsRepo';
import * as usersRepo from './usersRepo';
import {
	users as drizzleUsers,
	trips as drizzleTrips,
	tripShares as drizzleTripShares,
	tripComments as drizzleTripComments,
	groups as drizzleGroups,
	groupMembers as drizzleGroupMembers
} from '$lib/server/db/mongrelSchema';
import {
	users as kitUsers,
	trips as kitTrips,
	tripShares as kitTripShares,
	tripComments as kitTripComments,
	groups as kitGroups,
	groupMembers as kitGroupMembers
} from '$lib/server/db/mongrelSchema';

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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(drizzleTripComments).run();
	db.delete(drizzleTripShares).run();
	db.delete(drizzleGroupMembers).run();
	db.delete(drizzleGroups).run();
	db.delete(drizzleTrips).run();
	db.delete(drizzleUsers).run();
	kit.deleteFrom(kitTripComments).executeSync();
	kit.deleteFrom(kitTripShares).executeSync();
	kit.deleteFrom(kitGroupMembers).executeSync();
	kit.deleteFrom(kitGroups).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

test('CRUD trips and mirror to legacy', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('owner@x.c');
	const t = makeTrip(owner.id, 'Tokyo');
	expect(t.name).toBe('Tokyo');
	expect(tripsRepo.getTripById(t.id)?.name).toBe('Tokyo');
	expect(tripsRepo.listTripsForUser(owner.id)).toHaveLength(1);

	const legacy = db.select().from(drizzleTrips).where(eq(drizzleTrips.id, BigInt(t.id))).get();
	expect(legacy?.name).toBe('Tokyo');

	const updated = tripsRepo.updateTrip(t.id, { name: 'Kyoto' });
	expect(updated?.name).toBe('Kyoto');
	expect(db.select().from(drizzleTrips).where(eq(drizzleTrips.id, BigInt(t.id))).get()?.name).toBe('Kyoto');

	tripsRepo.deleteTrip(t.id);
	expect(tripsRepo.getTripById(t.id)).toBeNull();
	expect(db.select().from(drizzleTrips).where(eq(drizzleTrips.id, BigInt(t.id))).get()).toBeUndefined();
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

test('groups and members are mirrored to legacy', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('owner@x.c');
	const member = makeUser('member@x.c');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'team' });
	expect(tripsRepo.getGroupById(g.id)?.name).toBe('team');
	expect(tripsRepo.listGroupsForUser(owner.id)).toHaveLength(1);
	expect(db.select().from(drizzleGroups).where(eq(drizzleGroups.id, BigInt(g.id))).get()?.name).toBe('team');

	tripsRepo.addGroupMember(g.id, member.id);
	expect(
		db
			.select()
			.from(drizzleGroupMembers)
			.where(eq(drizzleGroupMembers.group_id, BigInt(g.id)))
			.all()
	).toHaveLength(1);

	tripsRepo.updateGroup(g.id, { name: 'crew' });
	expect(tripsRepo.getGroupById(g.id)?.name).toBe('crew');

	tripsRepo.removeGroupMember(g.id, member.id);
	expect(
		db
			.select()
			.from(drizzleGroupMembers)
			.where(eq(drizzleGroupMembers.group_id, BigInt(g.id)))
			.all()
	).toHaveLength(0);

	tripsRepo.deleteGroup(g.id);
	expect(tripsRepo.getGroupById(g.id)).toBeNull();
	expect(db.select().from(drizzleGroups).where(eq(drizzleGroups.id, BigInt(g.id))).get()).toBeUndefined();
});

test('comments and public/calendar tokens', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('owner@x.c');
	const t = makeTrip(owner.id, 'Tokens');

	tripsRepo.createComment(owner.id, t.id, 'First note');
	expect(tripsRepo.listCommentsForTrip(t.id)).toHaveLength(1);
	expect(
		db
			.select()
			.from(drizzleTripComments)
			.where(eq(drizzleTripComments.trip_id, BigInt(t.id)))
			.all()
	).toHaveLength(1);

	tripsRepo.updateTrip(t.id, { publicToken: 'abc123', publicShowDetails: true });
	expect(tripsRepo.getTripByPublicToken('abc123')?.id).toBe(t.id);

	tripsRepo.updateTrip(t.id, { calendarToken: 'cal456' });
	expect(tripsRepo.getTripByCalendarToken('cal456')?.id).toBe(t.id);
});

test('legacy fallback read for trips', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('owner@x.c');
	const legacy = db
		.insert(drizzleTrips)
		.values({ ownerId: owner.id, name: 'Legacy Trip' })
		.returning()
		.get();
	const found = tripsRepo.getTripById(legacy.id);
	expect(found?.name).toBe('Legacy Trip');
});
