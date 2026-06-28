import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { loadTripFor } from './shared';
import { users, trips, segments, tripShares } from '$lib/server/db/mongrelSchema';
import { eq } from '@mongreldb/kit';

test('loadTripFor gives owner full segments and shared viewer projection', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const reader = db.insert(users).values({ email: 'r@x.c', passwordHash: 'x', displayName: 'R' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'UA1',
			startAt: '2026-07-01T12:00:00Z',
			startTz: 'UTC',
			confirmationNumber: 'CONF123',
			detailsJson: '{"seat":"12A"}'
		})
		.run();

	const ownerView = loadTripFor(owner.id, t.id);
	expect(ownerView.owner).toBe(true);
	expect(ownerView.editor).toBe(true);
	if (!ownerView.editor) throw new Error('unreachable');
	expect(ownerView.segments[0].confirmationNumber).toBe('CONF123');

	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: reader.id }).run();
	const readerView = loadTripFor(reader.id, t.id) as { owner: false; editor: false; trip: { segments: unknown[] } };
	expect(readerView.owner).toBe(false);
	expect(readerView.editor).toBe(false);
	const readerJson = JSON.stringify(readerView.trip);
	expect(readerJson).not.toContain('CONF123');
	expect(readerJson).not.toContain('12A');
});

test('loadTripFor includes confirmation numbers and details when showDetails is enabled', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'do@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const reader = db.insert(users).values({ email: 'dr@x.c', passwordHash: 'x', displayName: 'R' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'UA1',
			startAt: '2026-07-01T12:00:00Z',
			startTz: 'UTC',
			confirmationNumber: 'CONF123',
			detailsJson: '{"seat":"12A"}'
		})
		.run();

	const share = db
		.insert(tripShares)
		.values({ tripId: t.id, sharedWithUserId: reader.id, showDetails: true })
		.returning()
		.get();

	const readerView = loadTripFor(reader.id, t.id) as { owner: false; editor: false; trip: { segments: unknown[] } };
	const readerJson = JSON.stringify(readerView.trip);
	expect(readerJson).toContain('CONF123');
	expect(readerJson).toContain('12A');

	db.update(tripShares).set({ showDetails: false }).where(eq(tripShares.id, BigInt(share.id))).run();
	const hiddenView = loadTripFor(reader.id, t.id) as { owner: false; editor: false; trip: { segments: unknown[] } };
	const hiddenJson = JSON.stringify(hiddenView.trip);
	expect(hiddenJson).not.toContain('CONF123');
	expect(hiddenJson).not.toContain('12A');
});
