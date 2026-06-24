import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { createTrip, regenerateCalendarToken } from '../../../shared';
import { users, segments } from '$lib/server/db/schema';

function event(params: { id: string }, search: string) {
	return {
		locals: { user: null },
		params,
		url: new URL(`http://localhost/trips/${params.id}/calendar/feed${search}`),
		request: new Request('http://localhost')
	} as any;
}

test('returns a public .ics feed for a valid token', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'feed-owner@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = createTrip(a.id, { name: 'Feed Trip', destination: 'Tokyo', startDate: '2026-09-01' });
	const token = regenerateCalendarToken(a.id, t.id);
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'JL1',
			startAt: '2026-09-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-09-01T18:00:00Z',
			location: 'NRT',
			confirmationNumber: 'FEED-CONF'
		})
		.run();

	const res = await GET(event({ id: String(t.id) }, `?token=${encodeURIComponent(token)}`));
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toContain('text/calendar');
	const body = await res.text();
	expect(body).toContain('BEGIN:VCALENDAR');
	expect(body).toContain('SUMMARY:Flight: JL1');
	expect(body).toContain('DTSTART:20260901T100000Z');
	expect(body).toContain('DTEND:20260901T180000Z');
	expect(body).toContain('LOCATION:NRT');
});

test('does not leak private fields in the feed', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'feed-private@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = createTrip(a.id, {
		name: 'Private Feed Trip',
		destination: 'Berlin',
		startDate: '2026-10-01',
		notes: 'SECRET TRIP NOTES'
	});
	const token = regenerateCalendarToken(a.id, t.id);
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'lodging',
			title: 'Hotel',
			startAt: '2026-10-01T16:00:00Z',
			startTz: 'UTC',
			location: 'Mitte',
			confirmationNumber: 'CONF-LEAK'
		})
		.run();

	const res = await GET(event({ id: String(t.id) }, `?token=${encodeURIComponent(token)}`));
	const body = await res.text();
	expect(body).toContain('SUMMARY:Lodging: Hotel');
	expect(body).not.toContain('SECRET TRIP NOTES');
	expect(body).not.toContain('CONF-LEAK');
});

test('missing token returns 404', async () => {
	try {
		await GET(event({ id: '1' }, ''));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('wrong token returns 404', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'feed-wrong@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = createTrip(a.id, { name: 'Wrong Token Trip' });
	regenerateCalendarToken(a.id, t.id);

	try {
		await GET(event({ id: String(t.id) }, '?token=not-the-token'));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('valid token for a different trip returns 404', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'feed-mismatch@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t1 = createTrip(a.id, { name: 'Trip One' });
	const t2 = createTrip(a.id, { name: 'Trip Two' });
	const token = regenerateCalendarToken(a.id, t1.id);

	try {
		await GET(event({ id: String(t2.id) }, `?token=${encodeURIComponent(token)}`));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});
