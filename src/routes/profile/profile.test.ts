import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
const remindersMock = vi.hoisted(() => ({
	upsertRemindersForDocument: vi.fn(),
	cancelRemindersFor: vi.fn()
}));
vi.mock('$lib/server/reminders', () => remindersMock);

import { addDocument } from './documents/+page.server';
import { upsertRemindersForDocument } from '$lib/server/reminders';
import { users, travelDocuments } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';

test('document number is encrypted at rest and arms a reminder', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	addDocument(u.id, {
		type: 'passport',
		number: 'X1234567',
		issuingAuthority: 'US',
		expiresOn: '2030-01-01'
	});
	const row = db.select().from(travelDocuments).get()!;
	expect(row.number).not.toBe('X1234567');
	expect(decrypt(row.number!)).toBe('X1234567');
	expect(upsertRemindersForDocument).toHaveBeenCalled();
});
