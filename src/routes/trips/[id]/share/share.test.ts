import { test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	_shareWithUserEmail as shareWithUserEmail,
	_shareWithGroup as shareWithGroup,
	_unshareUser as unshareUser,
	_unshareGroup as unshareGroup,
	_mintPublicToken as mintPublicToken,
	_setShowDetails as setShowDetails,
	_setPublicShowDetails as setPublicShowDetails
} from './+page.server';
import { canView, canEdit, listGroupsForUser } from '$lib/server/sharing';
import { users, groups, groupMembers, tripShares, auditLogs } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
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

test('owner can revoke a user share', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser('a@x.c');
	const b = makeUser('b@x.c');
	const t = makeTrip(a.id, 'T');
	shareWithUserEmail(a.id, t.id, 'b@x.c');
	expect(canView(b.id, t)).toBe(true);
	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	unshareUser(a.id, t.id, share.id);
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all().length).toBe(0);
	expect(canView(b.id, t)).toBe(false);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, a.id)).all();
	expect(logs).toHaveLength(2);
	expect(logs[0].action).toBe('trip_share_user');
	expect(JSON.parse(logs[0].metaJson).sharedWithUserId).toBe(b.id);
	expect(logs[1].action).toBe('trip_unshare_user');
	expect(JSON.parse(logs[1].metaJson).shareId).toBe(share.id);
});

test('owner can revoke a group share', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('o@x.c');
	const member = makeUser('m@x.c');
	const t = makeTrip(owner.id, 'T');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'fam' });
	tripsRepo.addGroupMember(g.id, member.id);
	shareWithGroup(owner.id, t.id, g.id);
	expect(canView(member.id, t)).toBe(true);

	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	unshareGroup(owner.id, t.id, share.id);
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all().length).toBe(0);
	expect(canView(member.id, t)).toBe(false);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id)).all();
	expect(logs).toHaveLength(2);
	expect(logs[0].action).toBe('trip_share_group');
	expect(JSON.parse(logs[0].metaJson).sharedWithGroupId).toBe(g.id);
	expect(logs[1].action).toBe('trip_unshare_group');
});

test('non-owner cannot revoke a share', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser('no-a@x.c');
	const b = makeUser('no-b@x.c');
	const t = makeTrip(a.id, 'T');
	shareWithUserEmail(a.id, t.id, 'no-b@x.c');
	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	expect(() => unshareUser(b.id, t.id, share.id)).toThrow();
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all().length).toBe(1);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, a.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_share_user');
	expect(db.select().from(auditLogs).where(eq(auditLogs.userId, b.id)).all()).toHaveLength(0);
});

test('user unshare does not delete group shares and vice versa', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('mix-o@x.c');
	const friend = makeUser('mix-f@x.c');
	const t = makeTrip(owner.id, 'T');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'fam' });

	shareWithUserEmail(owner.id, t.id, 'mix-f@x.c');
	shareWithGroup(owner.id, t.id, g.id);
	const allShares = db
		.select()
		.from(tripShares)
		.where(eq(tripShares.tripId, t.id))
		.all();
	const userShare = allShares.find((s: Record<string, unknown>) => s.sharedWithUserId === friend.id)!;
	const groupShare = allShares.find((s: Record<string, unknown>) => s.sharedWithGroupId === g.id)!;

	unshareUser(owner.id, t.id, userShare.id);
	expect(
		db
			.select()
			.from(tripShares)
			.where(eq(tripShares.tripId, t.id))
			.all()
			.map((s: Record<string, unknown>) => s.id)
	).toEqual([groupShare.id]);
	unshareGroup(owner.id, t.id, groupShare.id);
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all().length).toBe(0);
});

test('minting a public token is audited', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('pub-o@x.c');
	const t = makeTrip(owner.id, 'T');
	mintPublicToken(owner.id, t.id);
	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_public_token_mint');
	expect(logs[0].entityType).toBe('trip');
	expect(logs[0].entityId).toBe(t.id);
});

test('share functions default to read and accept edit permission', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('perm-o@x.c');
	const reader = makeUser('perm-r@x.c');
	const editor = makeUser('perm-e@x.c');
	const t = makeTrip(owner.id, 'T');

	shareWithUserEmail(owner.id, t.id, reader.email);
	shareWithUserEmail(owner.id, t.id, editor.email, 'edit');

	const shares = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all();
	expect(shares.find((s: Record<string, unknown>) => s.sharedWithUserId === reader.id)?.permission).toBe('read');
	expect(shares.find((s: Record<string, unknown>) => s.sharedWithUserId === editor.id)?.permission).toBe('edit');
	expect(canEdit(reader.id, t)).toBe(false);
	expect(canEdit(editor.id, t)).toBe(true);
});

test('group share can be created with edit permission', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('gperm-o@x.c');
	const member = makeUser('gperm-m@x.c');
	const t = makeTrip(owner.id, 'T');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'editors' });
	tripsRepo.addGroupMember(g.id, member.id);

	shareWithGroup(owner.id, t.id, g.id, 'edit');
	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	expect(share.permission).toBe('edit');
	expect(canEdit(member.id, t)).toBe(true);
});

test('owner can toggle showDetails on a share; non-owner cannot', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('details-o@x.c');
	const friend = makeUser('details-f@x.c');
	const t = makeTrip(owner.id, 'T');
	shareWithUserEmail(owner.id, t.id, friend.email);
	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	expect(share.showDetails).toBe(false);

	setShowDetails(owner.id, t.id, share.id, true);
	const updated = db.select().from(tripShares).where(eq(tripShares.id, share.id)).get()!;
	expect(updated.showDetails).toBe(true);

	expect(() => setShowDetails(friend.id, t.id, share.id, false)).toThrow();
	expect(db.select().from(tripShares).where(eq(tripShares.id, share.id)).get()!.showDetails).toBe(true);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id)).all();
	expect(logs.some((l: Record<string, unknown>) => l.action === 'trip_share_set_show_details')).toBe(true);
});


test('member can share their own trip into a group they belong to', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('mem-o@x.c');
	const member = makeUser('mem-m@x.c');
	const other = makeUser('mem-other@x.c');
	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'fam' });
	tripsRepo.addGroupMember(g.id, member.id);
	tripsRepo.addGroupMember(g.id, other.id);
	const t = makeTrip(member.id, 'Member Trip');

	shareWithGroup(member.id, t.id, g.id);
	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	expect(share.sharedWithGroupId).toBe(g.id);
	expect(canView(other.id, t)).toBe(true);
});

test('user cannot share into a group they do not belong to', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser('no-mem-a@x.c');
	const b = makeUser('no-mem-b@x.c');
	const g = tripsRepo.createGroup({ ownerId: a.id, name: 'private' });
	const t = makeTrip(b.id, 'B Trip');

	expect(() => shareWithGroup(b.id, t.id, g.id)).toThrow();
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all()).toHaveLength(0);
});

test('listGroupsForUser returns owned and member groups', () => {
	const a = makeUser('lg-a@x.c');
	const b = makeUser('lg-b@x.c');
	tripsRepo.createGroup({ ownerId: a.id, name: 'Owned' });
	const memberGroup = tripsRepo.createGroup({ ownerId: b.id, name: 'Member' });
	tripsRepo.addGroupMember(memberGroup.id, a.id);
	tripsRepo.createGroup({ ownerId: b.id, name: 'Other' });

	const list = listGroupsForUser(a.id);
	expect(list.map((g) => g.name).sort()).toEqual(['Member', 'Owned']);
});

test('public token can be minted with showDetails enabled', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser('pub-det-o@x.c');
	const t = makeTrip(owner.id, 'T');

	mintPublicToken(owner.id, t.id, true);
	const updated = tripsRepo.getTripById(t.id)!;
	expect(updated.publicToken).toBeTruthy();
	expect(updated.publicShowDetails).toBe(true);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id)).all();
	expect(logs.some((l: Record<string, unknown>) => l.action === 'trip_public_token_mint' && JSON.parse(String(l.metaJson)).publicShowDetails === true)).toBe(true);
});

test('owner can toggle publicShowDetails; non-owner cannot', () => {
	const owner = makeUser('pub-toggle-o@x.c');
	const other = makeUser('pub-toggle-x@x.c');
	const t = makeTrip(owner.id, 'T');

	setPublicShowDetails(owner.id, t.id, true);
	expect(tripsRepo.getTripById(t.id)!.publicShowDetails).toBe(true);

	expect(() => setPublicShowDetails(other.id, t.id, false)).toThrow();
	expect(tripsRepo.getTripById(t.id)!.publicShowDetails).toBe(true);

	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id)).all();
	expect(logs.some((l: Record<string, unknown>) => l.action === 'trip_public_set_show_details')).toBe(true);
});
