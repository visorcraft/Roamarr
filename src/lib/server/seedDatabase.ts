import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth';
import { normalizeEmail } from './users';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import * as profileRepo from './repositories/profileRepo';
import * as remindersRepo from './repositories/remindersRepo';
import { insertTripCompanion } from './tripCompanions';
import { addTripExpense } from './tripExpenses/repository';
import { setTripBudget } from './tripBudgets';
import { addItem } from './tripChecklists';
import { createJournalEntry } from './tripJournal';
import { createDocumentLink } from './tripDocumentLinks';
import { markCountryVisited, markStateVisited } from './visitedPlaces';
import { createProvider, toggleWatch } from './fareproviders';
import { SeedDateBuilder } from './seedDates';
import type { CreateTripInput } from './repositories/tripsRepo';
import type { Trip } from './repositories/tripsRepo';

export interface SeederOptions {
	email: string;
	password: string;
	now?: Date;
	baseCurrency?: string;
	timezone?: string;
}

interface TripDef extends CreateTripInput {
	paymentDueDate?: string | null;
}

export class DatabaseSeeder {
	private email: string;
	private password: string;
	private dates: SeedDateBuilder;
	private baseCurrency: string;
	private timezone: string;
	private userId!: number;

	constructor(opts: SeederOptions) {
		this.email = normalizeEmail(opts.email);
		this.password = opts.password;
		this.dates = new SeedDateBuilder(opts.now);
		this.baseCurrency = opts.baseCurrency ?? 'USD';
		this.timezone = opts.timezone ?? 'UTC';
	}

	async run() {
		await this.ensureCleanUser();
		this.seedProfile();
		await this.seedTrips();
		this.createNotifications();
		console.log(`Seeded ${this.email} (user ${this.userId})`);
	}

	private async ensureCleanUser() {
		const existing = usersRepo.getUserByEmail(this.email);
		if (existing) {
			usersRepo.deleteUser(Number(existing.id));
		}
		const user = usersRepo.createUser({
			email: this.email,
			password_hash: await hashPassword(this.password),
			display_name: 'Ciamos',
			role: 'user',
			timezone: this.timezone,
			default_currency: this.baseCurrency,
			calendar_token: null,
			calendar_token_expires_at: null
		});
		this.userId = Number(user.id);
	}

	private seedProfile() {
		profileRepo.createTravelDocument(this.userId, {
			type: 'passport',
			number: 'P12345678',
			issuingAuthority: 'US Department of State',
			expiresOn: this.dates.augustExpiry()
		});
		profileRepo.createTravelDocument(this.userId, {
			type: 'drivers_license',
			number: 'D98765432',
			issuingAuthority: 'California DMV',
			expiresOn: this.dates.sixtyDayExpiry()
		});
		profileRepo.createTravelDocument(this.userId, {
			type: 'visa',
			number: 'V-2025-JP',
			issuingAuthority: 'Japan Embassy',
			expiresOn: this.dates.augustExpiry()
		});

		const visa = profileRepo.createCard(this.userId, {
			nickname: 'Travel Visa',
			network: 'visa',
			last4: '4242'
		});
		const amex = profileRepo.createCard(this.userId, {
			nickname: 'Points Amex',
			network: 'amex',
			last4: '1001'
		});
		profileRepo.createCardBenefit(this.userId, Number(visa.id), {
			benefitType: 'trip_delay',
			coverageAmount: 50000,
			currency: 'USD',
			notes: 'Up to $500 reimbursement'
		});
		profileRepo.createCardBenefit(this.userId, Number(amex.id), {
			benefitType: 'baggage_delay',
			coverageAmount: 100000,
			currency: 'USD',
			notes: 'Up to $1,000 baggage delay'
		});

		profileRepo.createInsurancePolicy(this.userId, {
			provider: 'World Nomads',
			policyNumber: 'WN-2025-001',
			coverageSummary: 'Comprehensive trip cancellation & medical',
			coverageAmount: 250000,
			currency: 'USD',
			startDate: `${this.dates.now.year}-01-01`,
			endDate: `${this.dates.now.year}-12-31`
		});
		profileRepo.createInsurancePolicy(this.userId, {
			provider: 'SafetyWing',
			policyNumber: 'SW-2026-002',
			coverageSummary: 'Remote health & travel medical',
			coverageAmount: 100000,
			currency: 'USD',
			startDate: `${this.dates.now.year}-01-01`,
			endDate: `${this.dates.now.year}-06-30`
		});

		profileRepo.createLoyaltyProgram(this.userId, {
			programName: 'United MileagePlus',
			membershipNumber: 'MP123456789',
			balance: 125000
		});
		profileRepo.createLoyaltyProgram(this.userId, {
			programName: 'Marriott Bonvoy',
			membershipNumber: 'MB987654321',
			balance: 45000
		});

		profileRepo.createEmergencyContact(this.userId, {
			name: 'Sam Carter',
			relationship: 'Partner',
			phone: '+1-555-0199',
			email: 'sam.carter@example.com',
			isPrimary: true
		});

		markCountryVisited(this.userId, 'JP', {
			visitedOn: this.dates.now.minus({ years: 1 }).toISODate()!
		});
		markCountryVisited(this.userId, 'FR', {
			visitedOn: this.dates.now.minus({ months: 6 }).toISODate()!
		});
		markCountryVisited(this.userId, 'US', {
			visitedOn: this.dates.now.minus({ months: 3 }).toISODate()!
		});
		markStateVisited(this.userId, 'CA', {
			visitedOn: this.dates.now.minus({ months: 3 }).toISODate()!
		});
		markStateVisited(this.userId, 'NY', {
			visitedOn: this.dates.now.minus({ years: 1 }).toISODate()!
		});
	}

	private async seedGroups() {
		const g = tripsRepo.createGroup({ ownerId: this.userId, name: 'The Globetrotters' });

		// Clean up placeholder members from previous runs so the seeder stays re-runnable.
		for (const email of ['seed.member1@example.com', 'seed.member2@example.com']) {
			const existing = usersRepo.getUserByEmail(email);
			if (existing) usersRepo.deleteUser(Number(existing.id));
		}

		const m1 = usersRepo.createUser({
			email: 'seed.member1@example.com',
			password_hash: await hashPassword(randomUUID()),
			display_name: 'Seed Member 1',
			role: 'user',
			timezone: this.timezone,
			default_currency: this.baseCurrency,
			calendar_token: null,
			calendar_token_expires_at: null
		});
		const m2 = usersRepo.createUser({
			email: 'seed.member2@example.com',
			password_hash: await hashPassword(randomUUID()),
			display_name: 'Seed Member 2',
			role: 'user',
			timezone: this.timezone,
			default_currency: this.baseCurrency,
			calendar_token: null,
			calendar_token_expires_at: null
		});
		tripsRepo.addGroupMember(g.id, Number(m1.id));
		tripsRepo.addGroupMember(g.id, Number(m2.id));
		tripsRepo.addGroupMember(g.id, this.userId);
		return { groupId: g.id };
	}

	private async seedTrips() {
		const { groupId } = await this.seedGroups();
		const provider = createProvider(this.userId, 'stub', 'Personal', 'seed-api-key', true);

		const tripDefs: TripDef[] = [
			{
				name: 'Past trip earlier this year',
				...this.dates.pastTripEarlierThisYear(),
				destinationCountryCode: 'US',
				destinationCityName: 'San Diego',
				destinationCityLat: 32.7157,
				destinationCityLng: -117.1611
			},
			{
				name: 'Past trip last year',
				...this.dates.pastTripLastYear(),
				destinationCountryCode: 'FR',
				destinationCityName: 'Paris',
				destinationCityLat: 48.8566,
				destinationCityLng: 2.3522
			},
			{
				...this.dates.futureTrips()[0],
				destinationCountryCode: 'JP',
				destinationCityName: 'Tokyo',
				destinationCityLat: 35.6762,
				destinationCityLng: 139.6503
			},
			{
				...this.dates.futureTrips()[1],
				destinationCountryCode: 'US',
				destinationCityName: 'Denver',
				destinationCityLat: 39.7392,
				destinationCityLng: -104.9903
			},
			{
				...this.dates.futureTrips()[2],
				destinationCountryCode: 'DE',
				destinationCityName: 'Berlin',
				destinationCityLat: 52.52,
				destinationCityLng: 13.405
			}
		];

		const paymentDue = this.dates.paymentDueSoon();
		const paymentTripDef: TripDef = {
			name: 'Payment due soon',
			startDate: paymentDue.startDate,
			endDate: paymentDue.endDate,
			paymentDueDate: paymentDue.paymentDueDate,
			destinationCountryCode: 'IT',
			destinationCityName: 'Rome',
			destinationCityLat: 41.9028,
			destinationCityLng: 12.4964
		};

		for (const def of [...tripDefs, paymentTripDef]) {
			const trip = tripsRepo.createTrip(this.userId, {
				name: def.name,
				destinationCountryCode: def.destinationCountryCode,
				destinationCityName: def.destinationCityName,
				destinationCityLat: def.destinationCityLat,
				destinationCityLng: def.destinationCityLng,
				startDate: def.startDate,
				endDate: def.endDate,
				baseCurrency: this.baseCurrency,
				status: 'booked'
			});

			this.populateTrip(trip, def, provider.id, groupId);
		}
	}

	private populateTrip(
		trip: Trip,
		def: TripDef,
		providerId: number,
		groupId: number
	) {
		const tripId = trip.id;
		const alex = insertTripCompanion(this.userId, tripId, { name: 'Alex', category: 'adult' });
		const jordan = insertTripCompanion(this.userId, tripId, { name: 'Jordan', category: 'adult' });

		const flight = segmentsRepo.createSegment({
			trip_id: BigInt(tripId),
			type: 'flight',
			title: 'Outbound flight',
			start_at: `${def.startDate}T08:00:00Z`,
			start_tz: 'UTC',
			location: def.destinationCityName,
			country_code: def.destinationCountryCode,
			payment_status: def.paymentDueDate ? 'quoted' : 'fully_paid',
			payment_due_date: def.paymentDueDate ?? null
		});
		segmentsRepo.createSegment({
			trip_id: BigInt(tripId),
			type: 'hotel',
			title: 'Hotel',
			start_at: `${def.startDate}T16:00:00Z`,
			start_tz: 'UTC',
			end_at: `${def.endDate}T10:00:00Z`,
			location: def.destinationCityName
		});

		addTripExpense(this.userId, tripId, {
			description: 'Flights',
			amount: 120000,
			currency: 'USD',
			category: 'transport'
		});
		addTripExpense(this.userId, tripId, {
			description: 'Hotel',
			amount: 85000,
			currency: 'USD',
			category: 'lodging'
		});
		addTripExpense(this.userId, tripId, {
			description: 'Activities',
			amount: 30000,
			currency: 'USD',
			category: 'activities'
		});

		setTripBudget(this.userId, tripId, 'transport', 150000);
		setTripBudget(this.userId, tripId, 'lodging', 100000);
		setTripBudget(this.userId, tripId, 'activities', 25000);

		addItem(this.userId, tripId, 'Book flights');
		addItem(this.userId, tripId, 'Reserve hotel', alex.id);
		addItem(this.userId, tripId, 'Check passport expiry', jordan.id);

		createJournalEntry(this.userId, tripId, {
			entryDate: def.startDate ?? '',
			title: `${def.name} journal`,
			body: `Looking forward to ${def.name}!`
		});

		createDocumentLink(this.userId, tripId, {
			label: `${def.name} confirmation`,
			url: 'https://roamarr.test/confirmation'
		});

		remindersRepo.createReminder({
			userId: this.userId,
			kind: 'custom',
			refType: 'trip',
			refId: tripId,
			fireAt: this.dates.slightlyFuture()
		});

		toggleWatch(this.userId, tripId, providerId, Number(flight.id));

		tripsRepo.createShare({
			tripId,
			sharedWithGroupId: groupId,
			permission: 'edit',
			showDetails: true
		});
	}

	private createNotifications() {
		remindersRepo.createNotification({
			userId: this.userId,
			title: 'Payment due soon',
			body: 'A trip payment is due in about two weeks.',
			link: '/trips'
		});
		remindersRepo.createNotification({
			userId: this.userId,
			title: 'Document expiring',
			body: 'One of your travel documents expires next month.',
			link: '/profile/documents'
		});
	}
}
