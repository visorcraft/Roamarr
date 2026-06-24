import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { listComments, addComment, deleteComment } from './tripComments';
import { users, trips, tripComments } from './db/schema';
import { eq } from 'drizzle-orm';

test('comment lifecycle', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const comment = addComment(u.id, t.id, 'Hello');
	expect(listComments(t.id).map((c) => c.body)).toEqual(['Hello']);

	deleteComment(u.id, comment.id);
	expect(db.select().from(tripComments).where(eq(tripComments.id, comment.id)).get()).toBeUndefined();
});

test('deleteComment only removes the users own comment', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const comment = addComment(a.id, t.id, 'Mine');

	deleteComment(b.id, comment.id);
	expect(db.select().from(tripComments).where(eq(tripComments.id, comment.id)).get()).toBeDefined();
});
