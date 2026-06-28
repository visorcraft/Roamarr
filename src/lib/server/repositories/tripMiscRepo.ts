import {
	eq,
	and,
	or,
	isNull,
	inList,
	desc,
	asc,
	type Row,
	type Insert,
	type Update
} from '@mongreldb/kit';
import { kit } from '$lib/server/db';
import {
	tripChecklists,
	tripChecklistItems,
	tripJournalEntries,
	tripDocumentLinks,
	tripHomeTasks,
	tripMedications,
	tripEntryRequirements,
	tripImportantItems,
	trips,
	tripCompanions,
	users
} from '$lib/server/db/mongrelSchema';
import { nowIso } from '$lib/server/tz';

// ============================================================================
// Helpers
// ============================================================================

function kitId(id: number): bigint {
	return BigInt(id);
}

function num(id: bigint): number {
	return Number(id);
}

function nullableTimestamp(value: string | null | undefined): string | null {
	return value == null || value === '' ? null : value;
}

function nullableDate(value: string | null | undefined): string | null {
	return value == null || value === '' ? null : value;
}

function nullableInt(value: number | null | undefined): bigint | null {
	if (value == null) return null;
	return BigInt(value);
}

function nullIntPredicate(column: typeof tripChecklistItems.assigned_to_companion_id) {
	return or(isNull(column), eq(column, 0n));
}

// ============================================================================
// Checklists
// ============================================================================

export interface Checklist {
	id: number;
	tripId: number;
	createdAt: string;
}

export interface ChecklistItem {
	id: number;
	checklistId: number;
	text: string;
	packed: boolean;
	assignedToCompanionId: number | null;
	createdAt: string;
}

export interface ChecklistItemWithName extends ChecklistItem {
	assignedToName: string | null;
}

export interface ChecklistWithItems extends Checklist {
	items: ChecklistItemWithName[];
}

export type UpdateChecklistInput = Partial<Pick<Checklist, 'tripId'>>;

function toChecklist(row: Row<typeof tripChecklists>): Checklist {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		createdAt: row.created_at
	};
}

function toChecklistItem(row: Row<typeof tripChecklistItems>): ChecklistItem {
	return {
		id: num(row.id),
		checklistId: num(row.checklist_id),
		text: row.text,
		packed: row.packed,
		assignedToCompanionId:
			row.assigned_to_companion_id == null || row.assigned_to_companion_id === 0n
				? null
					: num(row.assigned_to_companion_id),
		createdAt: row.created_at
	};
}





export function listChecklistsForTrip(tripId: number): Checklist[] {
	const rows = kit
		.selectFrom(tripChecklists)
		.where(eq(tripChecklists.trip_id, kitId(tripId)))
		.executeSync();
	return rows.map(toChecklist);
}

export function getChecklistById(id: number): Checklist | null {
	const rows = kit
		.selectFrom(tripChecklists)
		.where(eq(tripChecklists.id, kitId(id)))
		.executeSync();
	return rows[0] ? toChecklist(rows[0]) : null;
}

export function getChecklistByTripId(tripId: number): Checklist | null {
	const rows = kit
		.selectFrom(tripChecklists)
		.where(eq(tripChecklists.trip_id, kitId(tripId)))
		.executeSync();
	return rows[0] ? toChecklist(rows[0]) : null;
}

export function createChecklist(tripId: number): Checklist {
	(tripId);
	const row = kit
		.insertInto(tripChecklists)
		.values({ trip_id: kitId(tripId) } as Insert<typeof tripChecklists>)
		.executeSync();
	(row);
	return toChecklist(row);
}

export function getOrCreateChecklist(tripId: number): Checklist {
	const existing = getChecklistByTripId(tripId);
	if (existing) return existing;
	return createChecklist(tripId);
}

export function updateChecklist(id: number, patch: UpdateChecklistInput): Checklist | null {
	const set: Update<typeof tripChecklists> = {};
	if (patch.tripId !== undefined) set.trip_id = kitId(patch.tripId);
	const updated = kit
		.updateTable(tripChecklists)
		.set(set)
		.where(eq(tripChecklists.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toChecklist(row);
}

export function deleteChecklist(id: number): number {
	const deleted = kit
		.deleteFrom(tripChecklists)
		.where(eq(tripChecklists.id, kitId(id)))
		.executeSync();
	(id);
	return Number(deleted);
}

export function listItemsForChecklist(checklistId: number): ChecklistItemWithName[] {
	const rows = kit
		.selectFrom(tripChecklistItems)
		.where(eq(tripChecklistItems.checklist_id, kitId(checklistId)))
		.orderBy(asc(tripChecklistItems.created_at))
		.executeSync();
	if (rows.length === 0) return [];

	const companionIds = Array.from(
		new Set(
			rows
				.map((r) => r.assigned_to_companion_id)
				.filter((id): id is bigint => id != null && id !== 0n)
		)
	);
	const companions = companionIds.length
		? kit.selectFrom(tripCompanions).where(inList(tripCompanions.id, companionIds)).executeSync()
		: [];
	const nameMap = new Map(companions.map((c) => [c.id, c.name]));

	return rows.map((r) => ({
		...toChecklistItem(r),
		assignedToName:
			r.assigned_to_companion_id != null && r.assigned_to_companion_id !== 0n
				? (nameMap.get(r.assigned_to_companion_id) ?? null)
				: null
	}));
}

export function getChecklistItemById(id: number): ChecklistItem | null {
	const rows = kit
		.selectFrom(tripChecklistItems)
		.where(eq(tripChecklistItems.id, kitId(id)))
		.executeSync();
	return rows[0] ? toChecklistItem(rows[0]) : null;
}

export interface CreateChecklistItemInput {
	checklistId: number;
	text: string;
	assignedToCompanionId?: number | null;
}

export type UpdateChecklistItemInput = Partial<
	Omit<CreateChecklistItemInput, 'checklistId'> & { packed?: boolean }
>;

export function createChecklistItem(input: CreateChecklistItemInput): ChecklistItem {
	if (input.assignedToCompanionId != null) {
		(input.assignedToCompanionId);
	}
	const row = kit
		.insertInto(tripChecklistItems)
		.values({
			checklist_id: kitId(input.checklistId),
			text: input.text,
			packed: false,
			assigned_to_companion_id: nullableInt(input.assignedToCompanionId)
		} as Insert<typeof tripChecklistItems>)
		.executeSync();
	(row);
	return toChecklistItem(row);
}

export function updateChecklistItem(
	id: number,
	patch: UpdateChecklistItemInput
): ChecklistItem | null {
	const set: Update<typeof tripChecklistItems> = {};
	if (patch.text !== undefined) set.text = patch.text;
	if (patch.packed !== undefined) set.packed = patch.packed;
	if (patch.assignedToCompanionId !== undefined) {
		if (patch.assignedToCompanionId != null) (patch.assignedToCompanionId);
		set.assigned_to_companion_id = nullableInt(patch.assignedToCompanionId);
	}
	const updated = kit
		.updateTable(tripChecklistItems)
		.set(set)
		.where(eq(tripChecklistItems.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toChecklistItem(row);
}

export function deleteChecklistItem(id: number): number {
	const deleted = kit
		.deleteFrom(tripChecklistItems)
		.where(eq(tripChecklistItems.id, kitId(id)))
		.executeSync();
	(id);
	return Number(deleted);
}

// ============================================================================
// Journal entries
// ============================================================================

export interface JournalEntry {
	id: number;
	tripId: number;
	entryDate: string;
	title: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateJournalEntryInput {
	tripId: number;
	entryDate: string;
	title: string;
	body: string;
}

export type UpdateJournalEntryInput = Partial<Omit<CreateJournalEntryInput, 'tripId'>>;

function toJournalEntry(row: Row<typeof tripJournalEntries>): JournalEntry {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		entryDate: row.entry_date,
		title: row.title,
		body: row.body,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}



export function listJournalEntriesForTrip(tripId: number): JournalEntry[] {
	const rows = kit
		.selectFrom(tripJournalEntries)
		.where(eq(tripJournalEntries.trip_id, kitId(tripId)))
		.orderBy(
			desc(tripJournalEntries.entry_date),
			desc(tripJournalEntries.created_at),
			desc(tripJournalEntries.id)
		)
		.executeSync();
	return rows.map(toJournalEntry);
}

export function getJournalEntryById(id: number): JournalEntry | null {
	const rows = kit
		.selectFrom(tripJournalEntries)
		.where(eq(tripJournalEntries.id, kitId(id)))
		.executeSync();
	return rows[0] ? toJournalEntry(rows[0]) : null;
}

export function createJournalEntry(input: CreateJournalEntryInput): JournalEntry {
	(input.tripId);
	const row = kit
		.insertInto(tripJournalEntries)
		.values({
			trip_id: kitId(input.tripId),
			entry_date: input.entryDate,
			title: input.title,
			body: input.body
		} as Insert<typeof tripJournalEntries>)
		.executeSync();
	(row);
	return toJournalEntry(row);
}

export function updateJournalEntry(
	id: number,
	patch: UpdateJournalEntryInput
): JournalEntry | null {
	const set: Update<typeof tripJournalEntries> = {};
	if (patch.entryDate !== undefined) set.entry_date = patch.entryDate;
	if (patch.title !== undefined) set.title = patch.title;
	if (patch.body !== undefined) set.body = patch.body;
	set.updated_at = nowIso();
	const updated = kit
		.updateTable(tripJournalEntries)
		.set(set)
		.where(eq(tripJournalEntries.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toJournalEntry(row);
}

export function deleteJournalEntry(id: number): number {
	const deleted = kit
		.deleteFrom(tripJournalEntries)
		.where(eq(tripJournalEntries.id, kitId(id)))
		.executeSync();
	(id);
	return Number(deleted);
}

// ============================================================================
// Document links
// ============================================================================

export interface DocumentLink {
	id: number;
	tripId: number;
	label: string;
	url: string;
	notes: string | null;
	createdAt: string;
}

export interface CreateDocumentLinkInput {
	tripId: number;
	label: string;
	url: string;
	notes?: string | null;
}

export type UpdateDocumentLinkInput = Partial<Omit<CreateDocumentLinkInput, 'tripId'>>;

function toDocumentLink(row: Row<typeof tripDocumentLinks>): DocumentLink {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		label: row.label,
		url: row.url,
		notes: row.notes,
		createdAt: row.created_at
	};
}



export function listDocumentLinksForTrip(tripId: number): DocumentLink[] {
	const rows = kit
		.selectFrom(tripDocumentLinks)
		.where(eq(tripDocumentLinks.trip_id, kitId(tripId)))
		.orderBy(desc(tripDocumentLinks.created_at), desc(tripDocumentLinks.id))
		.executeSync();
	return rows.map(toDocumentLink);
}

export function getDocumentLinkById(id: number): DocumentLink | null {
	const rows = kit
		.selectFrom(tripDocumentLinks)
		.where(eq(tripDocumentLinks.id, kitId(id)))
		.executeSync();
	return rows[0] ? toDocumentLink(rows[0]) : null;
}

export function createDocumentLink(input: CreateDocumentLinkInput): DocumentLink {
	(input.tripId);
	const row = kit
		.insertInto(tripDocumentLinks)
		.values({
			trip_id: kitId(input.tripId),
			label: input.label,
			url: input.url,
			notes: input.notes ?? null
		} as Insert<typeof tripDocumentLinks>)
		.executeSync();
	(row);
	return toDocumentLink(row);
}

export function updateDocumentLink(
	id: number,
	patch: UpdateDocumentLinkInput
): DocumentLink | null {
	const set: Update<typeof tripDocumentLinks> = {};
	if (patch.label !== undefined) set.label = patch.label;
	if (patch.url !== undefined) set.url = patch.url;
	if (patch.notes !== undefined) set.notes = patch.notes ?? null;
	const updated = kit
		.updateTable(tripDocumentLinks)
		.set(set)
		.where(eq(tripDocumentLinks.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toDocumentLink(row);
}

export function deleteDocumentLink(id: number): number {
	const deleted = kit
		.deleteFrom(tripDocumentLinks)
		.where(eq(tripDocumentLinks.id, kitId(id)))
		.executeSync();
	(id);
	return Number(deleted);
}

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
		dueDate: nullableDate(row.due_date),
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
	(input.tripId);
	const row = kit
		.insertInto(tripHomeTasks)
		.values({
			trip_id: kitId(input.tripId),
			text: input.text,
			due_date: nullableDate(input.dueDate),
			done: false,
			sort_order: 0n
		} as Insert<typeof tripHomeTasks>)
		.executeSync();
	(row);
	return toHomeTask(row);
}

export function updateHomeTask(id: number, patch: UpdateHomeTaskInput): HomeTask | null {
	const set: Update<typeof tripHomeTasks> = {};
	if (patch.text !== undefined) set.text = patch.text;
	if (patch.dueDate !== undefined) set.due_date = nullableDate(patch.dueDate);
	if (patch.done !== undefined) set.done = patch.done;
	if (patch.sortOrder !== undefined) set.sort_order = BigInt(patch.sortOrder);
	const updated = kit
		.updateTable(tripHomeTasks)
		.set(set)
		.where(eq(tripHomeTasks.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toHomeTask(row);
}

export function deleteHomeTask(id: number): number {
	const deleted = kit
		.deleteFrom(tripHomeTasks)
		.where(eq(tripHomeTasks.id, kitId(id)))
		.executeSync();
	(id);
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

export type UpdateMedicationInput = Partial<Omit<CreateMedicationInput, 'tripId'>>;

function toMedication(row: Row<typeof tripMedications>, companionName: string | null = null): Medication {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		companionId: row.companion_id == null || row.companion_id === 0n ? null : num(row.companion_id),
		companionName,
		name: row.name,
		dosage: row.dosage,
		schedule: row.schedule,
		startsAt: nullableTimestamp(row.starts_at),
		endsAt: nullableTimestamp(row.ends_at),
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
	(input.tripId);
	if (input.companionId != null) (input.companionId);
	const row = kit
		.insertInto(tripMedications)
		.values({
			trip_id: kitId(input.tripId),
			companion_id: nullableInt(input.companionId),
			name: input.name,
			dosage: input.dosage ?? null,
			schedule: input.schedule ?? null,
			starts_at: nullableTimestamp(input.startsAt),
			ends_at: nullableTimestamp(input.endsAt),
			notes: input.notes ?? null
		} as Insert<typeof tripMedications>)
		.executeSync();
	(row);
	return toMedication(row);
}

export function updateMedication(id: number, patch: UpdateMedicationInput): Medication | null {
	const set: Update<typeof tripMedications> = {};
	if (patch.companionId !== undefined) {
		if (patch.companionId != null) (patch.companionId);
		set.companion_id = nullableInt(patch.companionId);
	}
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.dosage !== undefined) set.dosage = patch.dosage ?? null;
	if (patch.schedule !== undefined) set.schedule = patch.schedule ?? null;
	if (patch.startsAt !== undefined) set.starts_at = nullableTimestamp(patch.startsAt);
	if (patch.endsAt !== undefined) set.ends_at = nullableTimestamp(patch.endsAt);
	if (patch.notes !== undefined) set.notes = patch.notes ?? null;
	set.updated_at = nowIso();
	const updated = kit
		.updateTable(tripMedications)
		.set(set)
		.where(eq(tripMedications.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toMedication(row);
}

export function deleteMedication(id: number): number {
	const deleted = kit
		.deleteFrom(tripMedications)
		.where(eq(tripMedications.id, kitId(id)))
		.executeSync();
	(id);
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
		dueDate: nullableDate(row.due_date),
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
	(input.tripId);
	const row = kit
		.insertInto(tripEntryRequirements)
		.values({
			trip_id: kitId(input.tripId),
			country: input.country,
			requirement_type: input.requirementType,
			status: input.status ?? 'needed',
			due_date: nullableDate(input.dueDate),
			notes: input.notes ?? null
		} as Insert<typeof tripEntryRequirements>)
		.executeSync();
	(row);
	return toEntryRequirement(row);
}

export function updateEntryRequirement(
	id: number,
	patch: UpdateEntryRequirementInput
): EntryRequirement | null {
	const set: Update<typeof tripEntryRequirements> = {};
	if (patch.status !== undefined) set.status = patch.status;
	if (patch.dueDate !== undefined) set.due_date = nullableDate(patch.dueDate);
	if (patch.notes !== undefined) set.notes = patch.notes ?? null;
	set.updated_at = nowIso();
	const updated = kit
		.updateTable(tripEntryRequirements)
		.set(set)
		.where(eq(tripEntryRequirements.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toEntryRequirement(row);
}

export function deleteEntryRequirement(id: number): number {
	const deleted = kit
		.deleteFrom(tripEntryRequirements)
		.where(eq(tripEntryRequirements.id, kitId(id)))
		.executeSync();
	(id);
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

export type UpdateImportantItemInput = Partial<Omit<CreateImportantItemInput, 'tripId'>>;

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
	(input.tripId);
	if (input.companionId != null) (input.companionId);
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
	(row);
	return toImportantItem(row);
}

export function updateImportantItem(
	id: number,
	patch: UpdateImportantItemInput
): ImportantItem | null {
	const set: Update<typeof tripImportantItems> = {};
	if (patch.companionId !== undefined) {
		if (patch.companionId != null) (patch.companionId);
		set.companion_id = nullableInt(patch.companionId);
	}
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.serialNumber !== undefined) set.serial_number = patch.serialNumber ?? null;
	if (patch.trackerId !== undefined) set.tracker_id = patch.trackerId ?? null;
	if (patch.notes !== undefined) set.notes = patch.notes ?? null;
	set.updated_at = nowIso();
	const updated = kit
		.updateTable(tripImportantItems)
		.set(set)
		.where(eq(tripImportantItems.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	(row);
	return toImportantItem(row);
}

export function deleteImportantItem(id: number): number {
	const deleted = kit
		.deleteFrom(tripImportantItems)
		.where(eq(tripImportantItems.id, kitId(id)))
		.executeSync();
		return Number(deleted);
}
