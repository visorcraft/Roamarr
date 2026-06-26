import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions } from './+page.server';
import { users, trips, segments } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { makeLocals } from '../../../../tests/eventHelpers';

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
	const u = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const json = JSON.stringify({
		trips: [
			{
				name: 'Imported Trip',
				destination: 'Paris',
				startDate: '2026-09-01',
				endDate: '2026-09-10',
				segments: [{ type: 'flight', title: 'Out', localStart: '2026-09-01T08:00', startTz: 'UTC' }]
			}
		]
	});
	const file = new File([json], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'json', u.id))) as {
		success: boolean;
		result: { imported: number; segmentCount: number; errors: unknown[] };
	};
	expect(result.success).toBe(true);
	expect(result.result.imported).toBe(1);
	expect(result.result.segmentCount).toBe(1);
	const t = db.select().from(trips).where(eq(trips.ownerId, u.id)).get();
	expect(t!.name).toBe('Imported Trip');
	expect(db.select().from(segments).where(eq(segments.tripId, t!.id)).all()).toHaveLength(1);
});

test('imports a valid CSV file', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const csv =
		'name,destination,startDate,endDate,segmentType,segmentTitle,segmentLocalStart,segmentStartTz\n' +
		'CSV Trip,Rome,2026-10-01,2026-10-05,flight,Out,2026-10-01T09:00,UTC';
	const file = new File([csv], 'trips.csv', { type: 'text/csv' });
	const result = (await actions.default(makeEvent(file, 'csv', u.id))) as {
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
	const u = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();
	const file = new File(['not json'], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'json', u.id))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('JSON');
});

test('rejects invalid format parameter', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'd@x.c', passwordHash: 'x', displayName: 'D' }).returning().get();
	const file = new File(['{}'], 'trips.json', { type: 'application/json' });
	const result = (await actions.default(makeEvent(file, 'xml', u.id))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('Format must be');
});
