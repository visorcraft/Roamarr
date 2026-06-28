import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from './db';

import { makeUser, makeTrip } from '../../../tests/helpers';


import { listComments, addComment, deleteComment } from './tripComments';
import { users, trips, tripComments } from './db/schema';
import { eq } from 'drizzle-orm';

test('comment lifecycle', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser(db, kit, { email: 'c@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(db, kit, u.id, { name: 'T' });

	const comment = addComment(u.id, t.id, 'Hello');
	expect(listComments(t.id).map((c) => c.body)).toEqual(['Hello']);

	deleteComment(u.id, comment.id);
	expect(db.select().from(tripComments).where(eq(tripComments.id, comment.id)).get()).toBeUndefined();
});

test('deleteComment only removes the users own comment', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = makeUser(db, kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(db, kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });
	const t = makeTrip(db, kit, a.id, { name: 'T' });
	const comment = addComment(a.id, t.id, 'Mine');

	deleteComment(b.id, comment.id);
	expect(db.select().from(tripComments).where(eq(tripComments.id, comment.id)).get()).toBeDefined();
});
