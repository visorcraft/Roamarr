import { expect, test, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => { const { freshDb } = await import('../../../tests/helpers'); Object.assign(ctx, freshDb()); return ctx; });

import { POST as loyalty } from '../../routes/api/loyalty/+server';
import { POST as insurance } from '../../routes/api/insurance/+server';
import { POST as document } from '../../routes/api/travel-documents/+server';
import { makeCompanion, makeUser } from '../../../tests/helpers';
import * as tripsRepo from './repositories/tripsRepo';

const event = (user: unknown, body: Record<string, unknown>) => ({ locals: { user }, request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }) } as any);

test('full mobile wallet APIs persist depth fields and owned links', async () => {
	const user = makeUser(ctx.kit), trip = tripsRepo.createTrip(user.id, { name: 'Covered' }), companion = makeCompanion(ctx.kit, trip.id, { name: 'Traveler' });
	const loyaltyResponse = await loyalty(event(user, { programName: 'Miles', membershipNumber: 'ABC', balance: 1200, notes: 'Gold' }));
	expect((await loyaltyResponse.json()).program).toMatchObject({ membershipNumber: 'ABC', balance: 1200, notes: 'Gold' });
	const insuranceResponse = await insurance(event(user, { provider: 'Cover', policyNumber: 'POL', coverageSummary: 'Medical', coverageAmount: 50000, currency: 'USD', tripId: trip.id, startDate: '2026-08-01', endDate: '2026-08-10', notes: 'Call first' }));
	expect((await insuranceResponse.json()).policy).toMatchObject({ tripId: trip.id, coverageAmount: 50000, notes: 'Call first' });
	const documentResponse = await document(event(user, { type: 'passport', number: 'P123', issuingAuthority: 'USA', expiresOn: '2030-01-01', companionId: companion.id, notes: 'Renew early' }));
	expect((await documentResponse.json()).document).toMatchObject({ companionId: companion.id, issuingAuthority: 'USA', notes: 'Renew early' });
});
