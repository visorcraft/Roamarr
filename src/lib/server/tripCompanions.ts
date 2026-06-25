import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { tripCompanions, trips, COMPANION_CATEGORIES, type CompanionCategory } from '$lib/server/db/schema';
import { requireEditableTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';

function utcNow() {
	return DateTime.utc().toISO()!;
}

export function listTripCompanions(tripId: number) {
	return db
		.select()
		.from(tripCompanions)
		.where(eq(tripCompanions.tripId, tripId))
		.orderBy(tripCompanions.createdAt)
		.all();
}

function requireCompanion(tripId: number, companionId: number) {
	const c = db
		.select()
		.from(tripCompanions)
		.where(and(eq(tripCompanions.id, companionId), eq(tripCompanions.tripId, tripId)))
		.get();
	if (!c) throw error(404, 'Companion not found');
	return c;
}

function bumpTripUpdatedAt(tripId: number) {
	db.update(trips).set({ updatedAt: utcNow() }).where(eq(trips.id, tripId)).run();
}

interface CompanionInput {
	name: string;
	category?: CompanionCategory;
	notes?: string;
}

function validateCompanionInput(form: FormData): CompanionInput & { errors?: Record<string, string> } {
	const v = new Validator();
	const name = v.requiredString(String(form.get('name') ?? ''), 'name', { max: 255 });
	const rawCategory = form.get('category');
	const category =
		rawCategory == null || rawCategory === ''
			? 'adult'
			: (v.enumValue(String(rawCategory), COMPANION_CATEGORIES, 'category') ?? 'adult');
	const notes = v.optionalString(String(form.get('notes') ?? ''), 'notes', { max: 2000 });
	if (!v.ok()) {
		return { name: name ?? '', category, notes, errors: v.errors };
	}
	return { name: name!, category, notes };
}

export function insertTripCompanion(userId: number, tripId: number, input: CompanionInput) {
	requireEditableTrip(userId, tripId);
	const c = db
		.insert(tripCompanions)
		.values({
			tripId,
			name: input.name,
			category: input.category,
			notes: input.notes ?? null
		})
		.returning()
		.get();
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'create', 'trip_companion', c.id, { tripId, name: c.name });
	return c;
}

export function patchTripCompanion(
	userId: number,
	tripId: number,
	companionId: number,
	input: Partial<CompanionInput>
) {
	requireEditableTrip(userId, tripId);
	requireCompanion(tripId, companionId);
	const c = db
		.update(tripCompanions)
		.set({
			name: input.name,
			category: input.category,
			notes: input.notes === undefined ? undefined : (input.notes ?? null)
		})
		.where(eq(tripCompanions.id, companionId))
		.returning()
		.get();
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'update', 'trip_companion', companionId, { tripId });
	return c;
}

export function removeTripCompanion(userId: number, tripId: number, companionId: number) {
	requireEditableTrip(userId, tripId);
	requireCompanion(tripId, companionId);
	db.delete(tripCompanions)
		.where(and(eq(tripCompanions.id, companionId), eq(tripCompanions.tripId, tripId)))
		.run();
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'delete', 'trip_companion', companionId, { tripId });
}

export async function addCompanion(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	const form = await event.request.formData();
	const input = validateCompanionInput(form);
	if (input.errors) {
		return fail(400, { error: 'Please fix the highlighted fields.', errors: input.errors });
	}
	insertTripCompanion(u.id, tripId, input);
	throw redirect(303, `/trips/${tripId}`);
}

export async function updateCompanion(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	const form = await event.request.formData();
	const companionId = Number(form.get('companionId'));
	if (!Number.isFinite(companionId) || companionId <= 0) throw error(400, 'Invalid companion');
	const input = validateCompanionInput(form);
	if (input.errors) {
		return fail(400, { error: 'Please fix the highlighted fields.', errors: input.errors });
	}
	patchTripCompanion(u.id, tripId, companionId, input);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteCompanion(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	const form = await event.request.formData();
	const companionId = Number(form.get('companionId'));
	if (!Number.isFinite(companionId) || companionId <= 0) throw error(400, 'Invalid companion');
	removeTripCompanion(u.id, tripId, companionId);
	throw redirect(303, `/trips/${tripId}`);
}
