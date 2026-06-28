import { test, expect, vi, beforeEach } from 'vitest';
import { eq } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from './db';

import { makeUser, makeTrip, makeSegment, makeReminder, makeTravelDocument } from '../../../tests/helpers';

const delivered = vi.hoisted(() => [] as Array<{ uid: number; m: any }>);
vi.mock('./notify', () => ({
	deliver: async (uid: number, m: any) => delivered.push({ uid, m })
}));

import {
	upsertRemindersForSegment,
	upsertRemindersForDocument,
	upsertCustomReminder,
	cancelRemindersFor,
	listRemindersForUser,
	cancelReminder,
	runDueReminders
} from './reminders';
import { users, trips, segments, reminders } from './db/mongrelSchema';

let owner: any;
let trip: any;

beforeEach(() => {
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
	delivered.length = 0;
	owner = makeUser(kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	trip = makeTrip(kit, owner.id, { name: 'T' });
});

test('arms a pending reminder 24h before a future flight', () => {
	const seg = makeSegment(kit, trip.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2099-01-02T00:00:00.000Z',
			startTz: 'UTC'
		});
	upsertRemindersForSegment(seg as any);
	const r = kit.selectFrom(reminders).executeSync()[0];
	expect(r!.fire_at).toBe('2099-01-01T00:00:00.000Z');
	expect(r!.status).toBe('pending');
});

test('atomic run delivers due, marks sent, no double-deliver on re-run', async () => {
	const seg = makeSegment(kit, trip.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2000-01-02T00:00:00.000Z',
			startTz: 'UTC'
		});
	upsertRemindersForSegment(seg as any);
	kit.updateTable(reminders).set({ status: 'pending' }).executeSync();
	await runDueReminders(new Date('2000-02-01T00:00:00Z'));
	await runDueReminders(new Date('2000-02-01T00:00:00Z'));
	expect(delivered.length).toBe(1);
	expect(kit.selectFrom(reminders).executeSync()[0]!.status).toBe('sent');
});

test('reclaims a reminder orphaned in "sending" by a prior crash', async () => {
	const seg = makeSegment(kit, trip.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2000-01-02T00:00:00.000Z',
			startTz: 'UTC'
		});
	upsertRemindersForSegment(seg as any);
	// Simulate a crash mid-delivery: the row is stuck in 'sending', never sent.
	kit.updateTable(reminders).set({ status: 'sending' }).executeSync();
	await runDueReminders(new Date('2000-02-01T00:00:00Z'));
	expect(delivered.length).toBe(1);
	expect(kit.selectFrom(reminders).executeSync()[0]!.status).toBe('sent');
});

test('cancel removes the reminder', () => {
	const seg = makeSegment(kit, trip.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2099-01-02T00:00:00.000Z',
			startTz: 'UTC'
		});
	upsertRemindersForSegment(seg as any);
	cancelRemindersFor('segment', seg.id);
	expect(kit.selectFrom(reminders).executeSync().length).toBe(0);
});

test('non-flight segments do not arm reminders', () => {
	for (const type of ['hotel', 'rental_car', 'train', 'poi', 'boat'] as const) {
		const seg = makeSegment(kit, trip.id, {
				type,
				title: type,
				startAt: '2099-01-02T00:00:00.000Z',
				startTz: 'UTC'
			});
		upsertRemindersForSegment(seg as any);
	}
	expect(kit.selectFrom(reminders).executeSync().length).toBe(0);
});

test('changing a flight to a non-flight cancels its reminder', () => {
	const seg = makeSegment(kit, trip.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2099-01-02T00:00:00.000Z',
			startTz: 'UTC'
		});
	upsertRemindersForSegment(seg as any);
	expect(kit.selectFrom(reminders).executeSync().length).toBe(1);

	const lodging = { ...seg, type: 'hotel' as const };
	upsertRemindersForSegment(lodging as any);
	expect(kit.selectFrom(reminders).executeSync().length).toBe(0);
});

test('arms a reminder using the owners configured flight check-in lead', () => {
	kit.updateTable(users)
		.set({ flight_checkin_lead_hours: BigInt(48) })
		.where(eq(users.id, BigInt(owner.id)))
		.executeSync();
	const seg = makeSegment(kit, trip.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2099-01-02T00:00:00.000Z',
			startTz: 'UTC'
		});
	upsertRemindersForSegment(seg as any);
	const r = kit.selectFrom(reminders).executeSync()[0];
	expect(r!.fire_at).toBe('2098-12-31T00:00:00.000Z');
});

test('arms a reminder using the owners configured document expiry lead', () => {
	kit.updateTable(users)
		.set({ timezone: 'America/New_York', document_expiry_lead_days: BigInt(30) })
		.where(eq(users.id, BigInt(owner.id)))
		.executeSync();
	const doc = makeTravelDocument(kit, owner.id, {
		type: 'passport',
		expiresOn: '2026-12-30'
	});
	upsertRemindersForDocument(doc as any);
	const r = kit.selectFrom(reminders).executeSync()[0];
	expect(r!.fire_at).toBe('2026-11-30T14:00:00.000Z');
});

test('custom reminder arms before a trip start', () => {
	const t = makeTrip(kit, owner.id, { name: 'Custom', startDate: '2099-06-01' });
	upsertCustomReminder(owner.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 1440);
	const rows = kit.selectFrom(reminders).where(eq(reminders.ref_type, 'trip')).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].kind).toBe('custom');
	expect(rows[0].fire_at).toBe('2099-05-31T09:00:00.000Z');
});


test('listRemindersForUser returns user reminders sorted by fireAt desc', () => {
	makeReminder(kit, {
			userId: owner.id,
			kind: 'custom',
			refType: 'trip',
			refId: 1,
			fireAt: '2026-01-02T00:00:00Z'
		});
	makeReminder(kit, {
			userId: owner.id,
			kind: 'custom',
			refType: 'trip',
			refId: 2,
			fireAt: '2026-01-01T00:00:00Z'
		});
	const list = listRemindersForUser(owner.id);
	expect(list.length).toBe(2);
	expect(list[0].fireAt).toBe('2026-01-02T00:00:00Z');
});

test('cancelReminder deletes only the users own reminder', () => {
	const other = makeUser(kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });
	const r1 = makeReminder(kit, {
			userId: owner.id,
			kind: 'custom',
			refType: 'trip',
			refId: 1,
			fireAt: '2026-01-01T00:00:00Z'
		});
	const r2 = makeReminder(kit, {
			userId: other.id,
			kind: 'custom',
			refType: 'trip',
			refId: 2,
			fireAt: '2026-01-01T00:00:00Z'
		});
	cancelReminder(owner.id, r1.id);
	expect(kit.selectFrom(reminders).where(eq(reminders.id, BigInt(r1.id))).executeSync()[0]).toBeUndefined();
	expect(kit.selectFrom(reminders).where(eq(reminders.id, BigInt(r2.id))).executeSync()[0]).toBeDefined();
	try {
		cancelReminder(owner.id, r2.id);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});


test('delivered notification copy is generic and links to documents for expiry', async () => {
	kit.updateTable(users)
		.set({ timezone: 'UTC', document_expiry_lead_days: BigInt(90) })
		.where(eq(users.id, BigInt(owner.id)))
		.executeSync();
	const doc = makeTravelDocument(kit, owner.id, { type: 'passport', expiresOn: '2000-01-01' });
	upsertRemindersForDocument(doc as any);
	kit.updateTable(reminders).set({ status: 'pending' }).executeSync();
	await runDueReminders(new Date('2000-02-01T00:00:00Z'));
	expect(delivered.length).toBe(1);
	expect(delivered[0].m.body).toBe('A travel document is expiring soon.');
	expect(delivered[0].m.link).toBe('/profile/documents');
});
