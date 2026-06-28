import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	listImportantItemsForTrip,
	createImportantItem as repoCreateImportantItem,
	deleteImportantItem as repoDeleteImportantItem,
	getImportantItemById
} from './repositories/tripMiscRepo';
import { requireCompanionOnTrip, requireEditableTrip } from './ownership';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';
import { logAudit } from './audit';

export function listImportantItems(tripId: number) {
	return listImportantItemsForTrip(tripId);
}

export function addImportantItem(
	userId: number,
	tripId: number,
	input: {
		name: string;
		companionId?: number | null;
		serialNumber?: string | null;
		trackerId?: string | null;
		notes?: string | null;
	}
) {
	requireEditableTrip(userId, tripId);
	const v = new Validator();
	v.requiredString(input.name, 'name', { max: 200 });
	v.optionalString(input.serialNumber, 'serialNumber', { max: 200 });
	v.optionalString(input.trackerId, 'trackerId', { max: 200 });
	v.optionalString(input.notes, 'notes', { max: 2000 });
	if (!v.ok()) throw error(400, v.failMessage());

	const companionId = requireCompanionOnTrip(input.companionId, tripId);
	const item = repoCreateImportantItem({
		tripId,
		companionId,
		name: input.name.trim(),
		serialNumber: input.serialNumber?.trim() ?? null,
		trackerId: input.trackerId?.trim() ?? null,
		notes: input.notes?.trim() ?? null
	});
	logAudit(userId, 'create', 'trip_important_item', item.id, { tripId });
	return item;
}

export function deleteImportantItem(userId: number, tripId: number, itemId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getImportantItemById(itemId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Not found');
	repoDeleteImportantItem(itemId);
	logAudit(userId, 'delete', 'trip_important_item', itemId, { tripId });
}

export async function addImportantItemAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const name = String(formData.get('name') || '');
	const companionIdRaw = formData.get('companionId');
	const companionId = companionIdRaw ? Number(companionIdRaw) : null;
	const serialNumber = String(formData.get('serialNumber') || '');
	const trackerId = String(formData.get('trackerId') || '');
	const notes = String(formData.get('notes') || '');
	addImportantItem(user.id, tripId, {
		name,
		companionId: companionId && Number.isFinite(companionId) ? companionId : null,
		serialNumber,
		trackerId,
		notes
	});
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteImportantItemAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const itemIdResult = positiveIdFromForm(formData.get('itemId'), 'itemId');
	if (!itemIdResult.ok) return fail(400, { error: itemIdResult.error });
	deleteImportantItem(user.id, tripId, itemIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
