import { ne as kitNe } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import {
	users as kitUsers,
	trips as kitTrips,
	tripComments as kitTripComments,
	tripShares as kitTripShares,
	segments as kitSegments,
	cards as kitCards,
	insurancePolicies as kitInsurancePolicies,
	loyaltyPrograms as kitLoyaltyPrograms
} from './db/mongrelSchema';
import * as tripsRepo from './repositories/tripsRepo';
import * as usersRepo from './repositories/usersRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import * as profileRepo from './repositories/profileRepo';

function kitId(id: number): bigint {
	return BigInt(id);
}

export function seedDemoData(adminId: number) {
	// Clean kit tables.
	kit.deleteFrom(kitTripComments).executeSync();
	kit.deleteFrom(kitTripShares).executeSync();
	kit.deleteFrom(kitSegments).executeSync();
	kit.deleteFrom(kitTrips).where(kitNe(kitTrips.owner_id, kitId(adminId))).executeSync();
	kit.deleteFrom(kitCards).where(kitNe(kitCards.user_id, kitId(adminId))).executeSync();
	kit.deleteFrom(kitInsurancePolicies).where(kitNe(kitInsurancePolicies.user_id, kitId(adminId))).executeSync();
	kit.deleteFrom(kitLoyaltyPrograms).where(kitNe(kitLoyaltyPrograms.user_id, kitId(adminId))).executeSync();
	kit.deleteFrom(kitUsers).where(kitNe(kitUsers.id, kitId(adminId))).executeSync();

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

	segmentsRepo.createSegment({
		trip_id: BigInt(t1.id),
		type: 'flight',
		title: 'JL outbound',
		start_at: '2026-09-15T08:00:00Z',
		start_tz: 'UTC',
		end_at: '2026-09-15T16:00:00Z',
		location: 'NRT'
	});
	segmentsRepo.createSegment({
		trip_id: BigInt(t1.id),
		type: 'hotel',
		title: 'Shinjuku Hotel',
		start_at: '2026-09-15T17:00:00Z',
		start_tz: 'Asia/Tokyo',
		end_at: '2026-09-22T10:00:00Z',
		location: 'Shinjuku, Tokyo'
	});
	segmentsRepo.createSegment({
		trip_id: BigInt(t1.id),
		type: 'food',
		title: 'Tsukiji lunch',
		start_at: '2026-09-16T12:00:00Z',
		start_tz: 'Asia/Tokyo',
		location: 'Tsukiji'
	});

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

	profileRepo.createCard(adminId, {
		nickname: 'Travel Card',
		network: 'visa',
		last4: '4242',
		notes: 'Demo card'
	});

	profileRepo.createInsurancePolicy(adminId, {
		provider: 'Demo Insurer',
		policyNumber: 'DEMO-123',
		coverageSummary: 'Trip cancellation',
		coverageAmount: 5000,
		currency: 'USD',
		startDate: '2026-01-01',
		endDate: '2026-12-31'
	});

	profileRepo.createLoyaltyProgram(adminId, {
		programName: 'Demo Air',
		membershipNumber: 'DA12345',
		balance: 5000
	});

	return { demoUser, trips: [t1, t2] };
}
