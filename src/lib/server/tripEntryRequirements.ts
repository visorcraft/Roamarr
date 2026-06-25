import { asc, eq } from 'drizzle-orm';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { tripEntryRequirements } from './db/schema';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';
import { tripCrudFactory } from './crud';
import { ENTRY_REQUIREMENT_STATUSES, ENTRY_REQUIREMENT_TYPES } from './db/schema';

export const REQUIREMENT_TYPES = [...ENTRY_REQUIREMENT_TYPES] as const;
export const REQUIREMENT_STATUSES = [...ENTRY_REQUIREMENT_STATUSES] as const;

const entryRequirementCrud = tripCrudFactory({
	table: tripEntryRequirements,
	auditEntity: 'trip_entry_requirement',
	orderBy: [asc(tripEntryRequirements.country), asc(tripEntryRequirements.requirementType)],
	validate(input: {
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
	},
	buildInsert(input, tripId) {
		return {
			tripId,
			country: input.country.trim(),
			requirementType: input.requirementType.trim(),
			status: (input.status?.trim() as (typeof ENTRY_REQUIREMENT_STATUSES)[number]) ?? 'needed',
			dueDate: input.dueDate?.trim() || null,
			notes: input.notes?.trim() ?? null
		};
	},
	update: {
		validate(input: { status: string }) {
			const v = new Validator();
			v.enumValue(input.status, ENTRY_REQUIREMENT_STATUSES as readonly string[], 'status');
			if (!v.ok()) throw error(400, v.failMessage());
		},
		buildSet(input: { status: string }) {
			return { status: input.status.trim() };
		},
		action: 'update_status'
	}
});

export const listEntryRequirements = entryRequirementCrud.list;
export const addEntryRequirement = entryRequirementCrud.add;
export const updateEntryRequirementStatus = entryRequirementCrud.modify;
export const deleteEntryRequirement = entryRequirementCrud.remove;

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
