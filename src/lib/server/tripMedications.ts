import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { tripCompanions, tripMedications } from './db/schema';
import { requireUser } from './auth';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { parseTripId } from './params';
import { Validator } from './validation';
import { nowIso } from './tz';

export function listMedications(tripId: number) {
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
	const name = v.requiredString(input.name, 'name', { max: 200 });
	const dosage = v.optionalString(input.dosage, 'dosage', { max: 200 });
	const schedule = v.optionalString(input.schedule, 'schedule', { max: 200 });
	const notes = v.optionalString(input.notes, 'notes', { max: 2000 });
	const startsAt = v.dateTime(input.startsAt, 'startsAt');
	const endsAt = v.dateTime(input.endsAt, 'endsAt');
	if (!v.ok()) throw error(400, v.failMessage());
	const companionId = requireCompanionOnTrip(input.companionId, tripId);
	const inserted = db
		.insert(tripMedications)
		.values({
			tripId,
			companionId,
			name: name!,
			dosage,
			schedule,
			startsAt: startsAt ?? null,
			endsAt: endsAt ?? null,
			notes
		})
		.returning()
		.get();
	logAudit(userId, 'create', 'trip_medication', inserted.id, { tripId });
	return inserted;
}

export function deleteMedication(userId: number, tripId: number, medicationId: number) {
	requireEditableTrip(userId, tripId);
	const result = db
		.delete(tripMedications)
		.where(and(eq(tripMedications.id, medicationId), eq(tripMedications.tripId, tripId)))
		.run();
	if (result.changes === 0) throw error(404, 'Medication not found');
	logAudit(userId, 'delete', 'trip_medication', medicationId, { tripId });
}

export async function addMedicationAction(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = parseTripId(event.params);
	const f = await event.request.formData();
	const name = String(f.get('name') || '');
	const companionIdRaw = f.get('companionId');
	const companionId = companionIdRaw ? Number(companionIdRaw) : null;
	const dosage = String(f.get('dosage') || '');
	const schedule = String(f.get('schedule') || '');
	const startsAt = String(f.get('startsAt') || '');
	const endsAt = String(f.get('endsAt') || '');
	const notes = String(f.get('notes') || '');
	addMedication(u.id, tripId, {
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
