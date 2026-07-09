import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions } from './+page.server';
import { trips, segments } from '$lib/server/db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeLocals } from '../../../../tests/eventHelpers';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { checkRateLimit, resetRateLimit } from '$lib/server/rateLimit';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeTestUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

beforeEach(() => {
	resetRateLimit();
});

function makeEvent(file: File, format = 'json', userId = 1, ip = '127.0.0.1') {
	const f = new FormData();
	f.append('file', file);
	f.append('format', format);
	return {
		request: new Request('http://localhost/trips/import', { method: 'POST', body: f }),
		params: {},
		locals: makeLocals({ id: userId }),
		url: new URL('http://localhost/trips/import'),
		getClientAddress: () => ip
	} as any;
}

test('imports a valid JSON file', async () => {
	const kit = kitDb();
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
	const t = kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync()[0];
	expect(t!.name).toBe('Imported Trip');
	expect(kit.selectFrom(segments).where(eq(segments.trip_id, t!.id)).executeSync()).toHaveLength(1);
});

test('imports a valid CSV file', async () => {
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
		url: new URL('http://localhost/trips/import'),
		getClientAddress: () => '127.0.0.1'
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('select a file');
});

test('rejects oversized import files', async () => {
	const u = makeTestUser('large@x.c');
	const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'trips.json', {
		type: 'application/json'
	});
	const result = (await actions.default(makeEvent(file, 'json', Number(u.id)))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('5 MB');
});

test('rate limits imports before parsing the upload', async () => {
	const ip = '8.8.8.8';
	for (let i = 0; i < 5; i++) {
		checkRateLimit(ip, 'trips:import', { maxAttempts: 5, windowMs: 60_000 });
	}
	const u = makeTestUser('limited@x.c');
	const file = new File(['{"trips":[]}'], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'json', Number(u.id), ip))) as {
		status: number;
		data: { error: string; retryAfter?: number };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});

test('rejects malformed JSON', async () => {
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
	const u = makeTestUser('d@x.c');
	const file = new File(['{}'], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'xml', Number(u.id)))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('Format must be');
});
