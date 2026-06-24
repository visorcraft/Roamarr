import { test, expect, vi } from 'vitest';

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
	_mintPublicToken as mintPublicToken
} from './+page.server';
import { canView, canEdit } from '$lib/server/sharing';
import { users, trips, groups, groupMembers, tripShares, auditLogs } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

test('owner can revoke a user share', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	shareWithUserEmail(a.id, t.id, 'b@x.c');
	expect(canView(b.id, t)).toBe(true);
	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	unshareUser(a.id, t.id, share.id);
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all().length).toBe(0);
	expect(canView(b.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(false);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, a.id)).all();
	expect(logs).toHaveLength(2);
	expect(logs[0].action).toBe('trip_share_user');
	expect(JSON.parse(logs[0].metaJson).sharedWithUserId).toBe(b.id);
	expect(logs[1].action).toBe('trip_unshare_user');
	expect(JSON.parse(logs[1].metaJson).shareId).toBe(share.id);
});

test('owner can revoke a group share', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const member = db.insert(users).values({ email: 'm@x.c', passwordHash: 'x', displayName: 'M' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const g = db.insert(groups).values({ ownerId: owner.id, name: 'fam' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: member.id }).run();
	shareWithGroup(owner.id, t.id, g.id);
	expect(canView(member.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(true);

	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	unshareGroup(owner.id, t.id, share.id);
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all().length).toBe(0);
	expect(canView(member.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(false);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id)).all();
	expect(logs).toHaveLength(2);
	expect(logs[0].action).toBe('trip_share_group');
	expect(JSON.parse(logs[0].metaJson).sharedWithGroupId).toBe(g.id);
	expect(logs[1].action).toBe('trip_unshare_group');
});

test('non-owner cannot revoke a share', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'no-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'no-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
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
	const owner = db.insert(users).values({ email: 'mix-o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const friend = db.insert(users).values({ email: 'mix-f@x.c', passwordHash: 'x', displayName: 'F' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const g = db.insert(groups).values({ ownerId: owner.id, name: 'fam' }).returning().get();

	shareWithUserEmail(owner.id, t.id, 'mix-f@x.c');
	shareWithGroup(owner.id, t.id, g.id);
	const allShares = db
		.select()
		.from(tripShares)
		.where(eq(tripShares.tripId, t.id))
		.all();
	const userShare = allShares.find((s) => s.sharedWithUserId === friend.id)!;
	const groupShare = allShares.find((s) => s.sharedWithGroupId === g.id)!;

	unshareUser(owner.id, t.id, userShare.id);
	expect(
		db
			.select()
			.from(tripShares)
			.where(eq(tripShares.tripId, t.id))
			.all()
			.map((s) => s.id)
	).toEqual([groupShare.id]);
	unshareGroup(owner.id, t.id, groupShare.id);
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all().length).toBe(0);
});

test('minting a public token is audited', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'pub-o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	mintPublicToken(owner.id, t.id);
	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_public_token_mint');
	expect(logs[0].entityType).toBe('trip');
	expect(logs[0].entityId).toBe(t.id);
});

test('share functions default to read and accept edit permission', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'perm-o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const reader = db.insert(users).values({ email: 'perm-r@x.c', passwordHash: 'x', displayName: 'R' }).returning().get();
	const editor = db.insert(users).values({ email: 'perm-e@x.c', passwordHash: 'x', displayName: 'E' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();

	shareWithUserEmail(owner.id, t.id, reader.email);
	shareWithUserEmail(owner.id, t.id, editor.email, 'edit');

	const shares = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all();
	expect(shares.find((s) => s.sharedWithUserId === reader.id)?.permission).toBe('read');
	expect(shares.find((s) => s.sharedWithUserId === editor.id)?.permission).toBe('edit');
	expect(canEdit(reader.id, t)).toBe(false);
	expect(canEdit(editor.id, t)).toBe(true);
});

test('group share can be created with edit permission', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'gperm-o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const member = db.insert(users).values({ email: 'gperm-m@x.c', passwordHash: 'x', displayName: 'M' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const g = db.insert(groups).values({ ownerId: owner.id, name: 'editors' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: member.id }).run();

	shareWithGroup(owner.id, t.id, g.id, 'edit');
	const share = db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).get()!;
	expect(share.permission).toBe('edit');
	expect(canEdit(member.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(true);
});
