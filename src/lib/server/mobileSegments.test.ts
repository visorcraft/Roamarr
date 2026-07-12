import { expect, test, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => { const { freshDb } = await import('../../../tests/helpers'); Object.assign(ctx, freshDb()); return ctx; });

import { POST } from '../../routes/api/mobile/segments/+server';
import { GET, PATCH } from '../../routes/api/mobile/segments/[id]/+server';
import { makeCard, makeUser } from '../../../tests/helpers';
import { makeCompanion } from '../../../tests/helpers';
import * as tripsRepo from './repositories/tripsRepo';
import { POST as setAttendee, GET as listAttendees } from '../../routes/api/mobile/segments/[id]/attendees/+server';

test('mobile segment API round-trips timezone, booking, payment, and details', async () => {
	const user = makeUser(ctx.kit, { timezone: 'America/Chicago' }), other = makeUser(ctx.kit), trip = tripsRepo.createTrip(user.id, { name: 'Detailed' }), card = makeCard(ctx.kit, user.id, { nickname: 'Trip', network: 'visa' });
	const response = await POST({ locals: { user }, request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ tripId: trip.id, type: 'flight', title: 'Flight 1', localStart: '2026-08-01T10:00', startTz: 'America/Chicago', endAt: '2026-08-01T12:00', endTz: 'America/Chicago', confirmationNumber: 'ABC123', cardId: card.id, paymentStatus: 'fully_paid', details: { departAirport: 'ORD', arriveAirport: 'LAX' } }) }) } as any);
	expect(response.status).toBe(201); const created = (await response.json()).segment;
	expect(created.startAt).toContain('15:00:00');
	const read = await GET({ params: { id: String(created.id) }, locals: { user } } as any); const body = await read.json();
	expect(body.segment).toMatchObject({ localStart: expect.stringContaining('10:00:00'), confirmationNumber: 'ABC123', cardId: card.id });
	expect(JSON.parse(body.segment.detailsJson)).toMatchObject({ departAirport: 'ORD' });
	tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: other.id, permission: 'read', showDetails: false });
	const limited = await GET({ params: { id: String(created.id) }, locals: { user: other } } as any);
	expect(await limited.json()).toMatchObject({ segment: { id: created.id, title: 'Flight 1' }, attendees: [] });
	expect((await (await GET({ params: { id: String(created.id) }, locals: { user: other } } as any)).json()).segment.confirmationNumber).toBeUndefined();
	tripsRepo.updateShare(tripsRepo.listSharesForTrip(trip.id)[0].id, { showDetails: true });
	expect((await (await GET({ params: { id: String(created.id) }, locals: { user: other } } as any)).json()).segment.confirmationNumber).toBe('ABC123');
	const updated = await PATCH({ params: { id: String(created.id) }, locals: { user }, request: new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ title: 'Updated flight' }) }) } as any);
	expect((await updated.json()).segment.title).toBe('Updated flight');
	const companion = makeCompanion(ctx.kit, trip.id, { name: 'Alex' });
	await setAttendee({ params: { id: String(created.id) }, locals: { user }, request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ companionId: companion.id, status: 'going' }) }) } as any);
	const attendeeList = await listAttendees({ params: { id: String(created.id) }, locals: { user } } as any);
	expect((await attendeeList.json()).rows).toMatchObject([{ companionId: companion.id, status: 'going' }]);
});
