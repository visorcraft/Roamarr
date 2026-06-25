import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from './db';
import { tripChecklists, tripChecklistItems, tripCompanions } from './db/schema';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { Validator } from './validation';

const ITEM_TEXT_MAX = 200;

export interface ChecklistItem {
	id: number;
	text: string;
	packed: boolean;
	assignedToCompanionId: number | null;
	assignedToName: string | null;
	createdAt: string;
}

export interface ChecklistWithItems {
	id: number;
	tripId: number;
	items: ChecklistItem[];
}

function getOrCreateChecklist(tripId: number) {
	const existing = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, tripId)).get();
	if (existing) return existing;
	return db.insert(tripChecklists).values({ tripId }).returning().get();
}

export function loadChecklist(tripId: number): ChecklistWithItems {
	const checklist = getOrCreateChecklist(tripId);
	const items = db
		.select({
			id: tripChecklistItems.id,
			text: tripChecklistItems.text,
			packed: tripChecklistItems.packed,
			assignedToCompanionId: tripChecklistItems.assignedToCompanionId,
			assignedToName: tripCompanions.name,
			createdAt: tripChecklistItems.createdAt
		})
		.from(tripChecklistItems)
		.leftJoin(tripCompanions, eq(tripChecklistItems.assignedToCompanionId, tripCompanions.id))
		.where(eq(tripChecklistItems.checklistId, checklist.id))
		.orderBy(tripChecklistItems.createdAt)
		.all();
	return { id: checklist.id, tripId, items };
}

function requireCompanionOnTrip(companionId: number | null | undefined, tripId: number) {
	if (companionId == null) return null;
	const c = db
		.select({ id: tripCompanions.id })
		.from(tripCompanions)
		.where(and(eq(tripCompanions.id, companionId), eq(tripCompanions.tripId, tripId)))
		.get();
	if (!c) throw error(400, 'Assigned companion is not on this trip');
	return companionId;
}

export function addItem(
	userId: number,
	tripId: number,
	text: string,
	assignedToCompanionId?: number | null
) {
	requireEditableTrip(userId, tripId);
	const validator = new Validator();
	const itemText = validator.requiredString(text, 'text', { max: ITEM_TEXT_MAX });
	if (!validator.ok()) throw error(400, validator.failMessage());
	const companionId = requireCompanionOnTrip(assignedToCompanionId, tripId);
	const checklist = getOrCreateChecklist(tripId);
	const item = db
		.insert(tripChecklistItems)
		.values({
			checklistId: checklist.id,
			text: itemText!,
			assignedToCompanionId: companionId
		})
		.returning()
		.get();
	logAudit(userId, 'checklist_item_add', 'trip_checklist_item', item.id, { tripId });
	return item;
}

export function toggleItem(userId: number, tripId: number, itemId: number) {
	requireEditableTrip(userId, tripId);
	const checklist = getOrCreateChecklist(tripId);
	const existing = db
		.select()
		.from(tripChecklistItems)
		.where(and(eq(tripChecklistItems.id, itemId), eq(tripChecklistItems.checklistId, checklist.id)))
		.get();
	if (!existing) throw error(404, 'Item not found');
	const updated = db
		.update(tripChecklistItems)
		.set({ packed: !existing.packed })
		.where(eq(tripChecklistItems.id, itemId))
		.returning()
		.get();
	logAudit(userId, 'checklist_item_toggle', 'trip_checklist_item', itemId, {
		tripId,
		packed: updated.packed
	});
	return updated;
}

export function deleteItem(userId: number, tripId: number, itemId: number) {
	requireEditableTrip(userId, tripId);
	const checklist = getOrCreateChecklist(tripId);
	const result = db
		.delete(tripChecklistItems)
		.where(and(eq(tripChecklistItems.id, itemId), eq(tripChecklistItems.checklistId, checklist.id)))
		.run();
	if (result.changes === 0) throw error(404, 'Item not found');
	logAudit(userId, 'checklist_item_delete', 'trip_checklist_item', itemId, { tripId });
}

function parseTripId(params: Record<string, string>) {
	const tripId = Number(params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	return tripId;
}

export async function addChecklistItem({ locals, params, request }: RequestEvent) {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const f = await request.formData();
	const text = String(f.get('text') || '');
	const assignedRaw = f.get('assignedToCompanionId');
	const assignedToCompanionId =
		assignedRaw && Number.isFinite(Number(assignedRaw)) ? Number(assignedRaw) : null;
	addItem(u.id, tripId, text, assignedToCompanionId);
	throw redirect(303, `/trips/${tripId}`);
}

export async function toggleChecklistItem({ locals, params, request }: RequestEvent) {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const itemId = Number((await request.formData()).get('itemId'));
	if (!Number.isFinite(itemId) || itemId <= 0) throw error(400, 'Invalid item');
	toggleItem(u.id, tripId, itemId);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteChecklistItem({ locals, params, request }: RequestEvent) {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const itemId = Number((await request.formData()).get('itemId'));
	if (!Number.isFinite(itemId) || itemId <= 0) throw error(400, 'Invalid item');
	deleteItem(u.id, tripId, itemId);
	throw redirect(303, `/trips/${tripId}`);
}
