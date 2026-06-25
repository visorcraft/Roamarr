import { asc, eq } from 'drizzle-orm';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { tripCompanions, tripMedications } from './db/schema';
import { requireCompanionOnTrip } from './ownership';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';
import { tripCrudFactory } from './crud';

const medicationCrud = tripCrudFactory({
	table: tripMedications,
	auditEntity: 'trip_medication',
	orderBy: asc(tripMedications.name),
	list(tripId: number) {
		return db
			.select({
				id: tripMedications.id,
				tripId: tripMedications.tripId,
				companionId: tripMedications.companionId,
				companionName: tripCompanions.name,
				name: tripMedications.name,
				dosage: tripMedications.dosage,
				schedule: tripMedications.schedule,
				startsAt: tripMedications.startsAt,
				endsAt: tripMedications.endsAt,
				notes: tripMedications.notes,
				createdAt: tripMedications.createdAt,
				updatedAt: tripMedications.updatedAt
			})
			.from(tripMedications)
			.leftJoin(tripCompanions, eq(tripMedications.companionId, tripCompanions.id))
			.where(eq(tripMedications.tripId, tripId))
			.orderBy(tripMedications.name)
			.all();
	},
	validate(input: {
		name: string;
		companionId?: number | null;
		dosage?: string | null;
		schedule?: string | null;
		startsAt?: string | null;
		endsAt?: string | null;
		notes?: string | null;
	}) {
		const v = new Validator();
		v.requiredString(input.name, 'name', { max: 200 });
		v.optionalString(input.dosage, 'dosage', { max: 200 });
		v.optionalString(input.schedule, 'schedule', { max: 200 });
		v.optionalString(input.notes, 'notes', { max: 2000 });
		v.dateTime(input.startsAt, 'startsAt');
		v.dateTime(input.endsAt, 'endsAt');
		if (!v.ok()) throw error(400, v.failMessage());
	},
	buildInsert(input, tripId) {
		return {
			tripId,
			companionId: requireCompanionOnTrip(input.companionId, tripId),
			name: input.name.trim(),
			dosage: input.dosage?.trim() ?? null,
			schedule: input.schedule?.trim() ?? null,
			startsAt: input.startsAt?.trim() || null,
			endsAt: input.endsAt?.trim() || null,
			notes: input.notes?.trim() ?? null
		};
	}
});

export const listMedications = medicationCrud.list;
export const addMedication = medicationCrud.add;
export const deleteMedication = medicationCrud.remove;

export async function addMedicationAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const name = String(formData.get('name') || '');
	const companionIdRaw = formData.get('companionId');
	const companionId = companionIdRaw ? Number(companionIdRaw) : null;
	const dosage = String(formData.get('dosage') || '');
	const schedule = String(formData.get('schedule') || '');
	const startsAt = String(formData.get('startsAt') || '');
	const endsAt = String(formData.get('endsAt') || '');
	const notes = String(formData.get('notes') || '');
	addMedication(user.id, tripId, {
		name,
		companionId: companionId && Number.isFinite(companionId) ? companionId : null,
		dosage,
		schedule,
		startsAt,
		endsAt,
		notes
	});
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteMedicationAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const medicationIdResult = positiveIdFromForm(formData.get('medicationId'), 'medicationId');
	if (!medicationIdResult.ok) return fail(400, { error: medicationIdResult.error });
	deleteMedication(user.id, tripId, medicationIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
