import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	getOrCreateChecklist as repoGetOrCreateChecklist,
	listItemsForChecklist,
	createChecklistItem,
	updateChecklistItem,
	deleteChecklistItem as repoDeleteChecklistItem,
	getChecklistItemTripId
} from './repositories/tripMiscRepo';
import { requireCompanionOnTrip, requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { Validator } from './validation';
import { parseTripId } from './params';

const ITEM_TEXT_MAX = 200;

interface ChecklistItem {
	id: number;
	text: string;
	packed: boolean;
	assignedToCompanionId: number | null;
	assignedToName: string | null;
	createdAt: string;
}

interface ChecklistWithItems {
	id: number;
	tripId: number;
	items: ChecklistItem[];
}

export function getOrCreateChecklist(tripId: number) {
	return repoGetOrCreateChecklist(tripId);
}

export function loadChecklist(tripId: number): ChecklistWithItems {
	const checklist = getOrCreateChecklist(tripId);
	const items = listItemsForChecklist(checklist.id);
	return { id: checklist.id, tripId, items };
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
	const item = createChecklistItem({
		checklistId: checklist.id,
		text: itemText!,
		assignedToCompanionId: companionId
	});
	logAudit(userId, 'checklist_item_add', 'trip_checklist_item', item.id, { tripId });
	return item;
}

export function toggleItem(userId: number, tripId: number, itemId: number) {
	requireEditableTrip(userId, tripId);
	const checklist = getOrCreateChecklist(tripId);
	const existing = listItemsForChecklist(checklist.id).find((i) => i.id === itemId);
	if (!existing) throw error(404, 'Item not found');
	const updated = updateChecklistItem(itemId, { packed: !existing.packed });
	if (!updated) throw error(404, 'Item not found');
	logAudit(userId, 'checklist_item_toggle', 'trip_checklist_item', itemId, {
		tripId,
		packed: updated.packed
	});
	return updated;
}

export function deleteItem(userId: number, tripId: number, itemId: number) {
	requireEditableTrip(userId, tripId);
	const checklist = getOrCreateChecklist(tripId);
	const existing = listItemsForChecklist(checklist.id).find((i) => i.id === itemId);
	if (!existing) throw error(404, 'Item not found');
	const deleted = repoDeleteChecklistItem(itemId);
	if (deleted === 0) throw error(404, 'Item not found');
	logAudit(userId, 'checklist_item_delete', 'trip_checklist_item', itemId, { tripId });
}

export function toggleItemById(userId: number, itemId: number) {
	const tripId = getChecklistItemTripId(itemId);
	if (tripId == null) throw error(404, 'Item not found');
	requireEditableTrip(userId, tripId);
	const checklist = getOrCreateChecklist(tripId);
	const existing = listItemsForChecklist(checklist.id).find((i) => i.id === itemId);
	if (!existing) throw error(404, 'Item not found');
	const updated = updateChecklistItem(itemId, { packed: !existing.packed });
	if (!updated) throw error(404, 'Item not found');
	logAudit(userId, 'checklist_item_toggle', 'trip_checklist_item', itemId, { tripId, packed: updated.packed });
	return updated;
}

export function deleteItemById(userId: number, itemId: number) {
	const tripId = getChecklistItemTripId(itemId);
	if (tripId == null) throw error(404, 'Item not found');
	requireEditableTrip(userId, tripId);
	const deleted = repoDeleteChecklistItem(itemId);
	if (deleted === 0) throw error(404, 'Item not found');
	logAudit(userId, 'checklist_item_delete', 'trip_checklist_item', itemId, { tripId });
}

export function setAllItemsPacked(userId: number, tripId: number, packed: boolean) {
	requireEditableTrip(userId, tripId);
	const checklist = getOrCreateChecklist(tripId);
	const items = listItemsForChecklist(checklist.id);
	for (const item of items) {
		updateChecklistItem(item.id, { packed });
	}
	logAudit(userId, 'checklist_set_all', 'trip_checklist', checklist.id, { tripId, packed });
}

export function renameItem(userId: number, itemId: number, text: string) {
	const validator = new Validator();
	const itemText = validator.requiredString(text, 'text', { max: ITEM_TEXT_MAX });
	if (!validator.ok()) throw error(400, validator.failMessage());
	const tripId = getChecklistItemTripId(itemId);
	if (tripId == null) throw error(404, 'Item not found');
	requireEditableTrip(userId, tripId);
	const updated = updateChecklistItem(itemId, { text: itemText! });
	if (!updated) throw error(404, 'Item not found');
	logAudit(userId, 'checklist_item_update', 'trip_checklist_item', itemId, { tripId });
	return updated;
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

export async function setAllChecklistItems({ locals, params, request }: RequestEvent) {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const packed = String((await request.formData()).get('packed')).trim() === 'true';
	setAllItemsPacked(u.id, tripId, packed);
	throw redirect(303, `/trips/${tripId}`);
}
