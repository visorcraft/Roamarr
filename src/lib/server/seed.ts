import { sql } from 'drizzle-orm';
import { ne as kitNe } from '@mongreldb/kit';
import { db, kit } from './db';
import {
	users,
	trips as drizzleTrips,
	tripComments as drizzleTripComments,
	tripShares as drizzleTripShares,
	segments,
	cards,
	insurancePolicies,
	loyaltyPrograms
} from './db/schema';
import { trips, tripShares, tripComments } from './db/mongrelSchema';
import * as tripsRepo from './repositories/tripsRepo';
import * as usersRepo from './repositories/usersRepo';

function kitId(id: number): bigint {
	return BigInt(id);
}

export function seedDemoData(adminId: number) {
	// Clean legacy tables.
	db.delete(drizzleTripComments).run();
	db.delete(drizzleTripShares).run();
	db.delete(segments).run();
	db.delete(drizzleTrips).where(sql`${drizzleTrips.ownerId} != ${adminId}`).run();
	db.delete(cards).where(sql`${cards.userId} != ${adminId}`).run();
	db.delete(insurancePolicies).where(sql`${insurancePolicies.userId} != ${adminId}`).run();
	db.delete(loyaltyPrograms).where(sql`${loyaltyPrograms.userId} != ${adminId}`).run();
	db.delete(users).where(sql`${users.id} != ${adminId}`).run();

	// Clean kit tables.
	kit.deleteFrom(tripComments).executeSync();
	kit.deleteFrom(tripShares).executeSync();
	kit.deleteFrom(trips).where(kitNe(trips.owner_id, kitId(adminId))).executeSync();

	const demoUser = usersRepo.createUser({
		email: 'demo.traveler@example.com',
		password_hash: 'disabled-demo-account',
		display_name: 'Demo Traveler',
		calendar_token: null,
		calendar_token_expires_at: null
	});

	const t1 = tripsRepo.createTrip(adminId, {
		name: 'Demo Trip to Tokyo',
		destinationCountryCode: 'JP',
		destinationCityName: 'Tokyo',
		destinationCityLat: 35.6762,
		destinationCityLng: 139.6503,
		startDate: '2026-09-15',
		endDate: '2026-09-22',
		notes: 'A sample walking-skeleton trip.',
		tags: JSON.stringify(['demo', 'asia'])
	});

	db.insert(segments).values([
		{
			tripId: t1.id,
			type: 'flight',
			title: 'JL outbound',
			startAt: '2026-09-15T08:00:00Z',
			startTz: 'UTC',
			endAt: '2026-09-15T16:00:00Z',
			location: 'NRT'
		},
		{
			tripId: t1.id,
			type: 'hotel',
			title: 'Shinjuku Hotel',
			startAt: '2026-09-15T17:00:00Z',
			startTz: 'Asia/Tokyo',
			endAt: '2026-09-22T10:00:00Z',
			location: 'Shinjuku, Tokyo'
		},
		{
			tripId: t1.id,
			type: 'food',
			title: 'Tsukiji lunch',
			startAt: '2026-09-16T12:00:00Z',
			startTz: 'Asia/Tokyo',
			location: 'Tsukiji'
		}
	]).run();

	const t2 = tripsRepo.createTrip(Number(demoUser.id), {
		name: 'Shared demo trip',
		destinationCountryCode: 'FR',
		destinationCityName: 'Paris',
		destinationCityLat: 48.8566,
		destinationCityLng: 2.3522,
		startDate: '2026-10-01',
		endDate: '2026-10-05',
		tags: JSON.stringify(['demo', 'europe'])
	});

	tripsRepo.createShare({
		tripId: t2.id,
		sharedWithUserId: adminId,
		permission: 'read'
	});

	db.insert(cards).values({
		userId: adminId,
		nickname: 'Travel Card',
		network: 'visa',
		last4: '4242',
		notes: 'Demo card'
	}).run();

	db.insert(insurancePolicies).values({
		userId: adminId,
		provider: 'Demo Insurer',
		policyNumber: 'DEMO-123',
		coverageSummary: 'Trip cancellation',
		coverageAmount: 5000,
		currency: 'USD',
		startDate: '2026-01-01',
		endDate: '2026-12-31'
	}).run();

	db.insert(loyaltyPrograms).values({
		userId: adminId,
		programName: 'Demo Air',
		membershipNumber: 'DA12345',
		balance: 5000
	}).run();

	return { demoUser, trips: [t1, t2] };
}
