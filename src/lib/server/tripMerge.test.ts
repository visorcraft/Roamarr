import { beforeEach, expect, test, vi } from 'vitest';

const context = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(context, freshDb());
	return context;
});

import { mergeTrips } from './tripMerge';
import { currentTripRev, publishTripChanged } from './eventBus';
import {
	attachments, galleryImages, segments, tripCompanions, tripDocuments, tripDocumentLinks,
	tripDayNotes, tripExpenses, tripInvitations, trips
} from './db/mongrelSchema';
import { and, eq } from '@visorcraft/mongreldb-kit';
import { makeExpense, makeSegment, makeTrip, makeUser } from '../../../tests/helpers';
import type { Insert, KitDatabase } from '@visorcraft/mongreldb-kit';

const db = () => (context as { kit: KitDatabase }).kit;

function makeAttachment(ownerId: number, key: string) {
	return db().insertInto(attachments).values({
		owner_id: BigInt(ownerId),
		storage_key: key,
		filename: `${key}.pdf`,
		content_type: 'application/pdf',
		size_bytes: 100n,
		context: '{}'
	} as Insert<typeof attachments>).executeSync();
}

function makeSelfCompanion(tripId: number, userId: number, name: string) {
	return db().insertInto(tripCompanions).values({
		trip_id: BigInt(tripId),
		user_id: BigInt(userId),
		name,
		category: 'adult'
	} as Insert<typeof tripCompanions>).executeSync();
}

function parseSplit(row: { split_among: unknown }): Array<string | number> {
	const raw = row.split_among as unknown;
	return Array.isArray(raw) ? raw as Array<string | number> : JSON.parse(raw as string);
}

beforeEach(() => {
	db().deleteFrom(trips).executeSync();
});

test('merge moves itinerary, documents, expenses, widens dates, and deletes donor', () => {
	const user = makeUser(db(), { email: 'merge@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Correct', startDate: '2027-06-05', endDate: '2027-06-07', notes: 'keep' });
	const donor = makeTrip(db(), user.id, { name: 'Donor', startDate: '2027-06-01', endDate: '2027-06-10', notes: 'move' });
	makeSegment(db(), donor.id, { title: 'Flight' });
	db().insertInto(tripDocumentLinks).values({ trip_id: BigInt(donor.id), label: 'Voucher', url: 'https://example.com' } as Insert<typeof tripDocumentLinks>).executeSync();
	db().insertInto(tripExpenses).values({ trip_id: BigInt(donor.id), description: 'Hotel', amount: 10000n } as Insert<typeof tripExpenses>).executeSync();

	mergeTrips(user.id, donor.id, recipient.id);

	expect(db().selectFrom(trips).where(eq(trips.id, BigInt(donor.id))).executeSync()).toHaveLength(0);
	expect(db().selectFrom(segments).where(eq(segments.trip_id, BigInt(recipient.id))).executeSync()).toHaveLength(1);
	expect(db().selectFrom(tripDocumentLinks).where(eq(tripDocumentLinks.trip_id, BigInt(recipient.id))).executeSync()).toHaveLength(1);
	expect(db().selectFrom(tripExpenses).where(eq(tripExpenses.trip_id, BigInt(recipient.id))).executeSync()).toHaveLength(1);
	const merged = db().selectFrom(trips).where(eq(trips.id, BigInt(recipient.id))).executeSync()[0]!;
	expect([merged.start_date, merged.end_date, merged.notes]).toEqual(['2027-06-01', '2027-06-10', 'keep\n\nmove']);
});

test('moveCompanionReferences remaps and dedupes split_among on donor expenses only', () => {
	const user = makeUser(db(), { email: 'split@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Recipient' });
	const donor = makeTrip(db(), user.id, { name: 'Donor' });
	const third = makeTrip(db(), user.id, { name: 'Third' });

	const recipientCompanion = makeSelfCompanion(recipient.id, user.id, 'Self');
	const donorCompanion = makeSelfCompanion(donor.id, user.id, 'Self');

	const donorExpense = makeExpense(db(), {
		tripId: donor.id,
		description: 'Donor expense',
		amount: 5000,
		paidByCompanionId: Number(donorCompanion.id),
		splitAmong: [Number(donorCompanion.id), Number(recipientCompanion.id)]
	});
	const thirdExpense = makeExpense(db(), {
		tripId: third.id,
		description: 'Unrelated expense',
		amount: 7000,
		splitAmong: [Number(donorCompanion.id), 999]
	});

	mergeTrips(user.id, donor.id, recipient.id);

	const [movedExpense] = db().selectFrom(tripExpenses).where(eq(tripExpenses.id, BigInt(donorExpense.id))).executeSync();
	expect(Number(movedExpense.trip_id)).toBe(recipient.id);
	expect(Number(movedExpense.paid_by_companion_id)).toBe(Number(recipientCompanion.id));
	expect(parseSplit(movedExpense)).toEqual([Number(recipientCompanion.id)]);

	const [untouchedExpense] = db().selectFrom(tripExpenses).where(eq(tripExpenses.id, BigInt(thirdExpense.id))).executeSync();
	expect(Number(untouchedExpense.trip_id)).toBe(third.id);
	expect(parseSplit(untouchedExpense)).toEqual([Number(donorCompanion.id), 999]);
	expect(Number(untouchedExpense.paid_by_companion_id ?? 0)).toBe(0);
});

test('tripDocuments move to the recipient trip', () => {
	const user = makeUser(db(), { email: 'docs@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Recipient' });
	const donor = makeTrip(db(), user.id, { name: 'Donor' });

	const att = makeAttachment(user.id, 'docs-1');
	db().insertInto(tripDocuments).values({
		trip_id: BigInt(donor.id),
		segment_id: null,
		attachment_id: att.id,
		label: 'Boarding pass',
		notes: null
	} as Insert<typeof tripDocuments>).executeSync();

	mergeTrips(user.id, donor.id, recipient.id);

	const rows = db().selectFrom(tripDocuments).where(eq(tripDocuments.trip_id, BigInt(recipient.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(Number(rows[0].attachment_id)).toBe(Number(att.id));
	expect(rows[0].label).toBe('Boarding pass');
	expect(db().selectFrom(tripDocuments).where(eq(tripDocuments.trip_id, BigInt(donor.id))).executeSync()).toHaveLength(0);
});

test('galleryImages trip-owned rows move with shifted sort_order while place rows stay untouched', () => {
	const user = makeUser(db(), { email: 'gallery@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Recipient' });
	const donor = makeTrip(db(), user.id, { name: 'Donor' });

	const r1 = makeAttachment(user.id, 'gallery-r1');
	const r2 = makeAttachment(user.id, 'gallery-r2');
	const d1 = makeAttachment(user.id, 'gallery-d1');
	const place1 = makeAttachment(user.id, 'gallery-place1');

	db().insertInto(galleryImages).values({ owner_type: 'trip', owner_id: BigInt(recipient.id), attachment_id: r1.id, caption: 'r1', sort_order: 0n } as Insert<typeof galleryImages>).executeSync();
	db().insertInto(galleryImages).values({ owner_type: 'trip', owner_id: BigInt(recipient.id), attachment_id: r2.id, caption: 'r2', sort_order: 1n } as Insert<typeof galleryImages>).executeSync();
	const donorGallery = db().insertInto(galleryImages).values({ owner_type: 'trip', owner_id: BigInt(donor.id), attachment_id: d1.id, caption: 'donor', sort_order: 0n } as Insert<typeof galleryImages>).executeSync();
	db().insertInto(galleryImages).values({ owner_type: 'place', owner_id: BigInt(donor.id), attachment_id: place1.id, caption: 'place', sort_order: 0n } as Insert<typeof galleryImages>).executeSync();

	mergeTrips(user.id, donor.id, recipient.id);

	const recipientRows = db().selectFrom(galleryImages).where(and(eq(galleryImages.owner_type, 'trip'), eq(galleryImages.owner_id, BigInt(recipient.id)))).executeSync();
	expect(recipientRows).toHaveLength(3);
	const donorRow = recipientRows.find((row) => Number(row.attachment_id) === Number(d1.id));
	expect(donorRow).toBeDefined();
	expect(Number(donorRow!.sort_order)).toBe(2);
	const sorts = recipientRows.map((row) => Number(row.sort_order)).sort((a, b) => a - b);
	expect(sorts).toEqual([0, 1, 2]);

	const placeRows = db().selectFrom(galleryImages).where(eq(galleryImages.owner_type, 'place')).executeSync();
	expect(placeRows).toHaveLength(1);
	expect(Number(placeRows[0].owner_id)).toBe(donor.id);
	expect(Number(placeRows[0].sort_order)).toBe(0);
	expect(Number(placeRows[0].attachment_id)).toBe(Number(place1.id));
	expect(db().selectFrom(galleryImages).where(eq(galleryImages.attachment_id, d1.id)).executeSync()[0]).toBeDefined();
});

test('tripDayNotes move to recipient, concatenating same-date notes without violating uniqueness', () => {
	const user = makeUser(db(), { email: 'daynotes@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Recipient' });
	const donor = makeTrip(db(), user.id, { name: 'Donor' });

	db().insertInto(tripDayNotes).values({ trip_id: BigInt(recipient.id), date: '2027-06-05', icon: 'star', body: 'existing' } as Insert<typeof tripDayNotes>).executeSync();
	db().insertInto(tripDayNotes).values({ trip_id: BigInt(donor.id), date: '2027-06-05', icon: 'heart', body: 'donor' } as Insert<typeof tripDayNotes>).executeSync();
	db().insertInto(tripDayNotes).values({ trip_id: BigInt(donor.id), date: '2027-06-06', icon: null, body: 'solo' } as Insert<typeof tripDayNotes>).executeSync();

	mergeTrips(user.id, donor.id, recipient.id);

	const rows = db().selectFrom(tripDayNotes).where(eq(tripDayNotes.trip_id, BigInt(recipient.id))).executeSync();
	expect(rows).toHaveLength(2);
	const byDate = new Map(rows.map((row) => [row.date as string, row]));
	expect(byDate.get('2027-06-05')!.body).toBe('existing\n\ndonor');
	expect(byDate.get('2027-06-05')!.icon).toBe('star');
	expect(byDate.get('2027-06-06')!.body).toBe('solo');
	expect(byDate.get('2027-06-06')!.icon).toBeNull();
	expect(db().selectFrom(tripDayNotes).where(eq(tripDayNotes.trip_id, BigInt(donor.id))).executeSync()).toHaveLength(0);
});

test('tripInvitations move to recipient, upgrading permission on email collision', () => {
	const user = makeUser(db(), { email: 'invites@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Recipient' });
	const donor = makeTrip(db(), user.id, { name: 'Donor' });

	db().insertInto(tripInvitations).values({ trip_id: BigInt(recipient.id), invited_by_user_id: BigInt(user.id), email: 'shared@example.com', permission: 'read', token_hash: 'hash-existing', expires_at: '2027-07-01T00:00:00.000Z' } as Insert<typeof tripInvitations>).executeSync();
	db().insertInto(tripInvitations).values({ trip_id: BigInt(donor.id), invited_by_user_id: BigInt(user.id), email: 'shared@example.com', permission: 'edit', token_hash: 'hash-donor', expires_at: '2027-07-01T00:00:00.000Z' } as Insert<typeof tripInvitations>).executeSync();
	db().insertInto(tripInvitations).values({ trip_id: BigInt(donor.id), invited_by_user_id: BigInt(user.id), email: 'distinct@example.com', permission: 'read', token_hash: 'hash-distinct', expires_at: '2027-07-01T00:00:00.000Z' } as Insert<typeof tripInvitations>).executeSync();

	mergeTrips(user.id, donor.id, recipient.id);

	const rows = db().selectFrom(tripInvitations).where(eq(tripInvitations.trip_id, BigInt(recipient.id))).executeSync();
	expect(rows).toHaveLength(2);
	const byEmail = new Map(rows.map((row) => [String(row.email).toLowerCase(), row]));
	expect(byEmail.get('shared@example.com')!.permission).toBe('edit');
	expect(byEmail.get('distinct@example.com')!.permission).toBe('read');
	expect(db().selectFrom(tripInvitations).where(eq(tripInvitations.trip_id, BigInt(donor.id))).executeSync()).toHaveLength(0);
});

test('merge clears the donor trip revision entry', () => {
	const user = makeUser(db(), { email: 'donor-rev@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Recipient' });
	const donor = makeTrip(db(), user.id, { name: 'Donor' });
	publishTripChanged(donor.id);
	publishTripChanged(donor.id);
	expect(currentTripRev(donor.id)).toBe(2);

	mergeTrips(user.id, donor.id, recipient.id);

	expect(currentTripRev(donor.id)).toBe(0);
	expect(currentTripRev(recipient.id)).toBeGreaterThan(0);
});

test('merge publishes live-event revision bump for the recipient trip', () => {
	const user = makeUser(db(), { email: 'events@example.com' });
	const recipient = makeTrip(db(), user.id, { name: 'Recipient' });
	const donor = makeTrip(db(), user.id, { name: 'Donor' });

	const before = currentTripRev(recipient.id);
	mergeTrips(user.id, donor.id, recipient.id);
	expect(currentTripRev(recipient.id)).toBeGreaterThan(before);
});
