import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { places, placeCategories, placeLinks, users } from '$lib/server/db/mongrelSchema';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeLocals } from '../../../../tests/eventHelpers';
import { makeUser } from '../../../../tests/helpers';
import { checkRateLimit, resetRateLimit } from '$lib/server/rateLimit';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

let userId: number;

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(placeLinks).executeSync();
	kit.deleteFrom(places).executeSync();
	kit.deleteFrom(placeCategories).executeSync();
	kit.deleteFrom(users).executeSync();
	userId = makeUser(kit).id;
	resetRateLimit();
});

function event(form: FormData | null, id = userId, ip = '127.0.0.1') {
	return {
		locals: makeLocals({ id }),
		request: new Request('http://localhost/places/import', {
			method: 'POST',
			body: form ?? new FormData()
		}),
		url: new URL('http://localhost/places/import'),
		getClientAddress: () => ip
	} as any;
}

const CSV = [
	'Title,Note,URL,Comment',
	'"Eiffel Tower","note","https://www.google.com/maps/place/Eiffel+Tower/data=!3d48.8583!4d2.2945",'
].join('\n');

test('load requires a signed-in user', () => {
	const unauthenticated = {
		locals: { user: null },
		url: new URL('http://localhost/places/import')
	} as any;
	expect(() => load(unauthenticated)).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns the user categories for the bulk select', () => {
	const data = load(event(null)) as any;
	expect(data.categories.length).toBe(8);
});

test('preview parses an uploaded CSV and flags rows', async () => {
	const f = new FormData();
	f.append('file', new File([CSV], 'Saved.csv', { type: 'text/csv' }));
	const result = (await actions.preview(event(f))) as any;
	expect(result.format).toBe('takeout-csv');
	expect(result.preview).toHaveLength(1);
	expect(result.preview[0]).toMatchObject({
		name: 'Eiffel Tower',
		lat: 48.8583,
		lng: 2.2945,
		duplicate: false
	});
	expect(result.sourceName).toBe('Saved.csv');
});

test('preview accepts pasted Google Maps links instead of a file', async () => {
	const f = new FormData();
	f.set('urlList', 'https://www.google.com/maps/place/Colosseum/@41.8902,12.4922,17z');
	const result = (await actions.preview(event(f))) as any;
	expect(result.format).toBe('url-list');
	expect(result.preview[0]).toMatchObject({ name: 'Colosseum', lat: 41.8902 });
});

test('preview rejects requests without a file or links', async () => {
	const result = (await actions.preview(event(new FormData()))) as any;
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('Choose a file');
});

test('preview rejects oversized files', async () => {
	const f = new FormData();
	f.append('file', new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.csv'));
	const result = (await actions.preview(event(f))) as any;
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('20 MB');
});

test('preview rejects unparseable files with a clear error', async () => {
	const f = new FormData();
	f.append('file', new File(['{}'], 'places.geojson', { type: 'application/json' }));
	const result = (await actions.preview(event(f))) as any;
	expect(result.status).toBe(400);
	expect(result.data.error).toContain('FeatureCollection');
});

test('preview is rate limited', async () => {
	const ip = '8.8.8.8';
	for (let i = 0; i < 10; i++) {
		checkRateLimit(ip, 'places:import', { maxAttempts: 10, windowMs: 60_000 });
	}
	const f = new FormData();
	f.append('file', new File([CSV], 'Saved.csv'));
	const result = (await actions.preview(event(f, userId, ip))) as any;
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
});

test('confirm creates the submitted rows and skips duplicates by default', async () => {
	// Existing place makes the first row a duplicate.
	const { createPlace } = await import('$lib/server/places');
	createPlace(userId, { name: 'Eiffel Tower', lat: 48.8583, lng: 2.2945 });

	const f = new FormData();
	f.set(
		'rows',
		JSON.stringify([
			{ name: 'Eiffel Tower', lat: 48.8583, lng: 2.2945 },
			{ name: 'Colosseum', lat: 41.8902, lng: 12.4922 }
		])
	);
	const result = (await actions.confirm(event(f))) as any;
	expect(result.imported.created).toBe(1);
	expect(result.imported.skippedDuplicates).toBe(1);
	const rows = kitDb().selectFrom(places).executeSync();
	expect(rows).toHaveLength(2);
});

test('confirm applies a bulk category', async () => {
	const data = load(event(null)) as any;
	const categoryId = data.categories[0].id;
	const f = new FormData();
	f.set('rows', JSON.stringify([{ name: 'Categorized', lat: 1, lng: 2 }]));
	f.set('categoryId', String(categoryId));
	const result = (await actions.confirm(event(f))) as any;
	expect(result.imported.created).toBe(1);
	const row = kitDb().selectFrom(places).executeSync()[0]!;
	expect(Number(row.category_id)).toBe(categoryId);
});

test('confirm rejects malformed rows payloads', async () => {
	const f = new FormData();
	f.set('rows', 'not json');
	const result = (await actions.confirm(event(f))) as any;
	expect(result.status).toBe(400);

	const empty = new FormData();
	empty.set('rows', JSON.stringify([{ lat: 1, lng: 2 }]));
	const result2 = (await actions.confirm(event(empty))) as any;
	expect(result2.status).toBe(400);
});
