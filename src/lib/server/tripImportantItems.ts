import { redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { tripCompanions, tripImportantItems } from './db/schema';
import { requireEditableTrip, requireOwnedTripRow, requireCompanionOnTrip } from './ownership';
import { logAudit } from './audit';
import { Validator, formFail, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';

export function listImportantItems(tripId: number) {
	return db
		.select({
			id: tripImportantItems.id,
			tripId: tripImportantItems.tripId,
			companionId: tripImportantItems.companionId,
			companionName: tripCompanions.name,
			name: tripImportantItems.name,
			serialNumber: tripImportantItems.serialNumber,
			trackerId: tripImportantItems.trackerId,
			notes: tripImportantItems.notes,
			createdAt: tripImportantItems.createdAt,
			updatedAt: tripImportantItems.updatedAt
		})
		.from(tripImportantItems)
		.leftJoin(tripCompanions, eq(tripImportantItems.companionId, tripCompanions.id))
		.where(eq(tripImportantItems.tripId, tripId))
		.orderBy(tripImportantItems.name)
		.all();
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
	const name = v.requiredString(input.name, 'name', { max: 200 });
	const serialNumber = v.optionalString(input.serialNumber, 'serialNumber', { max: 200 });
	const trackerId = v.optionalString(input.trackerId, 'trackerId', { max: 200 });
	const notes = v.optionalString(input.notes, 'notes', { max: 2000 });
	if (!v.ok()) throw formFail(v);
	const companionId = requireCompanionOnTrip(input.companionId, tripId);
	const inserted = db
		.insert(tripImportantItems)
		.values({ tripId, companionId, name: name!, serialNumber, trackerId, notes })
		.returning()
		.get();
	logAudit(userId, 'create', 'trip_important_item', inserted.id, { tripId });
	return inserted;
}

export function deleteImportantItem(userId: number, tripId: number, itemId: number) {
	requireEditableTrip(userId, tripId);
	requireOwnedTripRow(tripImportantItems, tripId, itemId, 'Item not found');
	db.delete(tripImportantItems).where(eq(tripImportantItems.id, itemId)).run();
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
