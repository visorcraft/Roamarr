import { test, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import * as tripsRepo from './tripsRepo';
import * as usersRepo from './usersRepo';
import { subscribeUser } from '../eventBus';
import { canView } from '$lib/server/sharing';
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

test('listTripsForUser and getTripById see every owned trip (fullscan-safe)', () => {
	const owner = makeUser('owner@x.c');
	const other = makeUser('other@x.c');
	const a = makeTrip(owner.id, 'August Bangkok');
	const b = makeTrip(owner.id, 'December Bangkok');
	makeTrip(other.id, 'Someone else');

	const listed = tripsRepo.listTripsForUser(owner.id);
	expect(listed.map((t) => t.id).sort((x, y) => x - y)).toEqual([a.id, b.id].sort((x, y) => x - y));
	expect(tripsRepo.getTripById(a.id)?.name).toBe('August Bangkok');
	expect(tripsRepo.getTripById(b.id)?.name).toBe('December Bangkok');

	// Title-only updates must not drop either trip from the owner list
	// (regression: MongrelDB secondary / RangeInt desync after updates).
	for (const name of ['August v2', 'August v3', 'August final']) {
		tripsRepo.updateTrip(a.id, { name });
	}
	expect(tripsRepo.listTripsForUser(owner.id).map((t) => t.id).sort((x, y) => x - y)).toEqual(
		[a.id, b.id].sort((x, y) => x - y)
	);
	expect(tripsRepo.getTripById(a.id)?.name).toBe('August final');
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

test('deleteGroup publishes a shares change to every former member', () => {
	const kit = kitDb();
	const owner = makeUser('owner@x.c');
	const member1 = makeUser('member1@x.c');
	const member2 = makeUser('member2@x.c');
	const t = makeTrip(owner.id, 'Shared');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'team' });
	tripsRepo.addGroupMember(g.id, member1.id);
	tripsRepo.addGroupMember(g.id, member2.id);
	tripsRepo.createShare({ tripId: t.id, sharedWithGroupId: g.id, permission: 'read' });
	expect(canView(member1.id, t)).toBe(true);

	const events1: Array<{ type: string; kind: string }> = [];
	const events2: Array<{ type: string; kind: string }> = [];
	const unsubscribe1 = subscribeUser(member1.id, (e) => events1.push(e as never));
	const unsubscribe2 = subscribeUser(member2.id, (e) => events2.push(e as never));

	const deleted = tripsRepo.deleteGroup(g.id);
	expect(deleted).toBe(1);
	expect(events1).toContainEqual({ type: 'user', kind: 'shares' });
	expect(events2).toContainEqual({ type: 'user', kind: 'shares' });
	expect(
		kit.selectFrom(groupMembers).where(eq(groupMembers.group_id, BigInt(g.id))).executeSync()
	).toHaveLength(0);
	expect(canView(member1.id, t)).toBe(false);
	unsubscribe1!();
	unsubscribe2!();
});

test('deleteGroup publishes nothing for non-members or a missing group', () => {
	const owner = makeUser('owner@x.c');
	const member = makeUser('member@x.c');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'team' });
	tripsRepo.addGroupMember(g.id, member.id);

	const ownerEvents: Array<{ type: string; kind: string }> = [];
	const memberEvents: Array<{ type: string; kind: string }> = [];
	const unsubscribeOwner = subscribeUser(owner.id, (e) => ownerEvents.push(e as never));
	const unsubscribeMember = subscribeUser(member.id, (e) => memberEvents.push(e as never));

	expect(tripsRepo.deleteGroup(g.id)).toBe(1);
	expect(ownerEvents).toHaveLength(0);
	expect(memberEvents).toHaveLength(1);

	expect(tripsRepo.deleteGroup(999999)).toBe(0);
	expect(ownerEvents).toHaveLength(0);
	expect(memberEvents).toHaveLength(1);
	unsubscribeOwner!();
	unsubscribeMember!();
});

test('deleteGroup publishes nothing for a group with no members', () => {
	const owner = makeUser('owner@x.c');
	const unrelated = makeUser('unrelated@x.c');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'empty' });

	const events: Array<{ type: string; kind: string }> = [];
	const unsubscribe = subscribeUser(unrelated.id, (e) => events.push(e as never));

	expect(tripsRepo.deleteGroup(g.id)).toBe(1);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

test('updateShare publishes a shares change to the shared-with user', () => {
	const owner = makeUser('owner@x.c');
	const sharee = makeUser('sharee@x.c');
	const unrelated = makeUser('unrelated@x.c');
	const t = makeTrip(owner.id, 'Shared');
	const share = tripsRepo.createShare({ tripId: t.id, sharedWithUserId: sharee.id, permission: 'read' });

	const shareeEvents: Array<{ type: string; kind: string }> = [];
	const ownerEvents: Array<{ type: string; kind: string }> = [];
	const unrelatedEvents: Array<{ type: string; kind: string }> = [];
	const unsubscribeSharee = subscribeUser(sharee.id, (e) => shareeEvents.push(e as never));
	const unsubscribeOwner = subscribeUser(owner.id, (e) => ownerEvents.push(e as never));
	const unsubscribeUnrelated = subscribeUser(unrelated.id, (e) => unrelatedEvents.push(e as never));

	const updated = tripsRepo.updateShare(share.id, { permission: 'edit' });
	expect(updated?.permission).toBe('edit');
	expect(shareeEvents).toHaveLength(1);
	expect(shareeEvents).toContainEqual({ type: 'user', kind: 'shares' });
	expect(ownerEvents).toHaveLength(0);
	expect(unrelatedEvents).toHaveLength(0);
	expect(tripsRepo.getShareById(share.id)?.permission).toBe('edit');
	expect(tripsRepo.getShareById(share.id)?.showDetails).toBe(false);
	unsubscribeSharee!();
	unsubscribeOwner!();
	unsubscribeUnrelated!();
});

test('updateShare on a group share notifies every current member', () => {
	const owner = makeUser('owner@x.c');
	const member1 = makeUser('member1@x.c');
	const member2 = makeUser('member2@x.c');
	const nonMember = makeUser('nonmember@x.c');
	const t = makeTrip(owner.id, 'Shared');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'team' });
	tripsRepo.addGroupMember(g.id, member1.id);
	tripsRepo.addGroupMember(g.id, member2.id);
	const share = tripsRepo.createShare({ tripId: t.id, sharedWithGroupId: g.id, permission: 'read' });

	const events1: Array<{ type: string; kind: string }> = [];
	const events2: Array<{ type: string; kind: string }> = [];
	const nonMemberEvents: Array<{ type: string; kind: string }> = [];
	const unsubscribe1 = subscribeUser(member1.id, (e) => events1.push(e as never));
	const unsubscribe2 = subscribeUser(member2.id, (e) => events2.push(e as never));
	const unsubscribeNonMember = subscribeUser(nonMember.id, (e) => nonMemberEvents.push(e as never));

	const updated = tripsRepo.updateShare(share.id, { showDetails: true });
	expect(updated?.showDetails).toBe(true);
	expect(events1).toHaveLength(1);
	expect(events1).toContainEqual({ type: 'user', kind: 'shares' });
	expect(events2).toHaveLength(1);
	expect(events2).toContainEqual({ type: 'user', kind: 'shares' });
	expect(nonMemberEvents).toHaveLength(0);
	expect(tripsRepo.getShareById(share.id)?.showDetails).toBe(true);
	expect(tripsRepo.getShareById(share.id)?.permission).toBe('read');
	unsubscribe1!();
	unsubscribe2!();
	unsubscribeNonMember!();
});

test('updateShare with an empty patch returns the share without writing or publishing', () => {
	const owner = makeUser('owner@x.c');
	const sharee = makeUser('sharee@x.c');
	const t = makeTrip(owner.id, 'Shared');
	const share = tripsRepo.createShare({ tripId: t.id, sharedWithUserId: sharee.id, permission: 'read' });

	const events: Array<{ type: string; kind: string }> = [];
	const unsubscribe = subscribeUser(sharee.id, (e) => events.push(e as never));

	const before = tripsRepo.getShareById(share.id);
	const after = tripsRepo.updateShare(share.id, {});
	expect(after).toEqual(before);
	expect(events).toHaveLength(0);
	expect(tripsRepo.getShareById(share.id)).toEqual(before);
	expect(tripsRepo.updateShare(1_000_000_000, {})).toBeNull();
	unsubscribe!();
});

test('updateShare on a missing share returns null and publishes nothing', () => {
	const owner = makeUser('owner@x.c');
	const sharee = makeUser('sharee@x.c');

	const events: Array<{ type: string; kind: string }> = [];
	const unsubscribe = subscribeUser(sharee.id, (e) => events.push(e as never));

	expect(tripsRepo.updateShare(1_000_000_000, { permission: 'edit' })).toBeNull();
	expect(events).toHaveLength(0);
	unsubscribe!();
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

test('countGroupsForUser does not double-count owned-and-member groups', () => {
	const owner = makeUser('owner@x.c');
	const member = makeUser('member@x.c');
	const ownedGroup = tripsRepo.createGroup({ ownerId: owner.id, name: 'Owned' });
	const memberGroup = tripsRepo.createGroup({ ownerId: member.id, name: 'Member' });
	tripsRepo.addGroupMember(ownedGroup.id, owner.id);
	tripsRepo.addGroupMember(memberGroup.id, owner.id);

	expect(tripsRepo.countGroupsForUser(owner.id)).toBe(2);
	expect(tripsRepo.listGroupsForUser(owner.id)).toHaveLength(2);
});

test('countMembersForGroupIds aggregates members across groups', () => {
	const owner = makeUser('owner@x.c');
	const member1 = makeUser('member1@x.c');
	const member2 = makeUser('member2@x.c');
	const g1 = tripsRepo.createGroup({ ownerId: owner.id, name: 'G1' });
	const g2 = tripsRepo.createGroup({ ownerId: owner.id, name: 'G2' });

	expect(tripsRepo.countMembersForGroupIds([])).toEqual(new Map());

	tripsRepo.addGroupMember(g1.id, owner.id);
	tripsRepo.addGroupMember(g1.id, member1.id);
	tripsRepo.addGroupMember(g2.id, member2.id);

	const counts = tripsRepo.countMembersForGroupIds([g1.id, g2.id, 999999]);
	expect(counts.get(g1.id)).toBe(2);
	expect(counts.get(g2.id)).toBe(1);
	expect(counts.has(999999)).toBe(false);
});

test('listGroupsForUserPaginated searches, sorts, and paginates', () => {
	const owner = makeUser('owner@x.c');
	tripsRepo.createGroup({ ownerId: owner.id, name: 'Alpha' });
	tripsRepo.createGroup({ ownerId: owner.id, name: 'Beta' });
	tripsRepo.createGroup({ ownerId: owner.id, name: 'Gamma' });

	const page = tripsRepo.listGroupsForUserPaginated(owner.id, { limit: 2, offset: 0, sortDir: 'asc' });
	expect(page).toHaveLength(2);
	expect(page[0].name).toBe('Alpha');
	expect(page[1].name).toBe('Beta');

	const second = tripsRepo.listGroupsForUserPaginated(owner.id, {
		limit: 2,
		offset: 1,
		sortDir: 'desc'
	});
	expect(second).toHaveLength(2);
	expect(second[0].name).toBe('Beta');
	expect(second[1].name).toBe('Alpha');

	const searched = tripsRepo.listGroupsForUserPaginated(owner.id, { search: 'mm' });
	expect(searched.map((g) => g.name)).toEqual(['Gamma']);
});


test('new trips use the owner currency unless explicitly supplied', () => {
	const owner = makeUser('currency@x.c');
	kitDb().updateTable(users).set({ default_currency: 'EUR' }).where(eq(users.id, BigInt(owner.id))).executeSync();
	expect(tripsRepo.createTrip(owner.id, { name: 'Default' }).baseCurrency).toBe('EUR');
	expect(tripsRepo.createTrip(owner.id, { name: 'Override', baseCurrency: 'GBP' }).baseCurrency).toBe('GBP');
	const other = makeUser('currency-other@x.c');
	expect(tripsRepo.createTrip(other.id, { name: 'Other owner' }).baseCurrency).toBe('USD');
});
