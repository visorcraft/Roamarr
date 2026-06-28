import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as any,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { db, sqlite, kit, close } = freshDb();
	Object.assign(ctx, { db, sqlite, kit, close });
	return { db, sqlite, kit, getDb: () => kit };
});

import * as profileRepo from './profileRepo';
import { createTrip } from './tripsRepo';
import { makeKitUser } from '../../../../tests/kitHelpers';
import {
	travelDocuments,
	loyaltyPrograms,
	cards,
	cardBenefits,
	insurancePolicies,
	emergencyContacts
} from '../db/mongrelSchema';
import {
	travelDocuments as drizzleTravelDocuments,
	loyaltyPrograms as drizzleLoyaltyPrograms,
	cards as drizzleCards,
	cardBenefits as drizzleCardBenefits,
	insurancePolicies as drizzleInsurancePolicies,
	emergencyContacts as drizzleEmergencyContacts
} from '../db/mongrelSchema';
import { eq as kitEq } from '@mongreldb/kit';
import { eq } from '@mongreldb/kit';

function resetKitTables() {
	ctx.kit.deleteFrom(travelDocuments).executeSync();
	ctx.kit.deleteFrom(loyaltyPrograms).executeSync();
	ctx.kit.deleteFrom(cardBenefits).executeSync();
	ctx.kit.deleteFrom(cards).executeSync();
	ctx.kit.deleteFrom(insurancePolicies).executeSync();
	ctx.kit.deleteFrom(emergencyContacts).executeSync();
}

function resetLegacyTables() {
	ctx.sqlite.exec(
		'delete from travel_documents; delete from loyalty_programs; delete from card_benefits; delete from cards; delete from insurance_policies; delete from emergency_contacts; delete from trips; delete from users;'
	);
}

beforeEach(() => {
	resetKitTables();
	resetLegacyTables();
});

afterAll(() => {
	ctx.close();
});

// Travel documents

test('travel document CRUD encrypts number and syncs to legacy', () => {
	const u = makeKitUser({ email: 'doc@x.c' });
	const doc = profileRepo.createTravelDocument(Number(u.id), {
		type: 'passport',
		number: 'P1234567',
		issuingAuthority: 'US State Dept',
		expiresOn: '2030-01-01',
		notes: 'My passport'
	});

	expect(doc.number).toBe('P1234567');
	expect(doc.type).toBe('passport');

	const kitRow = ctx.kit
		.selectFrom(travelDocuments)
		.where(kitEq(travelDocuments.id, BigInt(doc.id)))
		.executeSync()[0];
	expect(kitRow!.number).not.toBe('P1234567');

	const legacyRow = ctx.db
		.select()
		.from(drizzleTravelDocuments)
		.where(eq(drizzleTravelDocuments.id, BigInt(doc.id)))
		.get()!;
	expect(legacyRow.number).not.toBe('P1234567');

	const listed = profileRepo.listTravelDocuments(Number(u.id));
	expect(listed).toHaveLength(1);
	expect(listed[0]!.number).toBe('P1234567');

	const updated = profileRepo.updateTravelDocument(doc.id, Number(u.id), {
		type: 'visa',
		number: 'V7654321',
		expiresOn: '2031-12-31'
	});
	expect(updated).not.toBeNull();
	expect(updated!.type).toBe('visa');
	expect(updated!.number).toBe('V7654321');

	expect(() =>
		profileRepo.updateTravelDocument(doc.id, Number(u.id) + 1, { type: 'passport' })
	).toThrow(expect.objectContaining({ status: 404 }));

	profileRepo.deleteTravelDocument(doc.id, Number(u.id));
	expect(profileRepo.listTravelDocuments(Number(u.id))).toHaveLength(0);
	expect(
		ctx.db.select().from(drizzleTravelDocuments).where(eq(drizzleTravelDocuments.id, BigInt(doc.id))).get()
	).toBeUndefined();
});

// Loyalty programs

test('loyalty program CRUD validates balance and syncs to legacy', () => {
	const u = makeKitUser({ email: 'loyalty@x.c' });
	const program = profileRepo.createLoyaltyProgram(Number(u.id), {
		programName: 'United MileagePlus',
		membershipNumber: 'UA123',
		balance: 5000,
		notes: 'Gold status'
	});
	expect(program.programName).toBe('United MileagePlus');
	expect(program.balance).toBe(5000);

	const legacyRow = ctx.db
		.select()
		.from(drizzleLoyaltyPrograms)
		.where(eq(drizzleLoyaltyPrograms.id, BigInt(program.id)))
		.get()!;
	expect(legacyRow.programName).toBe('United MileagePlus');

	profileRepo.updateLoyaltyProgram(program.id, Number(u.id), {
		programName: 'Delta SkyMiles',
		balance: 10000
	});
	expect(profileRepo.getLoyaltyProgramById(program.id, Number(u.id))!.programName).toBe(
		'Delta SkyMiles'
	);

	expect(() =>
		profileRepo.createLoyaltyProgram(Number(u.id), {
			programName: 'Bad',
			balance: -1
		})
	).toThrow();

	profileRepo.deleteLoyaltyProgram(program.id, Number(u.id));
	expect(profileRepo.getLoyaltyProgramById(program.id, Number(u.id))).toBeNull();
});

// Cards

test('card CRUD sanitizes last4 and syncs to legacy', () => {
	const u = makeKitUser({ email: 'card@x.c' });
	const card = profileRepo.createCard(Number(u.id), {
		nickname: 'Sapphire',
		network: 'visa',
		last4: '4111 1111 1111 1234',
		notes: 'Primary card'
	});
	expect(card.last4).toBe('1234');

	const legacyRow = ctx.db
		.select()
		.from(drizzleCards)
		.where(eq(drizzleCards.id, BigInt(card.id)))
		.get()!;
	expect(legacyRow.last4).toBe('1234');

	profileRepo.updateCard(card.id, Number(u.id), {
		nickname: 'Freedom',
		network: 'mc',
		last4: '9999'
	});
	const updated = profileRepo.getCardById(card.id, Number(u.id))!;
	expect(updated.nickname).toBe('Freedom');
	expect(updated.network).toBe('mc');

	const other = makeKitUser({ email: 'other-card@x.c' });
	expect(profileRepo.getCardById(card.id, Number(other.id))).toBeNull();

	profileRepo.deleteCard(card.id, Number(u.id));
	expect(profileRepo.listCards(Number(u.id))).toHaveLength(0);
	expect(ctx.db.select().from(drizzleCards).where(eq(drizzleCards.id, BigInt(card.id))).get()).toBeUndefined();
});

// Card benefits

test('card benefit CRUD is scoped to card and syncs to legacy', () => {
	const u = makeKitUser({ email: 'benefit@x.c' });
	const card = profileRepo.createCard(Number(u.id), { nickname: 'Sapphire', network: 'visa' });
	const benefit = profileRepo.createCardBenefit(Number(u.id), card.id, {
		benefitType: 'trip_delay',
		coverageAmount: 50000,
		currency: 'USD',
		notes: 'Reimbursement'
	});
	expect(benefit.benefitType).toBe('trip_delay');
	expect(benefit.coverageAmount).toBe(50000);

	const legacyRow = ctx.db
		.select()
		.from(drizzleCardBenefits)
		.where(eq(drizzleCardBenefits.id, BigInt(benefit.id)))
		.get()!;
	expect(legacyRow.benefitType).toBe('trip_delay');

	const benefits = profileRepo.listBenefitsForCard(card.id);
	expect(benefits).toHaveLength(1);

	profileRepo.updateCardBenefit(benefit.id, card.id, {
		benefitType: 'baggage_delay',
		coverageAmount: 10000,
		currency: 'EUR'
	});
	expect(profileRepo.getCardBenefitById(benefit.id, card.id)!.benefitType).toBe('baggage_delay');

	const otherCard = profileRepo.createCard(Number(u.id), { nickname: 'Other', network: 'amex' });
	expect(() =>
		profileRepo.updateCardBenefit(benefit.id, otherCard.id, { benefitType: 'other' })
	).toThrow(expect.objectContaining({ status: 404 }));

	profileRepo.deleteCardBenefit(benefit.id, card.id);
	expect(profileRepo.listBenefitsForCard(card.id)).toHaveLength(0);
});

// Insurance policies

test('insurance policy CRUD supports trip link and syncs to legacy', () => {
	const u = makeKitUser({ email: 'ins@x.c' });
	createTrip(Number(u.id), { name: 'Dummy' });
	const trip = createTrip(Number(u.id), { name: 'Tokyo' });

	const policy = profileRepo.createInsurancePolicy(Number(u.id), {
		provider: 'Acme',
		policyNumber: 'ACME-123',
		coverageAmount: 50000,
		startDate: '2025-01-01',
		endDate: '2025-12-31',
		tripId: trip.id,
		notes: 'Annual policy'
	});
	expect(policy.provider).toBe('Acme');
	expect(policy.tripId).toBe(trip.id);

	const legacyRow = ctx.db
		.select()
		.from(drizzleInsurancePolicies)
		.where(eq(drizzleInsurancePolicies.id, BigInt(policy.id)))
		.get()!;
	expect(legacyRow.provider).toBe('Acme');
	expect(legacyRow.tripId).toBe(trip.id);

	profileRepo.detachInsurancePolicyFromTrip(Number(u.id), policy.id);
	const afterDetach = profileRepo.getInsurancePolicyById(policy.id, Number(u.id))!;
	expect(afterDetach.tripId).toBeNull();

	profileRepo.attachInsurancePolicyToTrip(Number(u.id), policy.id, trip.id);
	expect(profileRepo.getInsurancePolicyById(policy.id, Number(u.id))!.tripId).toBe(trip.id);

	profileRepo.deleteInsurancePolicy(policy.id, Number(u.id));
	expect(profileRepo.listInsurancePolicies(Number(u.id))).toHaveLength(0);
});

// Emergency contacts

test('emergency contact CRUD clears other primary and syncs to legacy', () => {
	const u = makeKitUser({ email: 'ec@x.c' });
	const c1 = profileRepo.createEmergencyContact(Number(u.id), {
		name: 'Sam Doe',
		relationship: 'sibling',
		phone: '+1-555-0199',
		email: 'sam@x.c',
		isPrimary: true
	});
	expect(c1.isPrimary).toBe(true);

	const c2 = profileRepo.createEmergencyContact(Number(u.id), {
		name: 'Alex Doe',
		isPrimary: true
	});
	expect(c2.isPrimary).toBe(true);
	expect(profileRepo.getEmergencyContactById(c1.id, Number(u.id))!.isPrimary).toBe(false);

	const legacyRow = ctx.db
		.select()
		.from(drizzleEmergencyContacts)
		.where(eq(drizzleEmergencyContacts.id, BigInt(c2.id)))
		.get()!;
	expect(legacyRow.isPrimary).toBe(true);

	const listed = profileRepo.listEmergencyContacts(Number(u.id));
	expect(listed[0]!.id).toBe(c2.id);

	profileRepo.updateEmergencyContact(c1.id, Number(u.id), { name: 'Sam Smith', isPrimary: true });
	expect(profileRepo.getEmergencyContactById(c1.id, Number(u.id))!.isPrimary).toBe(true);
	expect(profileRepo.getEmergencyContactById(c2.id, Number(u.id))!.isPrimary).toBe(false);

	profileRepo.deleteEmergencyContact(c1.id, Number(u.id));
	expect(profileRepo.listEmergencyContacts(Number(u.id))).toHaveLength(1);
});
