import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	listMedicationsForTrip,
	createMedication as repoCreateMedication,
	deleteMedication as repoDeleteMedication,
	getMedicationById
} from './repositories/tripMiscRepo';
import { requireCompanionOnTrip, requireEditableTrip } from './ownership';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';
import { logAudit } from './audit';

export function listMedications(tripId: number) {
	return listMedicationsForTrip(tripId);
}

export function addMedication(
	userId: number,
	tripId: number,
	input: {
		name: string;
		companionId?: number | null;
		dosage?: string | null;
		schedule?: string | null;
		startsAt?: string | null;
		endsAt?: string | null;
		notes?: string | null;
	}
) {
	requireEditableTrip(userId, tripId);
	const v = new Validator();
	v.requiredString(input.name, 'name', { max: 200 });
	v.optionalString(input.dosage, 'dosage', { max: 200 });
	v.optionalString(input.schedule, 'schedule', { max: 200 });
	v.optionalString(input.notes, 'notes', { max: 2000 });
	v.dateTime(input.startsAt, 'startsAt');
	v.dateTime(input.endsAt, 'endsAt');
	if (!v.ok()) throw error(400, v.failMessage());

	const companionId = requireCompanionOnTrip(input.companionId, tripId);
	const med = repoCreateMedication({
		tripId,
		companionId,
		name: input.name.trim(),
		dosage: input.dosage?.trim() ?? null,
		schedule: input.schedule?.trim() ?? null,
		startsAt: input.startsAt?.trim() || null,
		endsAt: input.endsAt?.trim() || null,
		notes: input.notes?.trim() ?? null
	});
	logAudit(userId, 'create', 'trip_medication', med.id, { tripId });
	return med;
}

export function deleteMedication(userId: number, tripId: number, medicationId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getMedicationById(medicationId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Not found');
	repoDeleteMedication(medicationId);
	logAudit(userId, 'delete', 'trip_medication', medicationId, { tripId });
}

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
