import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { loadTripFor } from './shared';
import { tripShares } from '$lib/server/db/mongrelSchema';
import { eq, type KitDatabase } from '@mongreldb/kit';
import { makeUser, makeTrip, makeSegment, makeShare } from '../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

test('loadTripFor gives owner full segments and shared viewer projection', () => {
	const kit = kitDb();
	const owner = makeUser(kit, { email: 'o@x.c', displayName: 'O' });
	const reader = makeUser(kit, { email: 'r@x.c', displayName: 'R' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	makeSegment(kit, t.id, {
		type: 'flight',
		title: 'UA1',
		startAt: '2026-07-01T12:00:00Z',
		confirmationNumber: 'CONF123',
		detailsJson: '{"seat":"12A"}'
	});

	const ownerView = loadTripFor(owner.id, t.id);
	expect(ownerView.owner).toBe(true);
	expect(ownerView.editor).toBe(true);
	if (!ownerView.editor) throw new Error('unreachable');
	expect(ownerView.segments[0].confirmationNumber).toBe('CONF123');

	makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id });
	const readerView = loadTripFor(reader.id, t.id) as { owner: false; editor: false; trip: { segments: unknown[] } };
	expect(readerView.owner).toBe(false);
	expect(readerView.editor).toBe(false);
	const readerJson = JSON.stringify(readerView.trip);
	expect(readerJson).not.toContain('CONF123');
	expect(readerJson).not.toContain('12A');
});

test('loadTripFor includes confirmation numbers and details when showDetails is enabled', () => {
	const kit = kitDb();
	const owner = makeUser(kit, { email: 'do@x.c', displayName: 'O' });
	const reader = makeUser(kit, { email: 'dr@x.c', displayName: 'R' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	makeSegment(kit, t.id, {
		type: 'flight',
		title: 'UA1',
		startAt: '2026-07-01T12:00:00Z',
		confirmationNumber: 'CONF123',
		detailsJson: '{"seat":"12A"}'
	});

	const share = makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id, showDetails: true });

	const readerView = loadTripFor(reader.id, t.id) as { owner: false; editor: false; trip: { segments: unknown[] } };
	const readerJson = JSON.stringify(readerView.trip);
	expect(readerJson).toContain('CONF123');
	expect(readerJson).toContain('12A');

	kit.updateTable(tripShares).set({ show_details: false }).where(eq(tripShares.id, BigInt(share.id))).executeSync();
	const hiddenView = loadTripFor(reader.id, t.id) as { owner: false; editor: false; trip: { segments: unknown[] } };
	const hiddenJson = JSON.stringify(hiddenView.trip);
	expect(hiddenJson).not.toContain('CONF123');
	expect(hiddenJson).not.toContain('12A');
});
