import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { tripCompanions, tripImportantItems } from './db/schema';
import { requireUser } from './auth';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { parseTripId } from './params';
import { Validator } from './validation';

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

function requireCompanionOnTrip(companionId: number | null | undefined, tripId: number) {
	if (companionId == null) return null;
	const c = db
		.select({ id: tripCompanions.id })
		.from(tripCompanions)
		.where(and(eq(tripCompanions.id, companionId), eq(tripCompanions.tripId, tripId)))
		.get();
	if (!c) throw error(400, 'Companion is not on this trip');
	return companionId;
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
	if (!v.ok()) throw error(400, v.failMessage());
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
	const result = db
		.delete(tripImportantItems)
		.where(and(eq(tripImportantItems.id, itemId), eq(tripImportantItems.tripId, tripId)))
		.run();
	if (result.changes === 0) throw error(404, 'Item not found');
	logAudit(userId, 'delete', 'trip_important_item', itemId, { tripId });
}

export async function addImportantItemAction(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = parseTripId(event.params);
	const f = await event.request.formData();
	const name = String(f.get('name') || '');
	const companionIdRaw = f.get('companionId');
	const companionId = companionIdRaw ? Number(companionIdRaw) : null;
	const serialNumber = String(f.get('serialNumber') || '');
	const trackerId = String(f.get('trackerId') || '');
	const notes = String(f.get('notes') || '');
	addImportantItem(u.id, tripId, {
		name,
		companionId: companionId && Number.isFinite(companionId) ? companionId : null,
		serialNumber,
		trackerId,
		notes
	});
	throw redirect(303, `/trips/${tripId}`);
}
