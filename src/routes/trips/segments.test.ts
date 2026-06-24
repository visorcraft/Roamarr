import { and, eq, sql } from 'drizzle-orm';
import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	_addSegment as addSegment,
	_updateSegment as updateSegment,
	actions
} from './[id]/segments/+page.server';
import { users, trips, cards, segments, reminders, tripShares } from '$lib/server/db/schema';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from reminders; delete from trip_shares; delete from segments; delete from trips; delete from users; delete from cards;'
	);
});

test('flight start_at is stored as a UTC instant; foreign card rejected', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const bCard = db
		.insert(cards)
		.values({ userId: b.id, nickname: 'B', network: 'visa' })
		.returning()
		.get();
	addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	expect(db.select().from(segments).get()!.startAt).toBe('2026-07-01T19:00:00.000Z');
	expect(() =>
		addSegment(a.id, t.id, {
			type: 'flight',
			title: 'X',
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC',
			cardId: bCard.id
		})
	).toThrow();
});

test('update segment edits fields and re-arms reminders when flight time changes', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'update-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	const initialReminder = db
		.select()
		.from(reminders)
		.where(and(eq(reminders.refType, 'segment'), eq(reminders.refId, seg.id)))
		.get();
	expect(initialReminder).toBeTruthy();
	expect(initialReminder!.fireAt).toBe('2026-06-30T19:00:00.000Z');

	const updated = updateSegment(a.id, t.id, seg.id, {
		title: 'UA1 Rerouted',
		localStart: '2026-07-02T10:00:00',
		startTz: 'America/New_York',
		location: 'JFK → LHR',
		confirmationNumber: 'ABC789',
		details: { gate: 'A1' }
	});
	expect(updated.title).toBe('UA1 Rerouted');
	expect(updated.startAt).toBe('2026-07-02T14:00:00.000Z');
	expect(updated.location).toBe('JFK → LHR');
	expect(updated.confirmationNumber).toBe('ABC789');
	expect(updated.detailsJson).toBe('{"gate":"A1"}');

	const rearmed = db
		.select()
		.from(reminders)
		.where(and(eq(reminders.refType, 'segment'), eq(reminders.refId, seg.id)))
		.get();
	expect(rearmed).toBeTruthy();
	expect(rearmed!.fireAt).toBe('2026-07-01T14:00:00.000Z');
});

test('update segment is ownership-checked', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'owner-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'owner-b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const otherTrip = db.insert(trips).values({ ownerId: b.id, name: 'O' }).returning().get();
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});

	expect(() =>
		updateSegment(b.id, t.id, seg.id, {
			title: 'Hacked',
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC'
		})
	).toThrow();
	expect(() =>
		updateSegment(a.id, otherTrip.id, seg.id, {
			title: 'Hacked',
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC'
		})
	).toThrow();
});

test('extra segment types can be added and do not arm flight reminders', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'extra-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();

	for (const type of ['car', 'rail', 'activity', 'cruise'] as const) {
		const seg = addSegment(a.id, t.id, {
			type,
			title: `${type} segment`,
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC'
		});
		expect(seg.type).toBe(type);
	}

	const reminderCount = db
		.select({ count: sql`count(*)` })
		.from(reminders)
		.where(eq(reminders.refType, 'segment'))
		.get()!.count;
	expect(reminderCount).toBe(0);
});

function locals(user: { id: number }) {
	return { user } as App.Locals;
}

function formData(obj: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(obj)) f.append(k, v);
	return f;
}

function makeEvent(form: FormData, params: Record<string, string>, userId: number) {
	return {
		request: new Request('http://localhost/trips/1/segments', { method: 'POST', body: form }),
		params,
		locals: locals({ id: userId }),
		url: new URL(`http://localhost/trips/${params.id}/segments`)
	} as any;
}

test('add action validates required fields and timezone', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'act-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();

	const form = formData({
		type: 'flight',
		title: '',
		localStart: 'not-a-datetime',
		startTz: 'Mars/Colony'
	});
	const result = (await actions.add(makeEvent(form, { id: String(t.id) }, a.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.title).toBe('title is required');
	expect(result.data.errors.localStart).toBe('localStart must be a valid datetime');
	expect(result.data.errors.startTz).toBe('startTz must be a valid IANA timezone');
	expect(db.select().from(segments).all()).toHaveLength(0);
});

test('add action creates a segment with valid data', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'act-b@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const form = formData({
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00',
		startTz: 'America/New_York'
	});
	await expect(actions.add(makeEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(db.select().from(segments).all()).toHaveLength(1);
});

test('delete action validates segmentId', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'act-c@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const form = formData({ segmentId: 'abc' });
	const result = (await actions.delete(makeEvent(form, { id: String(t.id) }, a.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.segmentId).toBe('segmentId must be a positive integer');
});

test('update action validates segmentId and required fields', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'act-d@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});
	const form = formData({
		segmentId: String(seg.id),
		title: '',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC'
	});
	const result = (await actions.update(makeEvent(form, { id: String(t.id) }, a.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.title).toBe('title is required');
});

test('shared editor can add, update and delete segments; read-only viewer cannot', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'seg-owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const editor = db.insert(users).values({ email: 'seg-editor@x.c', passwordHash: 'x', displayName: 'E' }).returning().get();
	const reader = db.insert(users).values({ email: 'seg-reader@x.c', passwordHash: 'x', displayName: 'R' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit' }).run();
	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: reader.id, permission: 'read' }).run();

	const addForm = formData({
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC'
	});
	await expect(actions.add(makeEvent(addForm, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const seg = db.select().from(segments).where(eq(segments.tripId, t.id)).get()!;
	expect(seg.title).toBe('UA1');

	await expect(actions.add(makeEvent(addForm, { id: String(t.id) }, reader.id))).rejects.toMatchObject({
		status: 404
	});

	const updateForm = formData({
		segmentId: String(seg.id),
		title: 'UA1 Updated',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC'
	});
	await expect(actions.update(makeEvent(updateForm, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(db.select().from(segments).where(eq(segments.id, seg.id)).get()!.title).toBe('UA1 Updated');

	const deleteForm = formData({ segmentId: String(seg.id) });
	await expect(actions.delete(makeEvent(deleteForm, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(db.select().from(segments).where(eq(segments.id, seg.id)).get()).toBeUndefined();
});
