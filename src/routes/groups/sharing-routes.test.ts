import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

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
import { users, trips, groups, groupMembers } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

test('sharing with a user grants canView; public token is set', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	shareWithUserEmail(a.id, t.id, 'B@X.c');
	expect(canView(b.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(true);
	const token = mintPublicToken(a.id, t.id);
	expect(db.select().from(trips).where(eq(trips.id, t.id)).get()!.publicToken).toBe(token);
});

test('group share requires the group to belong to the sharer', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db
		.insert(users)
		.values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' })
		.returning()
		.get();
	const other = db
		.insert(users)
		.values({ email: 'g@x.c', passwordHash: 'x', displayName: 'G' })
		.returning()
		.get();
	const member = db
		.insert(users)
		.values({ email: 'm@x.c', passwordHash: 'x', displayName: 'M' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const foreign = db.insert(groups).values({ ownerId: other.id, name: 'theirs' }).returning().get();
	expect(() => shareWithGroup(owner.id, t.id, foreign.id)).toThrow();

	const mine = db.insert(groups).values({ ownerId: owner.id, name: 'mine' }).returning().get();
	db.insert(groupMembers).values({ groupId: mine.id, userId: member.id }).run();
	shareWithGroup(owner.id, t.id, mine.id);
	expect(canView(member.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(true);
});

test('group owner can remove a member and delete the group', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db
		.insert(users)
		.values({ email: 'o2@x.c', passwordHash: 'x', displayName: 'O2' })
		.returning()
		.get();
	const member = db
		.insert(users)
		.values({ email: 'm2@x.c', passwordHash: 'x', displayName: 'M2' })
		.returning()
		.get();
	const g = db.insert(groups).values({ ownerId: owner.id, name: 'team' }).returning().get();
	addMember(owner.id, g.id, 'm2@x.c');
	expect(db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id)).all()).toHaveLength(1);

	removeMember(owner.id, g.id, member.id);
	expect(db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id)).all()).toHaveLength(0);

	deleteGroup(owner.id, g.id);
	expect(db.select().from(groups).where(eq(groups.id, g.id)).get()).toBeUndefined();
});

test('non-owner cannot remove members or delete a group', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a2@x.c', passwordHash: 'x', displayName: 'A2' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b2@x.c', passwordHash: 'x', displayName: 'B2' })
		.returning()
		.get();
	const member = db
		.insert(users)
		.values({ email: 'm3@x.c', passwordHash: 'x', displayName: 'M3' })
		.returning()
		.get();
	const g = db.insert(groups).values({ ownerId: a.id, name: 'private' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: member.id }).run();

	expect(() => removeMember(b.id, g.id, member.id)).toThrow();
	expect(() => deleteGroup(b.id, g.id)).toThrow();
	expect(db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id)).all()).toHaveLength(1);
	expect(db.select().from(groups).where(eq(groups.id, g.id)).get()).toBeDefined();
});
