import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions } from './+page.server';
import { users, trips, segments } from '$lib/server/db/mongrelSchema';
import { eq } from '@mongreldb/kit';
import { makeLocals } from '../../../../tests/eventHelpers';
import * as usersRepo from '$lib/server/repositories/usersRepo';

function makeTestUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

function makeEvent(file: File, format = 'json', userId = 1) {
	const f = new FormData();
	f.append('file', file);
	f.append('format', format);
	return {
		request: new Request('http://localhost/trips/import', { method: 'POST', body: f }),
		params: {},
		locals: makeLocals({ id: userId }),
		url: new URL('http://localhost/trips/import')
	} as any;
}

test('imports a valid JSON file', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser('a@x.c');
	const json = JSON.stringify({
		trips: [
			{
				name: 'Imported Trip',
				destinationCountryCode: 'FR',
				destinationCityName: 'Paris',
				destinationCityLat: 48.8566,
				destinationCityLng: 2.3522,
				startDate: '2026-09-01',
				endDate: '2026-09-10',
				segments: [{ type: 'flight', title: 'Out', localStart: '2026-09-01T08:00', startTz: 'UTC' }]
			}
		]
	});
	const file = new File([json], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'json', Number(u.id)))) as {
		success: boolean;
		result: { imported: number; segmentCount: number; errors: unknown[] };
	};
	expect(result.success).toBe(true);
	expect(result.result.imported).toBe(1);
	expect(result.result.segmentCount).toBe(1);
	const t = db.select().from(trips).where(eq(trips.owner_id, BigInt(u.id))).get();
	expect(t!.name).toBe('Imported Trip');
	expect(db.select().from(segments).where(eq(segments.trip_id, BigInt(t!.id))).all()).toHaveLength(1);
});

test('imports a valid CSV file', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser('b@x.c');
	const csv =
		'name,destinationCountryCode,destinationCityName,destinationCityLat,destinationCityLng,startDate,endDate,segmentType,segmentTitle,segmentLocalStart,segmentStartTz\n' +
		'CSV Trip,IT,Rome,41.9028,12.4964,2026-10-01,2026-10-05,flight,Out,2026-10-01T09:00,UTC';
	const file = new File([csv], 'trips.csv', { type: 'text/csv' });
	const result = (await actions.default(makeEvent(file, 'csv', Number(u.id)))) as {
		success: boolean;
		result: { imported: number; segmentCount: number };
	};
	expect(result.success).toBe(true);
	expect(result.result.imported).toBe(1);
	expect(result.result.segmentCount).toBe(1);
});

test('rejects missing file', async () => {
	const f = new FormData();
	f.append('format', 'json');
	const result = (await actions.default({
		request: new Request('http://localhost/trips/import', { method: 'POST', body: f }),
		params: {},
		locals: makeLocals({ id: 1 }),
		url: new URL('http://localhost/trips/import')
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('select a file');
});

test('rejects malformed JSON', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser('c@x.c');
	const file = new File(['not json'], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'json', Number(u.id)))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('JSON');
});

test('rejects invalid format parameter', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser('d@x.c');
	const file = new File(['{}'], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'xml', Number(u.id)))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('Format must be');
});
