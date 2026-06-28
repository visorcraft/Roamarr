import { sql } from 'drizzle-orm';
import { db } from './db';
import {
	users,
	trips,
	segments,
	cards,
	insurancePolicies,
	loyaltyPrograms,
	tripShares,
	tripComments
} from './db/schema';

export function seedDemoData(adminId: number) {
	db.delete(tripComments).run();
	db.delete(tripShares).run();
	db.delete(segments).run();
	db.delete(trips).where(sql`${trips.ownerId} != ${adminId}`).run();
	db.delete(cards).where(sql`${cards.userId} != ${adminId}`).run();
	db.delete(insurancePolicies).where(sql`${insurancePolicies.userId} != ${adminId}`).run();
	db.delete(loyaltyPrograms).where(sql`${loyaltyPrograms.userId} != ${adminId}`).run();
	db.delete(users).where(sql`${users.id} != ${adminId}`).run();

	const demoUser = db
		.insert(users)
		.values({
			email: 'demo.traveler@example.com',
			passwordHash: 'disabled-demo-account',
			displayName: 'Demo Traveler',
			role: 'user'
		})
		.returning()
		.get();

	const t1 = db
		.insert(trips)
		.values({
			ownerId: adminId,
			name: 'Demo Trip to Tokyo',
			destination: null,
			destinationCountryCode: 'JP',
			destinationCityName: 'Tokyo',
			destinationCityLat: 35.6762,
			destinationCityLng: 139.6503,
			startDate: '2026-09-15',
			endDate: '2026-09-22',
			notes: 'A sample walking-skeleton trip.',
			tags: JSON.stringify(['demo', 'asia'])
		})
		.returning()
		.get();

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

	const t2 = db
		.insert(trips)
		.values({
			ownerId: demoUser.id,
			name: 'Shared demo trip',
			destination: null,
			destinationCountryCode: 'FR',
			destinationCityName: 'Paris',
			destinationCityLat: 48.8566,
			destinationCityLng: 2.3522,
			startDate: '2026-10-01',
			endDate: '2026-10-05',
			tags: JSON.stringify(['demo', 'europe'])
		})
		.returning()
		.get();

	db.insert(tripShares).values({ tripId: t2.id, sharedWithUserId: adminId, permission: 'read' }).run();

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
