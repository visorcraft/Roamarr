import { eq, and, ne, desc } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from '../db';
import { insurancePolicies, emergencyContacts } from '../db/mongrelSchema';
import { logAudit } from '../audit';
import { compareRows } from '../sortUtils';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';
import { toBigInt, idFromBigInt, optionalBigInt, optionalNumber, optionalFkNumber, nullableText, kitReinsertWithId } from './kitHelpers';

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
