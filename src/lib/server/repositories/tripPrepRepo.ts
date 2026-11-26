import {
	eq,
	inList,
	asc,
	type Row,
	type Insert,
	type Update
} from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import {
	tripCompanions,
	tripHomeTasks,
	tripMailHolds,
	tripMedications,
	tripEntryRequirements,
	tripImportantItems
} from '$lib/server/db/mongrelSchema';
import { nowIso } from '$lib/server/tz';
import { publishTripChanged } from '$lib/server/eventBus';
import { toBigInt as kitId, idFromBigInt as num, nullableText, optionalBigInt as nullableInt } from './kitHelpers';

// ============================================================================
// Home tasks
// ============================================================================

export interface HomeTask {
	id: number;
	tripId: number;
	text: string;
	dueDate: string | null;
	done: boolean;
	sortOrder: number;
	createdAt: string;
}

export interface CreateHomeTaskInput {
	tripId: number;
	text: string;
	dueDate?: string | null;
}

export type UpdateHomeTaskInput = Partial<
	Omit<CreateHomeTaskInput, 'tripId'> & { done?: boolean; sortOrder?: number }
>;

function toHomeTask(row: Row<typeof tripHomeTasks>): HomeTask {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		text: row.text,
		dueDate: nullableText(row.due_date),
		done: row.done,
		sortOrder: Number(row.sort_order),
		createdAt: row.created_at
	};
}



export function listHomeTasksForTrip(tripId: number): HomeTask[] {
	const rows = kit
		.selectFrom(tripHomeTasks)
		.where(eq(tripHomeTasks.trip_id, kitId(tripId)))
		.orderBy(asc(tripHomeTasks.sort_order), asc(tripHomeTasks.created_at))
		
		.executeSync();
	return rows.map(toHomeTask);
}

export function getHomeTaskById(id: number): HomeTask | null {
	const rows = kit
		.selectFrom(tripHomeTasks)
		.where(eq(tripHomeTasks.id, kitId(id)))
		.executeSync();
	return rows[0] ? toHomeTask(rows[0]) : null;
}

export function createHomeTask(input: CreateHomeTaskInput): HomeTask {
	const row = kit
		.insertInto(tripHomeTasks)
		.values({
			trip_id: kitId(input.tripId),
			text: input.text,
			due_date: nullableText(input.dueDate),
			done: false,
			sort_order: 0n
		} as Insert<typeof tripHomeTasks>)
		.executeSync();
	const task = toHomeTask(row);
	publishTripChanged(task.tripId);
	return task;
}

export function updateHomeTask(id: number, patch: UpdateHomeTaskInput): HomeTask | null {
	const set: Update<typeof tripHomeTasks> = {};
	if (patch.text !== undefined) set.text = patch.text;
	if (patch.dueDate !== undefined) set.due_date = nullableText(patch.dueDate);
	if (patch.done !== undefined) set.done = patch.done;
	if (patch.sortOrder !== undefined) set.sort_order = BigInt(patch.sortOrder);
	const updated = kit
		.updateTable(tripHomeTasks)
		.set(set)
		.where(eq(tripHomeTasks.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	const task = toHomeTask(row);
	publishTripChanged(task.tripId);
	return task;
}

export function deleteHomeTask(id: number): number {
	const existing = getHomeTaskById(id);
	const deleted = kit
		.deleteFrom(tripHomeTasks)
		.where(eq(tripHomeTasks.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && existing) publishTripChanged(existing.tripId);
	return Number(deleted);
}

// ============================================================================
// Mail holds
// ============================================================================

export interface MailHold {
	id: number;
	tripId: number;
	carrier: string;
	startDate: string;
	endDate: string;
	confirmationNumber: string | null;
	addressLabel: string | null;
	notes: string | null;
	status: 'requested' | 'active' | 'ended' | 'cancelled';
	createdAt: string;
	updatedAt: string;
}

export interface CreateMailHoldInput {
	tripId: number;
	carrier: string;
	startDate: string;
	endDate: string;
	confirmationNumber?: string | null;
	addressLabel?: string | null;
	notes?: string | null;
	status?: MailHold['status'];
}

export type UpdateMailHoldInput = Partial<Omit<CreateMailHoldInput, 'tripId'>>;

function toMailHold(row: Row<typeof tripMailHolds>): MailHold {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		carrier: row.carrier,
		startDate: row.start_date,
		endDate: row.end_date,
		confirmationNumber: nullableText(row.confirmation_number),
		addressLabel: nullableText(row.address_label),
		notes: nullableText(row.notes),
		status: row.status as MailHold['status'],
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export function listMailHoldsForTrip(tripId: number): MailHold[] {
	const rows = kit
		.selectFrom(tripMailHolds)
		.where(eq(tripMailHolds.trip_id, kitId(tripId)))
		.orderBy(asc(tripMailHolds.start_date), asc(tripMailHolds.id))
		.executeSync();
	return rows.map(toMailHold);
}

export function getMailHoldById(id: number): MailHold | null {
	const rows = kit
		.selectFrom(tripMailHolds)
		.where(eq(tripMailHolds.id, kitId(id)))
		.executeSync();
	return rows[0] ? toMailHold(rows[0]) : null;
}

export function createMailHold(input: CreateMailHoldInput): MailHold {
	const row = kit
		.insertInto(tripMailHolds)
		.values({
			trip_id: kitId(input.tripId),
			carrier: input.carrier,
			start_date: input.startDate,
			end_date: input.endDate,
			confirmation_number: nullableText(input.confirmationNumber),
			address_label: nullableText(input.addressLabel),
			notes: nullableText(input.notes),
			status: input.status ?? 'requested'
		} as Insert<typeof tripMailHolds>)
		.executeSync();
	const hold = toMailHold(row);
	publishTripChanged(hold.tripId);
	return hold;
}

export function updateMailHold(id: number, patch: UpdateMailHoldInput): MailHold | null {
	const set: Update<typeof tripMailHolds> = {};
	if (patch.carrier !== undefined) set.carrier = patch.carrier;
	if (patch.startDate !== undefined) set.start_date = patch.startDate;
	if (patch.endDate !== undefined) set.end_date = patch.endDate;
	if (patch.confirmationNumber !== undefined) set.confirmation_number = nullableText(patch.confirmationNumber);
	if (patch.addressLabel !== undefined) set.address_label = nullableText(patch.addressLabel);
	if (patch.notes !== undefined) set.notes = nullableText(patch.notes);
	if (patch.status !== undefined) set.status = patch.status;
	const updated = kit
		.updateTable(tripMailHolds)
		.set(set)
		.where(eq(tripMailHolds.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	const hold = toMailHold(row);
	publishTripChanged(hold.tripId);
	return hold;
}

export function deleteMailHold(id: number): number {
	const existing = getMailHoldById(id);
	const deleted = kit
		.deleteFrom(tripMailHolds)
		.where(eq(tripMailHolds.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && existing) publishTripChanged(existing.tripId);
	return Number(deleted);
}

// ============================================================================
// Medications
// ============================================================================

export interface Medication {
	id: number;
	tripId: number;
	companionId: number | null;
	companionName: string | null;
	name: string;
	dosage: string | null;
	schedule: string | null;
	startsAt: string | null;
	endsAt: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateMedicationInput {
	tripId: number;
	companionId?: number | null;
	name: string;
	dosage?: string | null;
	schedule?: string | null;
	startsAt?: string | null;
	endsAt?: string | null;
	notes?: string | null;
}

function toMedication(row: Row<typeof tripMedications>, companionName: string | null = null): Medication {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		companionId: row.companion_id == null || row.companion_id === 0n ? null : num(row.companion_id),
		companionName,
		name: row.name,
		dosage: row.dosage,
		schedule: row.schedule,
		startsAt: nullableText(row.starts_at),
		endsAt: nullableText(row.ends_at),
		notes: row.notes,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}



export function listMedicationsForTrip(tripId: number): Medication[] {
	const rows = kit
		.selectFrom(tripMedications)
		.where(eq(tripMedications.trip_id, kitId(tripId)))
		.executeSync();
	if (rows.length === 0) return [];

	const companionIds = Array.from(
		new Set(
			rows
				.map((r) => r.companion_id)
				.filter((id): id is bigint => id != null && id !== 0n)
		)
	);
	const companions = companionIds.length
		? kit.selectFrom(tripCompanions).where(inList(tripCompanions.id, companionIds)).executeSync()
		: [];
	const nameMap = new Map(companions.map((c) => [c.id, c.name]));

	return rows
		.map((r) =>
			toMedication(
				r,
				r.companion_id != null && r.companion_id !== 0n
					? (nameMap.get(r.companion_id) ?? null)
					: null
			)
		)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getMedicationById(id: number): Medication | null {
	const rows = kit
		.selectFrom(tripMedications)
		.where(eq(tripMedications.id, kitId(id)))
		.executeSync();
	if (!rows[0]) return null;
	const row = rows[0];
	let companionName: string | null = null;
	if (row.companion_id != null && row.companion_id !== 0n) {
		const companion = kit
			.selectFrom(tripCompanions)
			.where(eq(tripCompanions.id, row.companion_id))
			.executeSync()[0];
		companionName = companion?.name ?? null;
	}
	return toMedication(row, companionName);
}

export function createMedication(input: CreateMedicationInput): Medication {
	const row = kit
		.insertInto(tripMedications)
		.values({
			trip_id: kitId(input.tripId),
			companion_id: nullableInt(input.companionId),
			name: input.name,
			dosage: input.dosage ?? null,
			schedule: input.schedule ?? null,
			starts_at: nullableText(input.startsAt),
			ends_at: nullableText(input.endsAt),
			notes: input.notes ?? null
		} as Insert<typeof tripMedications>)
		.executeSync();
	const med = toMedication(row);
	publishTripChanged(med.tripId);
	return med;
}

export function deleteMedication(id: number): number {
	const existing = getMedicationById(id);
	const deleted = kit
		.deleteFrom(tripMedications)
		.where(eq(tripMedications.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && existing) publishTripChanged(existing.tripId);
	return Number(deleted);
}

// ============================================================================
// Entry requirements
// ============================================================================

export type EntryRequirementType = 'visa' | 'vaccination' | 'other';
export type EntryRequirementStatus = 'needed' | 'in_progress' | 'complete' | 'not_needed';

export interface EntryRequirement {
	id: number;
	tripId: number;
	country: string;
	requirementType: EntryRequirementType;
	status: EntryRequirementStatus;
	dueDate: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateEntryRequirementInput {
	tripId: number;
	country: string;
	requirementType: EntryRequirementType;
	status?: EntryRequirementStatus;
	dueDate?: string | null;
	notes?: string | null;
}

export type UpdateEntryRequirementInput = Partial<
	Omit<CreateEntryRequirementInput, 'tripId' | 'country' | 'requirementType'>
>;

function toEntryRequirement(row: Row<typeof tripEntryRequirements>): EntryRequirement {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		country: row.country,
		requirementType: row.requirement_type as EntryRequirementType,
		status: row.status as EntryRequirementStatus,
		dueDate: nullableText(row.due_date),
		notes: row.notes,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}



export function listEntryRequirementsForTrip(tripId: number): EntryRequirement[] {
	const rows = kit
		.selectFrom(tripEntryRequirements)
		.where(eq(tripEntryRequirements.trip_id, kitId(tripId)))
		.orderBy(asc(tripEntryRequirements.country), asc(tripEntryRequirements.requirement_type))
		
		.executeSync();
	return rows.map(toEntryRequirement);
}

export function getEntryRequirementById(id: number): EntryRequirement | null {
	const rows = kit
		.selectFrom(tripEntryRequirements)
		.where(eq(tripEntryRequirements.id, kitId(id)))
		.executeSync();
	return rows[0] ? toEntryRequirement(rows[0]) : null;
}

export function createEntryRequirement(input: CreateEntryRequirementInput): EntryRequirement {
	const row = kit
		.insertInto(tripEntryRequirements)
		.values({
			trip_id: kitId(input.tripId),
			country: input.country,
			requirement_type: input.requirementType,
			status: input.status ?? 'needed',
			due_date: nullableText(input.dueDate),
			notes: input.notes ?? null
		} as Insert<typeof tripEntryRequirements>)
		.executeSync();
	const req = toEntryRequirement(row);
	publishTripChanged(req.tripId);
	return req;
}

export function updateEntryRequirement(
	id: number,
	patch: UpdateEntryRequirementInput
): EntryRequirement | null {
	const set: Update<typeof tripEntryRequirements> = {};
	if (patch.status !== undefined) set.status = patch.status;
	if (patch.dueDate !== undefined) set.due_date = nullableText(patch.dueDate);
	if (patch.notes !== undefined) set.notes = patch.notes ?? null;
	set.updated_at = nowIso();
	const updated = kit
		.updateTable(tripEntryRequirements)
		.set(set)
		.where(eq(tripEntryRequirements.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	const req = toEntryRequirement(row);
	publishTripChanged(req.tripId);
	return req;
}

export function deleteEntryRequirement(id: number): number {
	const existing = getEntryRequirementById(id);
	const deleted = kit
		.deleteFrom(tripEntryRequirements)
		.where(eq(tripEntryRequirements.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && existing) publishTripChanged(existing.tripId);
	return Number(deleted);
}

// ============================================================================
// Important items
// ============================================================================

export interface ImportantItem {
	id: number;
	tripId: number;
	companionId: number | null;
	companionName: string | null;
	name: string;
	serialNumber: string | null;
	trackerId: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateImportantItemInput {
	tripId: number;
	companionId?: number | null;
	name: string;
	serialNumber?: string | null;
	trackerId?: string | null;
	notes?: string | null;
}

function toImportantItem(
	row: Row<typeof tripImportantItems>,
	companionName: string | null = null
): ImportantItem {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		companionId:
			row.companion_id == null || row.companion_id === 0n ? null : num(row.companion_id),
		companionName,
		name: row.name,
		serialNumber: row.serial_number,
		trackerId: row.tracker_id,
		notes: row.notes,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}



export function listImportantItemsForTrip(tripId: number): ImportantItem[] {
	const rows = kit
		.selectFrom(tripImportantItems)
		.where(eq(tripImportantItems.trip_id, kitId(tripId)))
		.executeSync();
	if (rows.length === 0) return [];

	const companionIds = Array.from(
		new Set(
			rows
				.map((r) => r.companion_id)
				.filter((id): id is bigint => id != null && id !== 0n)
		)
	);
	const companions = companionIds.length
		? kit.selectFrom(tripCompanions).where(inList(tripCompanions.id, companionIds)).executeSync()
		: [];
	const nameMap = new Map(companions.map((c) => [c.id, c.name]));

	return rows
		.map((r) =>
			toImportantItem(
				r,
				r.companion_id != null && r.companion_id !== 0n
					? (nameMap.get(r.companion_id) ?? null)
					: null
			)
		)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getImportantItemById(id: number): ImportantItem | null {
	const rows = kit
		.selectFrom(tripImportantItems)
		.where(eq(tripImportantItems.id, kitId(id)))
		.executeSync();
	if (!rows[0]) return null;
	const row = rows[0];
	let companionName: string | null = null;
	if (row.companion_id != null && row.companion_id !== 0n) {
		const companion = kit
			.selectFrom(tripCompanions)
			.where(eq(tripCompanions.id, row.companion_id))
			.executeSync()[0];
		companionName = companion?.name ?? null;
	}
	return toImportantItem(row, companionName);
}

export function createImportantItem(input: CreateImportantItemInput): ImportantItem {
	const row = kit
		.insertInto(tripImportantItems)
		.values({
			trip_id: kitId(input.tripId),
			companion_id: nullableInt(input.companionId),
			name: input.name,
			serial_number: input.serialNumber ?? null,
			tracker_id: input.trackerId ?? null,
			notes: input.notes ?? null
		} as Insert<typeof tripImportantItems>)
		.executeSync();
	const item = toImportantItem(row);
	publishTripChanged(item.tripId);
	return item;
}

export function deleteImportantItem(id: number): number {
	const existing = getImportantItemById(id);
	const deleted = kit
		.deleteFrom(tripImportantItems)
		.where(eq(tripImportantItems.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && existing) publishTripChanged(existing.tripId);
	return Number(deleted);
}
