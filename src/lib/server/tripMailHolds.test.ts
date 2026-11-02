import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { addMailHold, addNextMailHold, deleteMailHold, listMailHolds, mailHoldCoverageForTrip, updateMailHold } from './tripMailHolds';
import { runDueReminders } from './reminders';
import { notifications, reminders, tripMailHolds, trips, users } from './db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import { makeSyncedTrip, makeSyncedUser } from '../../../tests/helpers';
import { deleteTrip } from './repositories/tripsRepo';
import { mergeTrips } from './tripMerge';
import { GET as calendarFeed } from '../../routes/trips/[id]/calendar/feed/+server';

function getKit() {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(notifications).executeSync();
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(tripMailHolds).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

function seed() {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'owner@x.c', timezone: 'UTC' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'Away', startDate: '2026-08-01', endDate: '2026-08-20' });
	const other = makeSyncedUser(kit, { email: 'other@x.c' });
	return { kit, u, t, other };
}

test('addMailHold stores the hold and arms an end reminder', () => {
	const { kit, u, t } = seed();
	const { hold, warning } = addMailHold(u.id, t.id, {
		carrier: 'USPS',
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		confirmationNumber: 'HOLDSECRET',
		addressLabel: 'HOMEADDR',
		status: 'requested'
	});
	expect(warning).toBeNull();
	expect(hold.carrier).toBe('USPS');
	expect(hold.confirmationNumber).toBe('HOLDSECRET');
	const reminder = kit.selectFrom(reminders).where(eq(reminders.ref_type, 'mail_hold')).executeSync()[0];
	expect(reminder.kind).toBe('mail_hold');
	expect(reminder.fire_at.startsWith('2026-08-07T09:00:00')).toBe(true);
});

test('a USPS hold longer than 30 days warns and still saves', () => {
	const { u, t } = seed();
	const { hold, warning } = addMailHold(u.id, t.id, {
		startDate: '2026-08-01',
		endDate: '2026-09-15'
	});
	expect(hold.id).toBeGreaterThan(0);
	expect(warning).toMatch(/30 days/);
});

test('end before start is rejected', () => {
	const { u, t } = seed();
	try {
		addMailHold(u.id, t.id, { startDate: '2026-08-10', endDate: '2026-08-01' });
		expect.fail('expected a validation error');
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string }; message?: string };
		expect(err.status).toBe(400);
		expect(err.body?.message ?? err.message).toMatch(/endDate/);
	}
});

test('cancelling, rescheduling, and deleting the hold updates the reminder', async () => {
	const { kit, u, t } = seed();
	const { hold } = addMailHold(u.id, t.id, {
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		confirmationNumber: 'HOLDSECRET',
		addressLabel: 'HOMEADDR'
	});
	const moved = updateMailHold(u.id, t.id, hold.id, { endDate: '2026-08-12' });
	expect(moved.hold.endDate).toBe('2026-08-12');
	expect(kit.selectFrom(reminders).executeSync()[0].fire_at.startsWith('2026-08-09T09:00:00')).toBe(true);

	updateMailHold(u.id, t.id, hold.id, { status: 'cancelled' });
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(0);

	const again = addMailHold(u.id, t.id, {
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		confirmationNumber: 'HOLDSECRET'
	});
	kit.updateTable(reminders).set({ fire_at: '2020-01-01T00:00:00.000Z', status: 'pending' }).executeSync();
	await runDueReminders(new Date('2026-11-01T00:00:00Z'));
	const note = kit.selectFrom(notifications).executeSync()[0];
	expect(note.title).toBe('Mail hold ending');
	expect(note.body).not.toContain('HOLDSECRET');
	expect(note.link).toBe(`/trips/${t.id}`);

	deleteMailHold(u.id, t.id, again.hold.id);
	expect(kit.selectFrom(reminders).where(eq(reminders.ref_id, BigInt(again.hold.id))).executeSync()).toHaveLength(0);
	const remaining = kit.selectFrom(tripMailHolds).executeSync();
	expect(remaining.map((row) => Number(row.id))).toEqual([hold.id]);
	expect(remaining[0].status).toBe('cancelled');
});

test('next hold continues for 30 days with the same carrier and address', () => {
	const { u, t } = seed();
	const { hold } = addMailHold(u.id, t.id, {
		carrier: 'Local post',
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		addressLabel: 'Cabin'
	});
	const next = addNextMailHold(u.id, t.id, hold.id);
	expect(next.hold).toMatchObject({
		carrier: 'Local post',
		startDate: '2026-08-11',
		endDate: '2026-09-09',
		addressLabel: 'Cabin',
		status: 'requested',
		confirmationNumber: null
	});
});

test('coverage uses the trip dates and skips cancelled holds', () => {
	const { u, t } = seed();
	addMailHold(u.id, t.id, { startDate: '2026-08-01', endDate: '2026-08-05', status: 'active' });
	addMailHold(u.id, t.id, { startDate: '2026-08-06', endDate: '2026-08-20', status: 'cancelled' });
	const report = mailHoldCoverageForTrip(t.startDate, t.endDate, listMailHolds(t.id));
	expect(report.uncoveredDays[0]).toBe('2026-08-06');
	expect(report.uncoveredDays).not.toContain('2026-08-01');
});

test('another user cannot change mail holds', () => {
	const { u, t, other } = seed();
	const { hold } = addMailHold(u.id, t.id, { startDate: '2026-08-01', endDate: '2026-08-05' });
	expect(() => addMailHold(other.id, t.id, { startDate: '2026-08-01', endDate: '2026-08-02' })).toThrow();
	expect(() => updateMailHold(other.id, t.id, hold.id, { notes: 'nope' })).toThrow();
	expect(() => deleteMailHold(other.id, t.id, hold.id)).toThrow();
});

test('deleting the trip removes its mail-hold reminder', () => {
	const { kit, u, t } = seed();
	addMailHold(u.id, t.id, { startDate: '2026-08-01', endDate: '2026-08-05' });
	deleteTrip(t.id);
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(0);
	expect(kit.selectFrom(tripMailHolds).executeSync()).toHaveLength(0);
});

test('merging trips keeps the mail hold on the recipient', () => {
	const { kit, u, t } = seed();
	const recipient = makeSyncedTrip(kit, { ownerId: u.id, name: 'Kept', startDate: '2026-08-01', endDate: '2026-08-20' });
	const { hold } = addMailHold(u.id, t.id, { startDate: '2026-08-01', endDate: '2026-08-05' });
	mergeTrips(u.id, t.id, recipient.id);
	const row = kit.selectFrom(tripMailHolds).where(eq(tripMailHolds.id, BigInt(hold.id))).executeSync()[0];
	expect(Number(row.trip_id)).toBe(recipient.id);
});

test('calendar feed does not include mail-hold details', async () => {
	const { u, t } = seed();
	addMailHold(u.id, t.id, {
		startDate: '2026-08-01',
		endDate: '2026-08-05',
		confirmationNumber: 'HOLDSECRET',
		addressLabel: 'HOMEADDR'
	});
	const response = await calendarFeed({
		params: { id: String(t.id) },
		url: new URL(`http://localhost/trips/${t.id}/calendar/feed?token=${t.calendarToken}`),
		getClientAddress: () => '203.0.113.10'
	} as never);
	expect(response.status).toBe(200);
	const body = await response.text();
	expect(body).not.toContain('HOLDSECRET');
	expect(body).not.toContain('HOMEADDR');
});
