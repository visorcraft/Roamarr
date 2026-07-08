import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

beforeEach(() => {
	ctx.kit.deleteFrom(reminders).executeSync();
	ctx.kit.deleteFrom(travelDocuments).executeSync();
	ctx.kit.deleteFrom(tripCompanions).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

import { GET } from './+server';
import { travelDocuments, trips, tripCompanions, users, reminders } from '$lib/server/db/mongrelSchema';
import { makeUser, makeCompanion } from '../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';
import { addDocument } from '$lib/server/travelDocuments';
import { createTrip } from '$lib/server/repositories/tripsRepo';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated documents for the signed-in user', async () => {
	const user = makeUser(ctx.kit);
	addDocument(user.id, { type: 'passport', expiresOn: '2030-01-01', number: 'P1' });
	addDocument(user.id, { type: 'visa', expiresOn: '2027-01-01', number: 'V1' });

	const res = await GET(makeEvent('/api/travel-documents', user));
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.total).toBe(2);
	expect(body.rows).toHaveLength(2);
	expect(body.rows.some((r: any) => r.type === 'passport')).toBe(true);
});

test('does not expose other users documents', async () => {
	const a = makeUser(ctx.kit);
	const b = makeUser(ctx.kit, { email: 'b@x.c' });
	addDocument(a.id, { type: 'passport' });

	const res = await GET(makeEvent('/api/travel-documents', b));
	const body = await res.json();
	expect(body.total).toBe(0);
	expect(body.rows).toEqual([]);
});

test('rejects unauthenticated request', async () => {
	await expect(GET(makeEvent('/api/travel-documents', null))).rejects.toMatchObject({ status: 401 });
});

test('filters by date range on expires_on', async () => {
	const user = makeUser(ctx.kit);
	addDocument(user.id, { type: 'passport', expiresOn: '2025-12-15' });
	addDocument(user.id, { type: 'visa', expiresOn: '2027-06-01' });
	addDocument(user.id, { type: 'global_entry', expiresOn: '2029-10-01' });
	addDocument(user.id, { type: 'drivers_license' }); // no expiry — excluded by date filter

	const resFrom = await GET(makeEvent('/api/travel-documents?from=2027-01-01', user));
	const bodyFrom = await resFrom.json();
	expect(bodyFrom.total).toBe(2);
	expect(bodyFrom.rows.map((r: any) => r.type).sort()).toEqual(['global_entry', 'visa']);

	const resTo = await GET(makeEvent('/api/travel-documents?to=2026-01-01', user));
	const bodyTo = await resTo.json();
	expect(bodyTo.total).toBe(1);
	expect(bodyTo.rows[0].type).toBe('passport');

	const resRange = await GET(makeEvent('/api/travel-documents?from=2027-01-01&to=2028-12-31', user));
	const bodyRange = await resRange.json();
	expect(bodyRange.total).toBe(1);
	expect(bodyRange.rows[0].type).toBe('visa');
});

test('resolves companion names', async () => {
	const user = makeUser(ctx.kit);
	const trip = createTrip(user.id, { name: 'Tokyo' });
	const companion = makeCompanion(ctx.kit, trip.id, { name: 'Sam' });
	addDocument(user.id, { type: 'passport', companionId: companion.id });

	const res = await GET(makeEvent('/api/travel-documents', user));
	const body = await res.json();
	expect(body.rows[0].companionName).toContain('Sam');
	expect(body.rows[0].companionName).toContain('Tokyo');
});

test('search filters by type and issuing authority', async () => {
	const user = makeUser(ctx.kit);
	addDocument(user.id, { type: 'passport', issuingAuthority: 'US State Dept' });
	addDocument(user.id, { type: 'visa', issuingAuthority: 'Italian Consulate' });

	const res = await GET(makeEvent('/api/travel-documents?search=italian', user));
	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].type).toBe('visa');
});

test('rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	addDocument(user.id, { type: 'passport' });
	for (let i = 0; i < 10; i++) {
		const res = await GET(makeEvent('/api/travel-documents', user));
		expect(res.status).toBe(200);
	}
	await expect(GET(makeEvent('/api/travel-documents', user))).rejects.toMatchObject({ status: 429 });
});
