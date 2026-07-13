import { eq, and, ne, asc, desc, inList, lte } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from '$lib/server/db';
import { KIT_EXECUTE_SYNC_CAP } from '$lib/server/db/scanCap';
import {
	travelDocuments,
	loyaltyPrograms,
	cards,
	cardBenefits,
	insurancePolicies,
	emergencyContacts
} from '$lib/server/db/mongrelSchema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { sanitizeLast4 } from '$lib/server/validation';
import { logAudit } from '$lib/server/audit';
import { compareRows } from '$lib/server/sortUtils';
import { nowIso } from '$lib/server/tz';
import type { Row, Insert, Update, ColumnSpec } from '@visorcraft/mongreldb-kit';

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function idFromBigInt(id: bigint): number {
	return Number(id);
}

function optionalBigInt(value: number | null | undefined): bigint | null {
	return value == null ? null : BigInt(value);
}

function optionalNumber(value: bigint | null | undefined): number | null {
	return value == null ? null : Number(value);
}

function optionalFkNumber(value: bigint | null | undefined): number | null {
	return value == null || value === 0n ? null : Number(value);
}

function nullableText(value: string | null | undefined): string | null {
	return value == null || value === '' ? null : value;
}

function kitReinsertWithId(
	table: { id: ColumnSpec; columns: readonly ColumnSpec[] },
	existing: Record<string, unknown>,
	patch: Record<string, unknown>
): Record<string, unknown> {
	const updated = { ...existing, ...patch };
	kit.deleteFrom(table as never).where(eq(table.id, existing.id as bigint)).executeSync();
	return kit.insertInto(table as never).values(updated as Insert<never>).executeSync();
}

// ============================================================================
// Travel documents
// ============================================================================

export type TravelDocumentType = 'passport' | 'drivers_license' | 'global_entry' | 'visa';

export interface TravelDocument {
	id: number;
	userId: number;
	companionId: number | null;
	type: TravelDocumentType;
	number: string | null;
	issuingAuthority: string | null;
	expiresOn: string | null;
	notes: string | null;
}

export interface TravelDocumentInput {
	type: TravelDocumentType;
	number?: string | null;
	issuingAuthority?: string | null;
	expiresOn?: string | null;
	notes?: string | null;
	companionId?: number | null;
}

function toTravelDocument(row: Row<typeof travelDocuments>): TravelDocument {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		companionId: optionalFkNumber(row.companion_id),
		type: row.type as TravelDocumentType,
		number: row.number ? decrypt(row.number) : null,
		issuingAuthority: nullableText(row.issuing_authority),
		expiresOn: nullableText(row.expires_on),
		notes: nullableText(row.notes)
	};
}

function toKitTravelDocumentInput(
	input: TravelDocumentInput
): Update<typeof travelDocuments> {
	return {
		type: input.type,
		number: input.number ? encrypt(input.number) : null,
		issuing_authority: input.issuingAuthority ?? null,
		expires_on: input.expiresOn ?? null,
		notes: input.notes ?? null,
		companion_id: optionalBigInt(input.companionId)
	};
}




export function listTravelDocuments(userId: number): TravelDocument[] {
	const rows = kit
		.selectFrom(travelDocuments)
		.where(eq(travelDocuments.user_id, toBigInt(userId)))
		.orderBy(desc(travelDocuments.id))
		.limit(KIT_EXECUTE_SYNC_CAP)
		.executeSync();
	return rows.map(toTravelDocument);
}

export interface ListTravelDocumentsOptions {
	search?: string;
	sortBy?: 'type' | 'issuingAuthority' | 'expiresOn' | 'notes';
	sortDir?: 'asc' | 'desc';
	from?: string;
	to?: string;
	limit?: number;
	offset?: number;
}

function matchesTravelDocumentDateRange(value: string | null, from?: string, to?: string): boolean {
	if (!from && !to) return true;
	if (!value) return false;
	const date = value.slice(0, 10);
	return (!from || date >= from) && (!to || date <= to);
}

export function listTravelDocumentsPaginated(
	userId: number,
	opts: ListTravelDocumentsOptions = {}
): TravelDocument[] {
	let rows = listTravelDocuments(userId);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter(
			(d) =>
				d.type.toLowerCase().includes(q) ||
				(d.issuingAuthority?.toLowerCase().includes(q) ?? false) ||
				(d.notes?.toLowerCase().includes(q) ?? false) ||
				(d.number?.toLowerCase().includes(q) ?? false)
		);
	}
	rows = rows.filter((d) => matchesTravelDocumentDateRange(d.expiresOn, opts.from, opts.to));
	const sortBy = opts.sortBy ?? 'expiresOn';
	const sortDir = opts.sortDir ?? 'asc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countTravelDocuments(
	userId: number,
	opts: { search?: string; from?: string; to?: string } = {}
): number {
	const q = opts.search?.trim().toLowerCase();
	const hasFilters = Boolean(q || opts.from || opts.to);
	if (!hasFilters) {
		return Number(
			kit
				.selectFrom(travelDocuments)
				.where(eq(travelDocuments.user_id, toBigInt(userId)))
				.selectCount()
				.executeSync()
		);
	}
	return listTravelDocuments(userId).filter(
		(d) =>
			matchesTravelDocumentDateRange(d.expiresOn, opts.from, opts.to) &&
			(!q ||
				d.type.toLowerCase().includes(q) ||
				(d.issuingAuthority?.toLowerCase().includes(q) ?? false) ||
				(d.notes?.toLowerCase().includes(q) ?? false) ||
				(d.number?.toLowerCase().includes(q) ?? false))
	).length;
}

export function listTravelDocumentsExpiringBefore(
	userId: number,
	beforeOrOn: string
): TravelDocument[] {
	const rows = kit
		.selectFrom(travelDocuments)
		.where(
			and(
				eq(travelDocuments.user_id, toBigInt(userId)),
				ne(travelDocuments.expires_on, ''),
				lte(travelDocuments.expires_on, beforeOrOn)
			)
		)
		.executeSync();
	return rows.map(toTravelDocument);
}

export function getTravelDocumentById(id: number, userId: number): TravelDocument | null {
	const rows = kit
		.selectFrom(travelDocuments)
		.where(
			and(
				eq(travelDocuments.id, toBigInt(id)),
				eq(travelDocuments.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	return rows[0] ? toTravelDocument(rows[0]) : null;
}

export function createTravelDocument(userId: number, input: TravelDocumentInput): TravelDocument {
	const row = kit
		.insertInto(travelDocuments)
		.values({
			user_id: toBigInt(userId),
			...toKitTravelDocumentInput(input)
		} as Insert<typeof travelDocuments>)
		.executeSync();
	return toTravelDocument(row);
}

export function updateTravelDocument(
	id: number,
	userId: number,
	input: TravelDocumentInput
): TravelDocument | null {
	const existing = getTravelDocumentById(id, userId);
	if (!existing) throw error(404, 'Not found');

	const patch = toKitTravelDocumentInput(input);
	let row: Row<typeof travelDocuments>;
	if (input.companionId === null) {
		const existingRow = kit
			.selectFrom(travelDocuments)
			.where(
				and(
					eq(travelDocuments.id, toBigInt(id)),
					eq(travelDocuments.user_id, toBigInt(userId))
				)
			)
			.executeSync()[0]!;
		row = kitReinsertWithId(travelDocuments, existingRow, patch) as Row<typeof travelDocuments>;
	} else {
		const rows = kit
			.updateTable(travelDocuments)
			.set(patch)
			.where(
				and(
					eq(travelDocuments.id, toBigInt(id)),
					eq(travelDocuments.user_id, toBigInt(userId))
				)
			)
			.executeSync();
		row = rows[0]!;
	}
	const updated = toTravelDocument(row);
	return updated;
}

export function deleteTravelDocument(id: number, userId: number): bigint {
	const existing = getTravelDocumentById(id, userId);
	if (!existing) throw error(404, 'Not found');
	return kit
		.deleteFrom(travelDocuments)
		.where(eq(travelDocuments.id, toBigInt(id)))
		.executeSync();
}

// ============================================================================
// Loyalty programs
// ============================================================================

export interface LoyaltyProgram {
	id: number;
	userId: number;
	programName: string;
	membershipNumber: string | null;
	balance: number | null;
	notes: string | null;
	balanceUpdatedAt: string | null;
}

export interface LoyaltyProgramInput {
	programName: string;
	membershipNumber?: string | null;
	balance?: number | null;
	notes?: string | null;
}

function toLoyaltyProgram(row: Row<typeof loyaltyPrograms>): LoyaltyProgram {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		programName: row.program_name,
		membershipNumber: nullableText(row.membership_number),
		balance: optionalNumber(row.balance),
		notes: nullableText(row.notes),
		balanceUpdatedAt: nullableText(row.balance_updated_at)
	};
}

function toKitLoyaltyProgramInput(
	input: LoyaltyProgramInput
): Update<typeof loyaltyPrograms> {
	return {
		program_name: input.programName.trim(),
		membership_number: input.membershipNumber?.trim() || null,
		balance: optionalBigInt(input.balance),
		notes: input.notes?.trim() || null
	};
}




function validateLoyaltyProgramInput(input: LoyaltyProgramInput) {
	if (!input.programName.trim()) throw error(400, 'Program name is required');
	if (input.membershipNumber != null && input.membershipNumber.length > 200) {
		throw error(400, 'Membership number must be 200 characters or less');
	}
	if (input.notes != null && input.notes.length > 2000) {
		throw error(400, 'Notes must be 2000 characters or less');
	}
	if (input.balance != null && (!Number.isFinite(input.balance) || input.balance < 0)) {
		throw error(400, 'Balance must be a non-negative number');
	}
}

export function listLoyaltyPrograms(userId: number): LoyaltyProgram[] {
	const rows = kit
		.selectFrom(loyaltyPrograms)
		.where(eq(loyaltyPrograms.user_id, toBigInt(userId)))
		.orderBy(asc(loyaltyPrograms.program_name))
		.limit(KIT_EXECUTE_SYNC_CAP)
		.executeSync();
	return rows.map(toLoyaltyProgram);
}

export interface ListLoyaltyProgramsOptions {
	search?: string;
	sortBy?: 'programName' | 'membershipNumber' | 'balance' | 'balanceUpdatedAt';
	sortDir?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}

export function listLoyaltyProgramsPaginated(
	userId: number,
	opts: ListLoyaltyProgramsOptions = {}
): LoyaltyProgram[] {
	let rows = listLoyaltyPrograms(userId);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter(
			(p) =>
				p.programName.toLowerCase().includes(q) ||
				(p.membershipNumber?.toLowerCase().includes(q) ?? false) ||
				(p.notes?.toLowerCase().includes(q) ?? false)
		);
	}
	const sortBy = opts.sortBy ?? 'programName';
	const sortDir = opts.sortDir ?? 'asc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countLoyaltyPrograms(userId: number, search?: string): number {
	if (!search?.trim()) {
		return Number(
			kit
				.selectFrom(loyaltyPrograms)
				.where(eq(loyaltyPrograms.user_id, toBigInt(userId)))
				.selectCount()
				.executeSync()
		);
	}
	const q = search.trim().toLowerCase();
	return listLoyaltyPrograms(userId).filter(
		(p) =>
			p.programName.toLowerCase().includes(q) ||
			(p.membershipNumber?.toLowerCase().includes(q) ?? false) ||
			(p.notes?.toLowerCase().includes(q) ?? false)
	).length;
}

export function getLoyaltyProgramById(id: number, userId: number): LoyaltyProgram | null {
	const rows = kit
		.selectFrom(loyaltyPrograms)
		.where(
			and(
				eq(loyaltyPrograms.id, toBigInt(id)),
				eq(loyaltyPrograms.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	return rows[0] ? toLoyaltyProgram(rows[0]) : null;
}

export function createLoyaltyProgram(userId: number, input: LoyaltyProgramInput): LoyaltyProgram {
	validateLoyaltyProgramInput(input);
	const kitInput = toKitLoyaltyProgramInput(input);
	if (input.balance != null) {
		kitInput.balance_updated_at = nowIso();
	}
	const row = kit
		.insertInto(loyaltyPrograms)
		.values({
			user_id: toBigInt(userId),
			...kitInput
		} as Insert<typeof loyaltyPrograms>)
		.executeSync();
	return toLoyaltyProgram(row);
}

export function updateLoyaltyProgram(
	id: number,
	userId: number,
	input: LoyaltyProgramInput
): LoyaltyProgram | null {
	validateLoyaltyProgramInput(input);
	const existing = getLoyaltyProgramById(id, userId);
	if (!existing) throw error(404, 'Not found');
	const kitInput = toKitLoyaltyProgramInput(input);
	const newBalance = input.balance ?? null;
	const oldBalance = existing.balance ?? null;
	if (newBalance !== oldBalance) {
		kitInput.balance_updated_at = nowIso();
	}
	const rows = kit
		.updateTable(loyaltyPrograms)
		.set(kitInput)
		.where(
			and(
				eq(loyaltyPrograms.id, toBigInt(id)),
				eq(loyaltyPrograms.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	const updated = rows[0] ? toLoyaltyProgram(rows[0]) : null;
	return updated;
}

export function deleteLoyaltyProgram(id: number, userId: number): bigint {
	const existing = getLoyaltyProgramById(id, userId);
	if (!existing) throw error(404, 'Not found');
	return kit
		.deleteFrom(loyaltyPrograms)
		.where(eq(loyaltyPrograms.id, toBigInt(id)))
		.executeSync();
}

// ============================================================================
// Cards
// ============================================================================

export type CardNetwork = 'visa' | 'mc' | 'amex' | 'disc' | 'other';

export interface Card {
	id: number;
	userId: number;
	nickname: string;
	network: CardNetwork;
	last4: string | null;
	notes: string | null;
}

export interface CardInput {
	nickname: string;
	network: string;
	last4?: string | null;
	notes?: string | null;
}

function toCard(row: Row<typeof cards>): Card {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		nickname: row.nickname,
		network: row.network as CardNetwork,
		last4: nullableText(row.last4),
		notes: nullableText(row.notes)
	};
}

function toKitCardInput(input: CardInput): Update<typeof cards> {
	return {
		nickname: input.nickname.trim(),
		network: input.network,
		last4: sanitizeLast4(input.last4 ?? undefined),
		notes: input.notes?.trim() || null
	};
}




export function listCards(userId: number): Card[] {
	const rows = kit
		.selectFrom(cards)
		.where(eq(cards.user_id, toBigInt(userId)))
		.orderBy(desc(cards.id))
		.limit(KIT_EXECUTE_SYNC_CAP)
		.executeSync();
	return rows.map(toCard);
}

export interface ListCardsOptions {
	search?: string;
	sortBy?: 'nickname' | 'network' | 'last4';
	sortDir?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}

export function listCardsPaginated(userId: number, opts: ListCardsOptions = {}): Card[] {
	let rows = listCards(userId);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter(
			(c) =>
				c.nickname.toLowerCase().includes(q) ||
				c.network.toLowerCase().includes(q) ||
				(c.last4?.toLowerCase().includes(q) ?? false)
		);
	}
	const sortBy = opts.sortBy ?? 'nickname';
	const sortDir = opts.sortDir ?? 'asc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countCards(userId: number, search?: string): number {
	if (!search?.trim()) {
		return Number(
			kit
				.selectFrom(cards)
				.where(eq(cards.user_id, toBigInt(userId)))
				.selectCount()
				.executeSync()
		);
	}
	const q = search.trim().toLowerCase();
	return listCards(userId).filter(
		(c) =>
			c.nickname.toLowerCase().includes(q) ||
			c.network.toLowerCase().includes(q) ||
			(c.last4?.toLowerCase().includes(q) ?? false)
	).length;
}

export function getCardById(id: number, userId: number): Card | null {
	const rows = kit
		.selectFrom(cards)
		.where(and(eq(cards.id, toBigInt(id)), eq(cards.user_id, toBigInt(userId))))
		.executeSync();
	return rows[0] ? toCard(rows[0]) : null;
}

export function createCard(userId: number, input: CardInput): Card {
	const row = kit
		.insertInto(cards)
		.values({
			user_id: toBigInt(userId),
			...toKitCardInput(input)
		} as Insert<typeof cards>)
		.executeSync();
	return toCard(row);
}

export function updateCard(id: number, userId: number, input: CardInput): Card | null {
	const existing = getCardById(id, userId);
	if (!existing) throw error(404, 'Not found');
	const rows = kit
		.updateTable(cards)
		.set(toKitCardInput(input))
		.where(and(eq(cards.id, toBigInt(id)), eq(cards.user_id, toBigInt(userId))))
		.executeSync();
	const updated = rows[0] ? toCard(rows[0]) : null;
	return updated;
}

export function deleteCard(id: number, userId: number): bigint {
	const existing = getCardById(id, userId);
	if (!existing) throw error(404, 'Not found');
	return kit
		.deleteFrom(cards)
		.where(eq(cards.id, toBigInt(id)))
		.executeSync();
}

// ============================================================================
// Card benefits
// ============================================================================

export type BenefitType = 'trip_delay' | 'baggage_delay' | 'trip_cancellation' | 'other';

export interface CardBenefit {
	id: number;
	cardId: number;
	benefitType: BenefitType;
	coverageAmount: number | null;
	currency: string;
	notes: string | null;
}

export interface CardBenefitInput {
	benefitType: string;
	coverageAmount?: number | null;
	currency?: string | null;
	notes?: string | null;
}

function toCardBenefit(row: Row<typeof cardBenefits>): CardBenefit {
	return {
		id: idFromBigInt(row.id),
		cardId: idFromBigInt(row.card_id),
		benefitType: row.benefit_type as BenefitType,
		coverageAmount: optionalNumber(row.coverage_amount),
		currency: row.currency,
		notes: nullableText(row.notes)
	};
}

function toKitCardBenefitInput(
	input: CardBenefitInput
): Update<typeof cardBenefits> {
	return {
		benefit_type: input.benefitType,
		coverage_amount: optionalBigInt(input.coverageAmount),
		currency: input.currency ?? 'USD',
		notes: input.notes?.trim() || null
	};
}




function requireOwnedCard(userId: number, cardId: number): Card {
	const card = getCardById(cardId, userId);
	if (!card) throw error(404, 'Not found');
	return card;
}

export function listBenefitsForCard(cardId: number): CardBenefit[] {
	const rows = kit
		.selectFrom(cardBenefits)
		.where(eq(cardBenefits.card_id, toBigInt(cardId)))
		.orderBy(asc(cardBenefits.id))
		.limit(KIT_EXECUTE_SYNC_CAP)
		.executeSync();
	return rows.map(toCardBenefit);
}

export function listBenefitsForCards(cardIds: number[]): CardBenefit[] {
	if (cardIds.length === 0) return [];
	const rows = kit
		.selectFrom(cardBenefits)
		.where(inList(cardBenefits.card_id, cardIds.map(toBigInt)))
		.executeSync();
	return rows.map(toCardBenefit);
}

export function getCardBenefitById(id: number, cardId: number): CardBenefit | null {
	const rows = kit
		.selectFrom(cardBenefits)
		.where(
			and(
				eq(cardBenefits.id, toBigInt(id)),
				eq(cardBenefits.card_id, toBigInt(cardId))
			)
		)
		.executeSync();
	return rows[0] ? toCardBenefit(rows[0]) : null;
}

export function createCardBenefit(
	userId: number,
	cardId: number,
	input: CardBenefitInput
): CardBenefit {
	requireOwnedCard(userId, cardId);
	const row = kit
		.insertInto(cardBenefits)
		.values({
			card_id: toBigInt(cardId),
			...toKitCardBenefitInput(input)
		} as Insert<typeof cardBenefits>)
		.executeSync();
	return toCardBenefit(row);
}

export function updateCardBenefit(
	id: number,
	cardId: number,
	input: CardBenefitInput
): CardBenefit | null {
	const existing = getCardBenefitById(id, cardId);
	if (!existing) throw error(404, 'Not found');
	const rows = kit
		.updateTable(cardBenefits)
		.set(toKitCardBenefitInput(input))
		.where(
			and(
				eq(cardBenefits.id, toBigInt(id)),
				eq(cardBenefits.card_id, toBigInt(cardId))
			)
		)
		.executeSync();
	const updated = rows[0] ? toCardBenefit(rows[0]) : null;
	return updated;
}

export function deleteCardBenefit(id: number, cardId: number): bigint {
	const existing = getCardBenefitById(id, cardId);
	if (!existing) throw error(404, 'Not found');
	return kit
		.deleteFrom(cardBenefits)
		.where(
			and(
				eq(cardBenefits.id, toBigInt(id)),
				eq(cardBenefits.card_id, toBigInt(cardId))
			)
		)
		.executeSync();
}

// ============================================================================
// Insurance policies
// ============================================================================

export interface InsurancePolicy {
	id: number;
	userId: number;
	provider: string;
	policyNumber: string | null;
	coverageSummary: string | null;
	coverageAmount: number | null;
	currency: string;
	startDate: string | null;
	endDate: string | null;
	tripId: number | null;
	notes: string | null;
}

export interface InsurancePolicyInput {
	provider: string;
	policyNumber?: string | null;
	coverageSummary?: string | null;
	coverageAmount?: number | null;
	currency?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	tripId?: number | null;
	notes?: string | null;
}

function toInsurancePolicy(row: Row<typeof insurancePolicies>): InsurancePolicy {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		provider: row.provider,
		policyNumber: nullableText(row.policy_number),
		coverageSummary: nullableText(row.coverage_summary),
		coverageAmount: optionalNumber(row.coverage_amount),
		currency: row.currency,
		startDate: nullableText(row.start_date),
		endDate: nullableText(row.end_date),
		tripId: optionalFkNumber(row.trip_id),
		notes: nullableText(row.notes)
	};
}

function toKitInsurancePolicyInput(
	input: InsurancePolicyInput
): Update<typeof insurancePolicies> {
	return {
		provider: input.provider.trim(),
		policy_number: input.policyNumber?.trim() || null,
		coverage_summary: input.coverageSummary?.trim() || null,
		coverage_amount: optionalBigInt(input.coverageAmount),
		currency: input.currency ?? 'USD',
		start_date: input.startDate?.trim() || null,
		end_date: input.endDate?.trim() || null,
		trip_id: optionalBigInt(input.tripId),
		notes: input.notes?.trim() || null
	};
}




export function listInsurancePolicies(userId: number): InsurancePolicy[] {
	const rows = kit
		.selectFrom(insurancePolicies)
		.where(eq(insurancePolicies.user_id, toBigInt(userId)))
		.orderBy(desc(insurancePolicies.id))
		.limit(KIT_EXECUTE_SYNC_CAP)
		.executeSync();
	return rows.map(toInsurancePolicy);
}

export interface ListInsurancePoliciesOptions {
	search?: string;
	sortBy?: 'provider' | 'policyNumber' | 'startDate' | 'endDate';
	sortDir?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
	from?: string;
	to?: string;
}

function matchesInsuranceDateRange(value: string | null, from?: string, to?: string): boolean {
	if (!from && !to) return true;
	if (!value) return false;
	const date = value.slice(0, 10);
	return (!from || date >= from) && (!to || date <= to);
}

export function listInsurancePoliciesPaginated(
	userId: number,
	opts: ListInsurancePoliciesOptions = {}
): InsurancePolicy[] {
	let rows = listInsurancePolicies(userId);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter(
			(p) =>
				p.provider.toLowerCase().includes(q) ||
				(p.policyNumber?.toLowerCase().includes(q) ?? false) ||
				(p.coverageSummary?.toLowerCase().includes(q) ?? false) ||
				(p.notes?.toLowerCase().includes(q) ?? false)
		);
	}
	rows = rows.filter((p) => matchesInsuranceDateRange(p.startDate, opts.from, opts.to));
	const sortBy = opts.sortBy ?? 'provider';
	const sortDir = opts.sortDir ?? 'asc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countInsurancePolicies(
	userId: number,
	search?: string,
	from?: string,
	to?: string
): number {
	if (!search?.trim() && !from && !to) {
		return Number(
			kit
				.selectFrom(insurancePolicies)
				.where(eq(insurancePolicies.user_id, toBigInt(userId)))
				.selectCount()
				.executeSync()
		);
	}
	const q = search?.trim().toLowerCase();
	return listInsurancePolicies(userId).filter(
		(p) =>
			matchesInsuranceDateRange(p.startDate, from, to) &&
			(!q ||
				p.provider.toLowerCase().includes(q) ||
				(p.policyNumber?.toLowerCase().includes(q) ?? false) ||
				(p.coverageSummary?.toLowerCase().includes(q) ?? false) ||
				(p.notes?.toLowerCase().includes(q) ?? false))
	).length;
}

export function getInsurancePolicyById(id: number, userId: number): InsurancePolicy | null {
	const rows = kit
		.selectFrom(insurancePolicies)
		.where(
			and(
				eq(insurancePolicies.id, toBigInt(id)),
				eq(insurancePolicies.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	return rows[0] ? toInsurancePolicy(rows[0]) : null;
}

export function createInsurancePolicy(
	userId: number,
	input: InsurancePolicyInput
): InsurancePolicy {
	const row = kit
		.insertInto(insurancePolicies)
		.values({
			user_id: toBigInt(userId),
			...toKitInsurancePolicyInput(input)
		} as Insert<typeof insurancePolicies>)
		.executeSync();
	return toInsurancePolicy(row);
}

export function updateInsurancePolicy(
	id: number,
	userId: number,
	input: InsurancePolicyInput
): InsurancePolicy | null {
	const existing = getInsurancePolicyById(id, userId);
	if (!existing) throw error(404, 'Not found');

	const patch = toKitInsurancePolicyInput(input);
	let row: Row<typeof insurancePolicies>;
	if (input.tripId === null) {
		const existingRow = kit
			.selectFrom(insurancePolicies)
			.where(
				and(
					eq(insurancePolicies.id, toBigInt(id)),
					eq(insurancePolicies.user_id, toBigInt(userId))
				)
			)
			.executeSync()[0]!;
		row = kitReinsertWithId(insurancePolicies, existingRow, patch) as Row<typeof insurancePolicies>;
	} else {
		const rows = kit
			.updateTable(insurancePolicies)
			.set(patch)
			.where(
				and(
					eq(insurancePolicies.id, toBigInt(id)),
					eq(insurancePolicies.user_id, toBigInt(userId))
				)
			)
			.executeSync();
		row = rows[0]!;
	}
	const updated = toInsurancePolicy(row);
	return updated;
}

export function deleteInsurancePolicy(id: number, userId: number): bigint {
	const existing = getInsurancePolicyById(id, userId);
	if (!existing) throw error(404, 'Not found');
	return kit
		.deleteFrom(insurancePolicies)
		.where(eq(insurancePolicies.id, toBigInt(id)))
		.executeSync();
}

export function attachInsurancePolicyToTrip(userId: number, policyId: number, tripId: number) {
	const existing = getInsurancePolicyById(policyId, userId);
	if (!existing) throw error(404, 'Not found');
	kit
		.updateTable(insurancePolicies)
		.set({ trip_id: toBigInt(tripId) })
		.where(eq(insurancePolicies.id, toBigInt(policyId)))
		.executeSync();
}

export function detachInsurancePolicyFromTrip(userId: number, policyId: number) {
	const existing = getInsurancePolicyById(policyId, userId);
	if (!existing) throw error(404, 'Not found');

	const existingRow = kit
		.selectFrom(insurancePolicies)
		.where(
			and(
				eq(insurancePolicies.id, toBigInt(policyId)),
				eq(insurancePolicies.user_id, toBigInt(userId))
			)
		)
		.executeSync()[0]!;
	kitReinsertWithId(insurancePolicies, existingRow, { trip_id: null });
}

// ============================================================================
// Emergency contacts
// ============================================================================

export interface EmergencyContact {
	id: number;
	userId: number;
	name: string;
	relationship: string | null;
	phone: string | null;
	email: string | null;
	isPrimary: boolean;
	createdAt: string;
}

export interface EmergencyContactInput {
	name: string;
	relationship?: string | null;
	phone?: string | null;
	email?: string | null;
	isPrimary?: boolean;
}

function toEmergencyContact(row: Row<typeof emergencyContacts>): EmergencyContact {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		name: row.name,
		relationship: nullableText(row.relationship),
		phone: nullableText(row.phone),
		email: nullableText(row.email),
		isPrimary: row.is_primary,
		createdAt: row.created_at
	};
}

function toKitEmergencyContactInput(
	input: EmergencyContactInput
): Update<typeof emergencyContacts> {
	return {
		name: input.name.trim(),
		relationship: input.relationship?.trim() || null,
		phone: input.phone?.trim() || null,
		email: input.email?.trim() || null,
		is_primary: input.isPrimary ?? false
	};
}




function clearOtherPrimaryEmergencyContact(userId: number, exceptId?: number) {
	const conditions = [
		eq(emergencyContacts.user_id, toBigInt(userId)),
		eq(emergencyContacts.is_primary, true)
	];
	if (exceptId != null) {
		conditions.push(ne(emergencyContacts.id, toBigInt(exceptId)));
	}
	kit
		.updateTable(emergencyContacts)
		.set({ is_primary: false })
		.where(and(...conditions))
		.executeSync();

}

export function listEmergencyContacts(userId: number): EmergencyContact[] {
	const rows = kit
		.selectFrom(emergencyContacts)
		.where(eq(emergencyContacts.user_id, toBigInt(userId)))
		.executeSync();
	return rows
		.map(toEmergencyContact)
		.sort((a, b) => {
			if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
}

export function getEmergencyContactById(id: number, userId: number): EmergencyContact | null {
	const rows = kit
		.selectFrom(emergencyContacts)
		.where(
			and(
				eq(emergencyContacts.id, toBigInt(id)),
				eq(emergencyContacts.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	return rows[0] ? toEmergencyContact(rows[0]) : null;
}

export function createEmergencyContact(
	userId: number,
	input: EmergencyContactInput
): EmergencyContact {
	const name = input.name.trim();
	if (!name) throw error(400, 'Name is required');
	const isPrimary = input.isPrimary ?? false;
	if (isPrimary) clearOtherPrimaryEmergencyContact(userId);
	const row = kit
		.insertInto(emergencyContacts)
		.values({
			user_id: toBigInt(userId),
			...toKitEmergencyContactInput({ ...input, name })
		} as Insert<typeof emergencyContacts>)
		.executeSync();
	logAudit(userId, 'emergency_contact_create', 'emergency_contact', idFromBigInt(row.id), {
		name,
		isPrimary
	});
	return toEmergencyContact(row);
}

export function updateEmergencyContact(
	id: number,
	userId: number,
	input: EmergencyContactInput
): EmergencyContact | null {
	const existing = getEmergencyContactById(id, userId);
	if (!existing) throw error(404, 'Not found');
	const name = input.name.trim();
	if (!name) throw error(400, 'Name is required');
	const isPrimary = input.isPrimary ?? false;
	if (isPrimary) clearOtherPrimaryEmergencyContact(userId, id);
	const rows = kit
		.updateTable(emergencyContacts)
		.set(toKitEmergencyContactInput({ ...input, name }))
		.where(
			and(
				eq(emergencyContacts.id, toBigInt(id)),
				eq(emergencyContacts.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	const updated = rows[0] ? toEmergencyContact(rows[0]) : null;
	logAudit(userId, 'emergency_contact_update', 'emergency_contact', id, { name, isPrimary });
	return updated;
}

export function deleteEmergencyContact(id: number, userId: number): bigint {
	const existing = getEmergencyContactById(id, userId);
	if (!existing) throw error(404, 'Not found');
		logAudit(userId, 'emergency_contact_delete', 'emergency_contact', id);
	return kit
		.deleteFrom(emergencyContacts)
		.where(eq(emergencyContacts.id, toBigInt(id)))
		.executeSync();
}
