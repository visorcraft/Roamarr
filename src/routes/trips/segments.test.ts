import { and, eq } from '@visorcraft/mongreldb-kit';
import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeTrip, makeCard, makeShare } from '../../../tests/helpers';


import { actions } from './[id]/segments/+page.server';
import { addSegment, updateSegment } from '$lib/server/segments';
import { newSegmentPage } from '$lib/server/segmentNewPage';
import { users, trips, cards, segments, reminders, tripShares, geonamesCities } from '$lib/server/db/mongrelSchema';
import { actions as tripActions } from './[id]/+page.server';
import { makeLocals, makeFormData } from '../../../tests/eventHelpers';

beforeEach(() => {
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(tripShares).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(cards).executeSync();
	kit.deleteFrom(users).executeSync();
	kit.deleteFrom(geonamesCities).executeSync();
});

test('flight start_at is stored as a UTC instant; foreign card rejected', () => {
	const a = makeUser(kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const bCard = makeCard(kit, b.id, { nickname: 'B', network: 'visa' });
	addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	expect(kit.selectFrom(segments).executeSync()[0]!.start_at).toBe('2026-07-01T19:00:00.000Z');
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
	const a = makeUser(kit, { email: 'update-a@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	const initialReminder = kit
		.selectFrom(reminders)
		.where(and(eq(reminders.ref_type, 'segment'), eq(reminders.ref_id, BigInt(seg.id))))
		.executeSync()[0];
	expect(initialReminder).toBeTruthy();
	expect(initialReminder!.fire_at).toBe('2026-06-30T19:00:00.000Z');

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

	const rearmed = kit
		.selectFrom(reminders)
		.where(and(eq(reminders.ref_type, 'segment'), eq(reminders.ref_id, BigInt(seg.id))))
		.executeSync()[0];
	expect(rearmed).toBeTruthy();
	expect(rearmed!.fire_at).toBe('2026-07-01T14:00:00.000Z');
});

test('update segment is ownership-checked', () => {
	const a = makeUser(kit, { email: 'owner-a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'owner-b@x.c', passwordHash: 'x', displayName: 'B' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const otherTrip = makeTrip(kit, b.id, { name: 'O' });
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
	const a = makeUser(kit, { email: 'extra-a@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });

	for (const type of ['hotel', 'rental_car', 'train', 'boat'] as const) {
		const seg = addSegment(a.id, t.id, {
			type,
			title: `${type} segment`,
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC'
		});
		expect(seg.type).toBe(type);
	}

	const reminderCount = kit
		.selectFrom(reminders)
		.selectCount()
		.where(eq(reminders.ref_type, 'segment'))
		.executeSync();
	expect(reminderCount).toBe(0n);
});

const addSegmentAction = newSegmentPage('flight').actions.default;
const rentalCarAddAction = newSegmentPage('rental_car').actions.default;

function makeAddEvent(
	form: FormData,
	params: Record<string, string>,
	userId: number,
	type = 'flight'
) {
	return {
		request: new Request(`http://localhost/trips/${params.id}/segments/new/${type}`, {
			method: 'POST',
			body: form
		}),
		params,
		locals: makeLocals({ id: userId }),
		url: new URL(`http://localhost/trips/${params.id}/segments/new/${type}`)
	} as any;
}

function makeEvent(form: FormData, params: Record<string, string>, userId: number) {
	return {
		request: new Request('http://localhost/trips/1/segments', { method: 'POST', body: form }),
		params,
		locals: makeLocals({ id: userId }),
		url: new URL(`http://localhost/trips/${params.id}/segments`)
	} as any;
}

test('add action validates required fields and timezone', async () => {
	const a = makeUser(kit, { email: 'act-a@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });

	const form = makeFormData({
		title: '',
		localStart: 'not-a-datetime',
		startTz: 'Mars/Colony'
	});
	const result = (await addSegmentAction!(makeAddEvent(form, { id: String(t.id) }, a.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.title).toBe('title is required');
	expect(result.data.errors.localStart).toBe('localStart must be a valid datetime');
	expect(result.data.errors.startTz).toBe('startTz must be a valid IANA timezone');
	expect(kit.selectFrom(segments).executeSync()).toHaveLength(0);
});

test('add action creates a segment with valid data', async () => {
	const a = makeUser(kit, { email: 'act-b@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const form = makeFormData({
		title: 'UA1',
		localStart: '2026-07-01T15:00',
		startTz: 'America/New_York'
	});
	await expect(addSegmentAction!(makeAddEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(kit.selectFrom(segments).executeSync()).toHaveLength(1);
});

test('add action stores endTz and converts endAt to UTC', async () => {
	const a = makeUser(kit, { email: 'act-endtz@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const form = makeFormData({
		title: 'UA1',
		localStart: '2026-07-01T08:00',
		startTz: 'America/New_York',
		endDate: '2026-07-01',
		endTime: '16:00',
		endTz: 'Asia/Tokyo'
	});
	await expect(addSegmentAction!(makeAddEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const seg = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync()[0]!;
	expect(seg.start_at).toBe('2026-07-01T12:00:00.000Z');
	expect(seg.start_tz).toBe('America/New_York');
	expect(seg.end_at).toBe('2026-07-01T07:00:00.000Z');
	expect(seg.end_tz).toBe('Asia/Tokyo');
});

test('delete action validates segmentId', async () => {
	const a = makeUser(kit, { email: 'act-c@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const form = makeFormData({ segmentId: 'abc' });
	const result = (await actions.delete(makeEvent(form, { id: String(t.id) }, a.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.segmentId).toBe('segmentId must be a positive integer');
});

test('update action validates segmentId and required fields', async () => {
	const a = makeUser(kit, { email: 'act-d@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});
	const form = makeFormData({
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

test('update action stores country, city, and venue', async () => {
	const a = makeUser(kit, { email: 'city@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	kit.insertInto(geonamesCities)
		.values({ geoname_id: 1n, name: 'Paris', ascii_name: 'Paris', country_code: 'FR', lat: 48.85, lng: 2.35 })
		.executeSync();

	const seg = addSegment(a.id, t.id, {
		type: 'hotel',
		title: 'H',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});

	const form = makeFormData({
		segmentId: String(seg.id),
		title: 'H',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC',
		countryCode: 'FR',
		cityName: 'Paris',
		cityLat: '48.85',
		cityLng: '2.35',
		venue: 'Grand Hotel'
	});

	await expect(actions.update(makeEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]!;
	expect(row.country_code).toBe('FR');
	expect(row.city_name).toBe('Paris');
	expect(row.city_lat).toBe(48.85);
	expect(row.venue).toBe('Grand Hotel');
});

test('shared editor can add, update and delete segments; read-only viewer cannot', async () => {
	const owner = makeUser(kit, { email: 'seg-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const editor = makeUser(kit, { email: 'seg-editor@x.c', passwordHash: 'x', displayName: 'E' });
	const reader = makeUser(kit, { email: 'seg-reader@x.c', passwordHash: 'x', displayName: 'R' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	makeShare(kit, { tripId: t.id, sharedWithUserId: editor.id, permission: 'edit' });
	makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id, permission: 'read' });

	const addForm = makeFormData({
		title: 'UA1',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC'
	});
	await expect(addSegmentAction!(makeAddEvent(addForm, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const seg = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync()[0]!;
	expect(seg.title).toBe('UA1');

	await expect(addSegmentAction!(makeAddEvent(addForm, { id: String(t.id) }, reader.id))).rejects.toMatchObject({
		status: 404
	});

	const updateForm = makeFormData({
		segmentId: String(seg.id),
		title: 'UA1 Updated',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC'
	});
	await expect(actions.update(makeEvent(updateForm, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]!.title).toBe('UA1 Updated');

	const deleteForm = makeFormData({ segmentId: String(seg.id) });
	await expect(actions.delete(makeEvent(deleteForm, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]).toBeUndefined();
});


test('add and update actions store meeting point and rally time', async () => {
	const a = makeUser(kit, { email: 'meet-act@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });

	const addForm = makeFormData({
		title: 'Coffee',
		localStart: '2026-07-01T10:00',
		startTz: 'America/New_York',
		meetingPoint: 'Hotel lobby',
		meetingAt: '2026-07-01T09:30'
	});
	const addPage = newSegmentPage('meetup').actions.default;
	await expect(addPage!(makeAddEvent(addForm, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	let seg = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync()[0]!;
	expect(seg.meeting_point).toBe('Hotel lobby');
	expect(seg.meeting_at).toBe('2026-07-01T13:30:00.000Z');

	const updateForm = makeFormData({
		segmentId: String(seg.id),
		title: 'Coffee',
		localStart: '2026-07-01T10:00',
		startTz: 'America/New_York',
		meetingPoint: 'Lobby entrance',
		meetingAt: '2026-07-01T09:45'
	});
	await expect(actions.update(makeEvent(updateForm, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	seg = kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]!;
	expect(seg.meeting_point).toBe('Lobby entrance');
	expect(seg.meeting_at).toBe('2026-07-01T13:45:00.000Z');
});

test('flight add action stores meeting point and rally time', async () => {
	const a = makeUser(kit, { email: 'flight-meet@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });

	const form = makeFormData({
		title: 'UA1',
		localStart: '2026-07-01T10:00',
		startTz: 'America/New_York',
		meetingPoint: 'Gate A12',
		meetingAt: '2026-07-01T09:30'
	});
	await expect(addSegmentAction!(makeAddEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const seg = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync()[0]!;
	expect(seg.type).toBe('flight');
	expect(seg.meeting_point).toBe('Gate A12');
	expect(seg.meeting_at).toBe('2026-07-01T13:30:00.000Z');
});

test('rental_car add action stores meeting point and rally time', async () => {
	const a = makeUser(kit, { email: 'car-meet@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });

	const form = makeFormData({
		title: 'Hertz',
		localStart: '2026-07-01T10:00',
		startTz: 'America/New_York',
		meetingPoint: 'Rental counter',
		meetingAt: '2026-07-01T09:30'
	});
	await expect(
		rentalCarAddAction!(makeAddEvent(form, { id: String(t.id) }, a.id, 'rental_car'))
	).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const seg = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync()[0]!;
	expect(seg.type).toBe('rental_car');
	expect(seg.meeting_point).toBe('Rental counter');
	expect(seg.meeting_at).toBe('2026-07-01T13:30:00.000Z');
});

test('update action attaches an owned card and rejects a foreign card', async () => {
	const a = makeUser(kit, { email: 'card-a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'card-b@x.c', passwordHash: 'x', displayName: 'B' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});
	const aCard = makeCard(kit, a.id, { nickname: 'A', network: 'visa' });
	const bCard = makeCard(kit, b.id, { nickname: 'B', network: 'mc' });

	const okForm = makeFormData({
		segmentId: String(seg.id),
		title: 'UA1',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC',
		cardId: String(aCard.id)
	});
	await expect(actions.update(makeEvent(okForm, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(Number(kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]!.card_id)).toBe(aCard.id);

	const badForm = makeFormData({
		segmentId: String(seg.id),
		title: 'UA1',
		localStart: '2026-07-01T15:00',
		startTz: 'UTC',
		cardId: String(bCard.id)
	});
	await expect(actions.update(makeEvent(badForm, { id: String(t.id) }, a.id))).rejects.toThrow();
});

function makeTripEvent(user: { id: number }, body: FormData, tripId: number) {
	return {
		request: { formData: async () => body } as Request,
		params: { id: String(tripId) },
		locals: { user } as App.Locals,
		url: new URL(`http://localhost/trips/${tripId}`)
	} as any;
}

test('segmentReminder action creates a custom reminder for a segment', async () => {
	const a = makeUser(kit, { email: 'rem-a@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T' });
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});
	const body = makeFormData({ segmentId: String(seg.id), offsetMinutes: '60' });
	await expect(tripActions.segmentReminder(makeTripEvent(a, body, t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const rem = kit
		.selectFrom(reminders)
		.where(and(eq(reminders.ref_type, 'segment'), eq(reminders.ref_id, BigInt(seg.id)), eq(reminders.kind, 'custom')))
		.executeSync()[0];
	expect(rem).toBeTruthy();
	expect(rem!.fire_at).toBe('2026-07-01T14:00:00.000Z');
});
