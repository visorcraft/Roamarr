import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from './db';

import { makeUser, makeTrip } from '../../../tests/helpers';


import { listComments, addComment, deleteComment } from './tripComments';
import { tripComments } from './db/mongrelSchema';
import { eq } from '@mongreldb/kit';

test('comment lifecycle', () => {
	const u = makeUser(kit, { email: 'c@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const comment = addComment(u.id, t.id, 'Hello');
	expect(listComments(t.id).map((c) => c.body)).toEqual(['Hello']);

	deleteComment(u.id, comment.id);
	expect(
		kit.selectFrom(tripComments).where(eq(tripComments.id, BigInt(comment.id))).executeSync()[0]
	).toBeUndefined();
});

test('deleteComment only removes the users own comment', () => {
	const a = makeUser(kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const comment = addComment(a.id, t.id, 'Mine');

	deleteComment(b.id, comment.id);
	expect(
		kit.selectFrom(tripComments).where(eq(tripComments.id, BigInt(comment.id))).executeSync()[0]
	).toBeDefined();
});
