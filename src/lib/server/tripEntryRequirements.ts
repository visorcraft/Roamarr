import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { tripEntryRequirements } from './db/schema';
import { requireUser } from './auth';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { parseTripId } from './params';
import { Validator } from './validation';

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
	if (!v.ok()) throw error(400, v.failMessage());
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
		throw error(400, 'Invalid status');
	}
	const existing = db
		.select()
		.from(tripEntryRequirements)
		.where(and(eq(tripEntryRequirements.id, requirementId), eq(tripEntryRequirements.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Requirement not found');
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
	const result = db
		.delete(tripEntryRequirements)
		.where(and(eq(tripEntryRequirements.id, requirementId), eq(tripEntryRequirements.tripId, tripId)))
		.run();
	if (result.changes === 0) throw error(404, 'Requirement not found');
	logAudit(userId, 'delete', 'trip_entry_requirement', requirementId, { tripId });
}

export async function addEntryRequirementAction(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = parseTripId(event.params);
	const f = await event.request.formData();
	const country = String(f.get('country') || '');
	const requirementType = String(f.get('requirementType') || '');
	const status = String(f.get('status') || 'needed');
	const dueDateRaw = f.get('dueDate');
	const dueDate = typeof dueDateRaw === 'string' && dueDateRaw ? dueDateRaw : null;
	const notes = String(f.get('notes') || '');
	addEntryRequirement(u.id, tripId, { country, requirementType, status, dueDate, notes });
	throw redirect(303, `/trips/${tripId}`);
}
