import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { tripEntryRequirements } from './db/schema';
import { requireEditableTrip, requireOwnedTripRow } from './ownership';
import { logAudit } from './audit';
import { Validator, formFail } from './validation';
import { withTripAction } from './actions';

export const REQUIREMENT_TYPES = ['visa', 'vaccination', 'other'] as const;
export const REQUIREMENT_STATUSES = ['needed', 'in_progress', 'complete', 'not_needed'] as const;

export function listEntryRequirements(tripId: number) {
	return db
		.select()
		.from(tripEntryRequirements)
		.where(eq(tripEntryRequirements.tripId, tripId))
		.orderBy(tripEntryRequirements.country, tripEntryRequirements.requirementType)
		.all();
}

export function addEntryRequirement(
	userId: number,
	tripId: number,
	input: {
		country: string;
		requirementType: string;
		status?: string;
		dueDate?: string | null;
		notes?: string | null;
	}
) {
	requireEditableTrip(userId, tripId);
	const v = new Validator();
	const country = v.requiredString(input.country, 'country', { max: 100 });
	const requirementType = v.enumValue(
		input.requirementType,
		REQUIREMENT_TYPES as readonly string[],
		'requirementType'
	);
	const status = v.enumValue(
		input.status ?? 'needed',
		REQUIREMENT_STATUSES as readonly string[],
		'status'
	);
	const dueDate = v.date(input.dueDate, 'dueDate');
	const notes = v.optionalString(input.notes, 'notes', { max: 2000 });
	if (!v.ok()) throw formFail(v);
	const inserted = db
		.insert(tripEntryRequirements)
		.values({
			tripId,
			country: country!,
			requirementType: requirementType!,
			status: status ?? 'needed',
			dueDate: dueDate ?? null,
			notes
		})
		.returning()
		.get();
	logAudit(userId, 'create', 'trip_entry_requirement', inserted.id, { tripId });
	return inserted;
}

export function updateEntryRequirementStatus(
	userId: number,
	tripId: number,
	requirementId: number,
	status: string
) {
	requireEditableTrip(userId, tripId);
	if (!REQUIREMENT_STATUSES.includes(status as (typeof REQUIREMENT_STATUSES)[number])) {
		const v = new Validator();
		v.addError('status', 'Invalid status');
		throw formFail(v);
	}
	requireOwnedTripRow(tripEntryRequirements, tripId, requirementId, 'Requirement not found');
	const updated = db
		.update(tripEntryRequirements)
		.set({ status })
		.where(eq(tripEntryRequirements.id, requirementId))
		.returning()
		.get();
	logAudit(userId, 'update_status', 'trip_entry_requirement', requirementId, { tripId, status });
	return updated;
}

export function deleteEntryRequirement(userId: number, tripId: number, requirementId: number) {
	requireEditableTrip(userId, tripId);
	requireOwnedTripRow(tripEntryRequirements, tripId, requirementId, 'Requirement not found');
	db.delete(tripEntryRequirements).where(eq(tripEntryRequirements.id, requirementId)).run();
	logAudit(userId, 'delete', 'trip_entry_requirement', requirementId, { tripId });
}

export async function addEntryRequirementAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const country = String(formData.get('country') || '');
	const requirementType = String(formData.get('requirementType') || '');
	const status = String(formData.get('status') || 'needed');
	const dueDateRaw = formData.get('dueDate');
	const dueDate = typeof dueDateRaw === 'string' && dueDateRaw ? dueDateRaw : null;
	const notes = String(formData.get('notes') || '');
	addEntryRequirement(user.id, tripId, { country, requirementType, status, dueDate, notes });
	throw redirect(303, `/trips/${tripId}`);
}
