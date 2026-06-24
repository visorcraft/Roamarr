import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addDocument } from './+page.server';
import { users, travelDocuments } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

test('visa is accepted as a travel-document type', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'visa@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const doc = _addDocument(u.id, { type: 'visa', issuingAuthority: 'US Embassy', expiresOn: '2027-01-01' });
	expect(doc.type).toBe('visa');
	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.type).toBe('visa');
});
