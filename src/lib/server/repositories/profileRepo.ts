import { eq, and, ne, asc, desc, lte } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from '$lib/server/db';
import { travelDocuments, loyaltyPrograms, type TravelDocumentType } from '$lib/server/db/mongrelSchema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { compareRows } from '$lib/server/sortUtils';
import { nowIso } from '$lib/server/tz';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';
import { toBigInt, idFromBigInt, optionalBigInt, optionalNumber, optionalFkNumber, nullableText, kitReinsertWithId } from './kitHelpers';

export * from './profileCardsRepo';
export * from './profileInsuranceRepo';

// ============================================================================
// Travel documents
// ============================================================================

export type { TravelDocumentType } from '$lib/server/db/mongrelSchema';

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
