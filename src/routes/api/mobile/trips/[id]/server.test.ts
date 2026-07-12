import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => { const { freshDb } = await import('../../../../../../tests/helpers'); Object.assign(ctx, freshDb()); return ctx; });

import { GET } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { makeKitUser } from '../../../../../../tests/kitHelpers';
import { createShare, createTrip } from '$lib/server/repositories/tripsRepo';
import { createSegment } from '$lib/server/repositories/segmentsRepo';

test('native trip detail gives editors metadata while preserving viewer privacy', async () => {
	const ownerRow = makeKitUser({ email: 'owner@example.com', display_name: 'Owner' }), viewerRow = makeKitUser({ email: 'viewer@example.com', display_name: 'Viewer' });
	const owner = validateOAuthUser(Number(ownerRow.id))!, viewer = validateOAuthUser(Number(viewerRow.id))!;
	const trip = createTrip(owner.id, { name: 'Private', notes: 'owner-only notes', tags: '["summer"]' });
	createSegment({ trip_id: BigInt(trip.id), type: 'flight', title: 'Flight', start_at: '2026-01-01T10:00:00Z', start_tz: 'UTC', confirmation_number: 'SECRET' });
	const owned = await GET({ locals: { user: owner }, params: { id: String(trip.id) } } as any) as Response;
	expect(await owned.json()).toMatchObject({ trip: { notes: 'owner-only notes', tags: ['summer'], canEdit: true, owner: true, segments: [{ id: expect.any(Number), title: 'Flight' }] } });
	createShare({ tripId: trip.id, sharedWithUserId: viewer.id, permission: 'read', showDetails: false });
	const shared = await GET({ locals: { user: viewer }, params: { id: String(trip.id) } } as any) as Response;
	const body = await shared.json();
	expect(body.trip).toMatchObject({ canEdit: false, owner: false });
	expect(body.trip.notes).toBeUndefined();
	expect(JSON.stringify(body)).not.toContain('SECRET');
});
