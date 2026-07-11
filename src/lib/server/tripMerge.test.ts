import { beforeEach, expect, test, vi } from 'vitest';

const context = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(context, freshDb());
	return context;
});

import { mergeTrips } from './tripMerge';
import { segments, tripDocumentLinks, tripExpenses, trips } from './db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import { makeSegment, makeTrip, makeUser } from '../../../tests/helpers';
import type { Insert, KitDatabase } from '@visorcraft/mongreldb-kit';

const db = () => (context as { kit: KitDatabase }).kit;

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
