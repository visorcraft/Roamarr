import { test, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import type { RequestEvent } from '@sveltejs/kit';
import type { AppUser } from './auth';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
vi.mock('$lib/server/actions', () => ({ withTripAction: vi.fn() }));

import { kit } from '$lib/server/db';
import { withTripAction } from '$lib/server/actions';
import {
	customReminder,
	segmentReminder,
	toggleArchive,
	toggleFavorite,
	saveTripTemplateAction
} from './tripMetaActions';
import { makeUser, makeTrip, makeSegment } from '../../../tests/helpers';
import * as tripsRepo from './repositories/tripsRepo';
import * as templatesRepo from './repositories/templatesRepo';
import { listRemindersForUser } from './repositories/remindersRepo';
import { getSegmentById } from './repositories/segmentsRepo';
import { users, trips, segments, reminders, tripTemplates, auditLogs } from './db/mongrelSchema';

const mockWithTripAction = vi.mocked(withTripAction);

const START_DATE = '2031-06-15';

function event(tripId: number) {
	return {
		params: { id: String(tripId) },
		url: new URL(`http://localhost/trips/${tripId}`),
		cookies: { set: vi.fn() }
	} as unknown as RequestEvent;
}

function makeForm(entries: [string, string | File][]) {
	const form = new FormData();
	for (const [key, value] of entries) form.set(key, value);
	return form;
}

function resolveAction(user: { id: number }, tripId: number, formData: FormData) {
	mockWithTripAction.mockResolvedValue({ user: user as unknown as AppUser, tripId, formData } as never);
}

function expectedFireAt(startAt: string, offsetMinutes: number) {
	return DateTime.fromISO(startAt, { zone: 'utc' }).toUTC().minus({ minutes: offsetMinutes }).toISO();
}

function fireAtInstant(row: { fireAt: string }) {
	return DateTime.fromISO(row.fireAt, { zone: 'utc' }).toUTC().toISO();
}

beforeEach(() => {
	mockWithTripAction.mockReset();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(tripTemplates).executeSync();
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('customReminder defaults to 60 minutes before start when the field is absent', async () => {
	const u = makeUser(kit, { email: 'cr-absent@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	resolveAction(u, t.id, makeForm([]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const rows = listRemindersForUser(u.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].kind).toBe('custom');
	expect(rows[0].refType).toBe('trip');
	expect(rows[0].refId).toBe(t.id);
	expect(fireAtInstant(rows[0])).toBe(expectedFireAt(`${START_DATE}T09:00:00Z`, 60));
});

test('customReminder defaults to 60 minutes before start for a blank field', async () => {
	const u = makeUser(kit, { email: 'cr-blank@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	resolveAction(u, t.id, makeForm([['offsetMinutes', '']]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const rows = listRemindersForUser(u.id);
	expect(rows).toHaveLength(1);
	expect(fireAtInstant(rows[0])).toBe(expectedFireAt(`${START_DATE}T09:00:00Z`, 60));
});

test('customReminder defaults to 60 minutes before start for a whitespace-only field', async () => {
	const u = makeUser(kit, { email: 'cr-ws@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	resolveAction(u, t.id, makeForm([['offsetMinutes', '  ']]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const rows = listRemindersForUser(u.id);
	expect(rows).toHaveLength(1);
	expect(fireAtInstant(rows[0])).toBe(expectedFireAt(`${START_DATE}T09:00:00Z`, 60));
});

test('customReminder arms exactly 15 minutes before start', async () => {
	const u = makeUser(kit, { email: 'cr-15@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	resolveAction(u, t.id, makeForm([['offsetMinutes', '15']]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const rows = listRemindersForUser(u.id);
	expect(rows).toHaveLength(1);
	expect(fireAtInstant(rows[0])).toBe(expectedFireAt(`${START_DATE}T09:00:00Z`, 15));
});

test('customReminder arms at the start instant for a 0 offset', async () => {
	const u = makeUser(kit, { email: 'cr-0@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	resolveAction(u, t.id, makeForm([['offsetMinutes', '0']]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const rows = listRemindersForUser(u.id);
	expect(rows).toHaveLength(1);
	expect(fireAtInstant(rows[0])).toBe(expectedFireAt(`${START_DATE}T09:00:00Z`, 0));
});

test.each(['-5', 'abc', '1.5', '1e3', '0x10', '1000000000'])(
	'customReminder rejects %s with a 400 and creates no reminder',
	async (value) => {
		const u = makeUser(kit, { email: `cr-bad-${value}@x.c`, passwordHash: 'x', displayName: 'U' });
		const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
		resolveAction(u, t.id, makeForm([['offsetMinutes', value]]));
		await expect(customReminder(event(t.id))).rejects.toMatchObject({ status: 400 });
		expect(listRemindersForUser(u.id)).toHaveLength(0);
	}
);

test('customReminder rejects a File posted to offsetMinutes', async () => {
	const u = makeUser(kit, { email: 'cr-file@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	resolveAction(u, t.id, makeForm([['offsetMinutes', new File(['x'], 'offset.txt')]]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({ status: 400 });
	expect(listRemindersForUser(u.id)).toHaveLength(0);
});

test('customReminder rejects a caller who is not the owner', async () => {
	const owner = makeUser(kit, { email: 'cr-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'cr-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T', startDate: START_DATE });
	resolveAction(other, t.id, makeForm([]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({ status: 404 });
	expect(listRemindersForUser(other.id)).toHaveLength(0);
	expect(listRemindersForUser(owner.id)).toHaveLength(0);
});

test('customReminder rejects a trip with no start date', async () => {
	const u = makeUser(kit, { email: 'cr-nostart@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	resolveAction(u, t.id, makeForm([]));
	await expect(customReminder(event(t.id))).rejects.toMatchObject({ status: 400 });
	expect(listRemindersForUser(u.id)).toHaveLength(0);
});

test('segmentReminder defaults a blank offset to 60 minutes before the segment start', async () => {
	const u = makeUser(kit, { email: 'sr-blank@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	const seg = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'UA1',
		startAt: `${START_DATE}T09:00:00.000Z`,
		startTz: 'UTC'
	});
	resolveAction(u, t.id, makeForm([['segmentId', String(seg.id)], ['offsetMinutes', '']]));
	await expect(segmentReminder(event(t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const rows = listRemindersForUser(u.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].kind).toBe('custom');
	expect(rows[0].refType).toBe('segment');
	expect(rows[0].refId).toBe(seg.id);
	const stored = getSegmentById(seg.id)!;
	expect(fireAtInstant(rows[0])).toBe(expectedFireAt(stored.startAt, 60));
});

test('segmentReminder rejects a negative offset and creates no reminder', async () => {
	const u = makeUser(kit, { email: 'sr-neg@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: START_DATE });
	const seg = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'UA1',
		startAt: `${START_DATE}T09:00:00.000Z`,
		startTz: 'UTC'
	});
	resolveAction(u, t.id, makeForm([['segmentId', String(seg.id)], ['offsetMinutes', '-1']]));
	await expect(segmentReminder(event(t.id))).rejects.toMatchObject({ status: 400 });
	expect(listRemindersForUser(u.id)).toHaveLength(0);
});

test('toggleArchive and toggleFavorite flip and back', async () => {
	const u = makeUser(kit, { email: 'tg-flip@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	resolveAction(u, t.id, new FormData());
	await expect(toggleArchive(event(t.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(tripsRepo.getTripById(t.id)?.archived).toBe(true);
	await expect(toggleArchive(event(t.id))).rejects.toMatchObject({ status: 303 });
	expect(tripsRepo.getTripById(t.id)?.archived).toBe(false);
	await expect(toggleFavorite(event(t.id))).rejects.toMatchObject({ status: 303 });
	expect(tripsRepo.getTripById(t.id)?.favorite).toBe(true);
	await expect(toggleFavorite(event(t.id))).rejects.toMatchObject({ status: 303 });
	expect(tripsRepo.getTripById(t.id)?.favorite).toBe(false);
});

test('toggleArchive and toggleFavorite reject a non-owner', async () => {
	const owner = makeUser(kit, { email: 'tg-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'tg-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	resolveAction(other, t.id, new FormData());
	await expect(toggleArchive(event(t.id))).rejects.toMatchObject({ status: 404 });
	await expect(toggleFavorite(event(t.id))).rejects.toMatchObject({ status: 404 });
	expect(tripsRepo.getTripById(t.id)?.archived).toBe(false);
	expect(tripsRepo.getTripById(t.id)?.favorite).toBe(false);
});

test('saveTripTemplateAction rejects a whitespace-only name', async () => {
	const u = makeUser(kit, { email: 'st-ws@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	resolveAction(u, t.id, makeForm([['name', '   ']]));
	await expect(saveTripTemplateAction(event(t.id))).rejects.toMatchObject({ status: 400 });
	expect(templatesRepo.listTripTemplates(u.id)).toHaveLength(0);
});
