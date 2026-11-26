import {
	eq,
	inList,
	desc,
	asc,
	type Row,
	type Insert,
	type Update
} from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import {
	tripChecklists,
	tripChecklistItems,
	tripJournalEntries,
	tripDocumentLinks,
	tripCompanions
} from '$lib/server/db/mongrelSchema';
import { nowIso } from '$lib/server/tz';
import { publishTripChanged } from '$lib/server/eventBus';
import { toBigInt as kitId, idFromBigInt as num, optionalBigInt as nullableInt } from './kitHelpers';

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





export function getChecklistByTripId(tripId: number): Checklist | null {
	const rows = kit
		.selectFrom(tripChecklists)
		.where(eq(tripChecklists.trip_id, kitId(tripId)))
		.executeSync();
	return rows[0] ? toChecklist(rows[0]) : null;
}

export function createChecklist(tripId: number): Checklist {
	const row = kit
		.insertInto(tripChecklists)
		.values({ trip_id: kitId(tripId) } as Insert<typeof tripChecklists>)
		.executeSync();
	return toChecklist(row);
}

export function getOrCreateChecklist(tripId: number): Checklist {
	const existing = getChecklistByTripId(tripId);
	if (existing) return existing;
	return createChecklist(tripId);
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

export interface CreateChecklistItemInput {
	checklistId: number;
	text: string;
	assignedToCompanionId?: number | null;
}

export type UpdateChecklistItemInput = Partial<
	Omit<CreateChecklistItemInput, 'checklistId'> & { packed?: boolean }
>;

export function createChecklistItem(input: CreateChecklistItemInput): ChecklistItem {
	const row = kit
		.insertInto(tripChecklistItems)
		.values({
			checklist_id: kitId(input.checklistId),
			text: input.text,
			packed: false,
			assigned_to_companion_id: nullableInt(input.assignedToCompanionId)
		} as Insert<typeof tripChecklistItems>)
		.executeSync();
	const item = toChecklistItem(row);
	const tripId = checklistTripId(item.checklistId);
	if (tripId != null) publishTripChanged(tripId);
	return item;
}

export function updateChecklistItem(
	id: number,
	patch: UpdateChecklistItemInput
): ChecklistItem | null {
	const set: Update<typeof tripChecklistItems> = {};
	if (patch.text !== undefined) set.text = patch.text;
	if (patch.packed !== undefined) set.packed = patch.packed;
	if (patch.assignedToCompanionId !== undefined) {
		set.assigned_to_companion_id = nullableInt(patch.assignedToCompanionId);
	}
	const updated = kit
		.updateTable(tripChecklistItems)
		.set(set)
		.where(eq(tripChecklistItems.id, kitId(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	const item = toChecklistItem(row);
	const tripId = checklistTripId(item.checklistId);
	if (tripId != null) publishTripChanged(tripId);
	return item;
}

export function deleteChecklistItem(id: number): number {
	const tripId = getChecklistItemTripId(id);
	const deleted = kit
		.deleteFrom(tripChecklistItems)
		.where(eq(tripChecklistItems.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && tripId != null) publishTripChanged(tripId);
	return Number(deleted);
}

function checklistTripId(checklistId: number): number | null {
	const checklist = kit
		.selectFrom(tripChecklists)
		.where(eq(tripChecklists.id, kitId(checklistId)))
		.executeSync()[0];
	if (!checklist) return null;
	return Number(checklist.trip_id);
}

export function getChecklistItemTripId(itemId: number): number | null {
	const item = kit
		.selectFrom(tripChecklistItems)
		.where(eq(tripChecklistItems.id, kitId(itemId)))
		.executeSync()[0];
	if (!item) return null;
	return checklistTripId(Number(item.checklist_id));
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
	const row = kit
		.insertInto(tripJournalEntries)
		.values({
			trip_id: kitId(input.tripId),
			entry_date: input.entryDate,
			title: input.title,
			body: input.body
		} as Insert<typeof tripJournalEntries>)
		.executeSync();
	const entry = toJournalEntry(row);
	publishTripChanged(entry.tripId);
	return entry;
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
	const entry = toJournalEntry(row);
	publishTripChanged(entry.tripId);
	return entry;
}

export function deleteJournalEntry(id: number): number {
	const existing = getJournalEntryById(id);
	const deleted = kit
		.deleteFrom(tripJournalEntries)
		.where(eq(tripJournalEntries.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && existing) publishTripChanged(existing.tripId);
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
	const row = kit
		.insertInto(tripDocumentLinks)
		.values({
			trip_id: kitId(input.tripId),
			label: input.label,
			url: input.url,
			notes: input.notes ?? null
		} as Insert<typeof tripDocumentLinks>)
		.executeSync();
	const link = toDocumentLink(row);
	publishTripChanged(link.tripId);
	return link;
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
	const link = toDocumentLink(row);
	publishTripChanged(link.tripId);
	return link;
}

export function deleteDocumentLink(id: number): number {
	const existing = getDocumentLinkById(id);
	const deleted = kit
		.deleteFrom(tripDocumentLinks)
		.where(eq(tripDocumentLinks.id, kitId(id)))
		.executeSync();
	if (Number(deleted) > 0 && existing) publishTripChanged(existing.tripId);
	return Number(deleted);
}

export * from './tripPrepRepo';
