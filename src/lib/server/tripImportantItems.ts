import { asc, eq } from 'drizzle-orm';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { tripCompanions, tripImportantItems } from './db/schema';
import { requireCompanionOnTrip } from './ownership';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';
import { tripCrudFactory } from './crud';

const importantItemCrud = tripCrudFactory({
	table: tripImportantItems,
	auditEntity: 'trip_important_item',
	orderBy: asc(tripImportantItems.name),
	list(tripId: number) {
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
	},
	validate(input: {
		name: string;
		companionId?: number | null;
		serialNumber?: string | null;
		trackerId?: string | null;
		notes?: string | null;
	}) {
		const v = new Validator();
		v.requiredString(input.name, 'name', { max: 200 });
		v.optionalString(input.serialNumber, 'serialNumber', { max: 200 });
		v.optionalString(input.trackerId, 'trackerId', { max: 200 });
		v.optionalString(input.notes, 'notes', { max: 2000 });
		if (!v.ok()) throw error(400, v.failMessage());
	},
	buildInsert(input, tripId) {
		return {
			tripId,
			companionId: requireCompanionOnTrip(input.companionId, tripId),
			name: input.name.trim(),
			serialNumber: input.serialNumber?.trim() ?? null,
			trackerId: input.trackerId?.trim() ?? null,
			notes: input.notes?.trim() ?? null
		};
	}
});

export const listImportantItems = importantItemCrud.list;
export const addImportantItem = importantItemCrud.add;
export const deleteImportantItem = importantItemCrud.remove;

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
