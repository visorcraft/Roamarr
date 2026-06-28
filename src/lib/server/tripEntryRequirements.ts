import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	listEntryRequirementsForTrip,
	createEntryRequirement as repoCreateEntryRequirement,
	updateEntryRequirement as repoUpdateEntryRequirement,
	deleteEntryRequirement as repoDeleteEntryRequirement,
	getEntryRequirementById
} from './repositories/tripMiscRepo';
import { requireEditableTrip } from './ownership';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';
import { ENTRY_REQUIREMENT_STATUSES, ENTRY_REQUIREMENT_TYPES } from './db/mongrelSchema';
import { logAudit } from './audit';

export function listEntryRequirements(tripId: number) {
	return listEntryRequirementsForTrip(tripId);
}

function validateCreate(input: {
	country: string;
	requirementType: string;
	status?: string;
	dueDate?: string | null;
	notes?: string | null;
}) {
	const v = new Validator();
	v.requiredString(input.country, 'country', { max: 100 });
	v.enumValue(input.requirementType, ENTRY_REQUIREMENT_TYPES as readonly string[], 'requirementType');
	v.enumValue(input.status ?? 'needed', ENTRY_REQUIREMENT_STATUSES as readonly string[], 'status');
	v.date(input.dueDate, 'dueDate');
	v.optionalString(input.notes, 'notes', { max: 2000 });
	if (!v.ok()) throw error(400, v.failMessage());
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
	validateCreate(input);
	const req = repoCreateEntryRequirement({
		tripId,
		country: input.country.trim(),
		requirementType: input.requirementType.trim() as 'visa' | 'vaccination' | 'other',
		status: (input.status?.trim() as 'needed' | 'in_progress' | 'complete' | 'not_needed') ?? 'needed',
		dueDate: input.dueDate?.trim() || null,
		notes: input.notes?.trim() ?? null
	});
	logAudit(userId, 'create', 'trip_entry_requirement', req.id, { tripId });
	return req;
}

function validateUpdate(input: { status: string }) {
	const v = new Validator();
	v.enumValue(input.status, ENTRY_REQUIREMENT_STATUSES as readonly string[], 'status');
	if (!v.ok()) throw error(400, v.failMessage());
}

export function updateEntryRequirementStatus(
	userId: number,
	tripId: number,
	requirementId: number,
	input: { status: string }
) {
	requireEditableTrip(userId, tripId);
	validateUpdate(input);
	const existing = getEntryRequirementById(requirementId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Not found');
	const updated = repoUpdateEntryRequirement(requirementId, { status: input.status.trim() as any });
	if (!updated) throw error(404, 'Not found');
	logAudit(userId, 'update_status', 'trip_entry_requirement', requirementId, { tripId });
	return updated;
}

export function deleteEntryRequirement(userId: number, tripId: number, requirementId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getEntryRequirementById(requirementId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Not found');
	repoDeleteEntryRequirement(requirementId);
	logAudit(userId, 'delete', 'trip_entry_requirement', requirementId, { tripId });
}

export async function addEntryRequirementAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const country = String(formData.get('country') || '');
	const requirementType = String(formData.get('requirementType') || '');
	const status = String(formData.get('status') || 'needed');
	const dueDate = String(formData.get('dueDate') || '') || null;
	const notes = String(formData.get('notes') || '');
	addEntryRequirement(user.id, tripId, { country, requirementType, status, dueDate, notes });
	throw redirect(303, `/trips/${tripId}`);
}

export async function updateEntryRequirementStatusAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const requirementIdResult = positiveIdFromForm(formData.get('requirementId'), 'requirementId');
	if (!requirementIdResult.ok) return fail(400, { error: requirementIdResult.error });
	const status = String(formData.get('status') || '');
	updateEntryRequirementStatus(user.id, tripId, requirementIdResult.value, { status });
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteEntryRequirementAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const requirementIdResult = positiveIdFromForm(formData.get('requirementId'), 'requirementId');
	if (!requirementIdResult.ok) return fail(400, { error: requirementIdResult.error });
	deleteEntryRequirement(user.id, tripId, requirementIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
