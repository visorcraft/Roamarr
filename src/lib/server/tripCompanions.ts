import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { withTripAction } from '$lib/server/actions';
import { db } from '$lib/server/db';
import { tripCompanions, COMPANION_CATEGORIES, type CompanionCategory } from '$lib/server/db/schema';
import { requireEditableTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
import { bumpTripUpdatedAt } from './tz';

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

const SEAT_PREFERENCES = ['aisle', 'window', 'middle', 'none'] as const;
const BED_PREFERENCES = ['king', 'queen', 'twin', 'two_doubles', 'other'] as const;

interface CompanionInput {
	name: string;
	category?: CompanionCategory;
	notes?: string;
	dietary?: string;
	allergies?: string;
	medicalNotes?: string;
	needsCarSeat?: boolean;
	needsStroller?: boolean;
	needsCrib?: boolean;
	needsKidsMeal?: boolean;
	childTicketDiscount?: string;
	seatPreference?: string | null;
	bedPreference?: string | null;
	accessibilityNeeds?: string;
	roomNotes?: string;
}

function booleanFromForm(raw: FormDataEntryValue | null): boolean {
	if (raw == null) return false;
	const s = String(raw).trim();
	return s === 'true' || s === 'on' || s === '1';
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
	const dietary = v.optionalString(String(form.get('dietary') ?? ''), 'dietary', { max: 1000 });
	const allergies = v.optionalString(String(form.get('allergies') ?? ''), 'allergies', { max: 1000 });
	const medicalNotes = v.optionalString(String(form.get('medicalNotes') ?? ''), 'medicalNotes', {
		max: 1000
	});
	const needsCarSeat = booleanFromForm(form.get('needsCarSeat'));
	const needsStroller = booleanFromForm(form.get('needsStroller'));
	const needsCrib = booleanFromForm(form.get('needsCrib'));
	const needsKidsMeal = booleanFromForm(form.get('needsKidsMeal'));
	const childTicketDiscount = v.optionalString(
		String(form.get('childTicketDiscount') ?? ''),
		'childTicketDiscount',
		{ max: 200 }
	);
	const seatPreferenceRaw = form.get('seatPreference');
	const seatPreference =
		seatPreferenceRaw && String(seatPreferenceRaw).trim()
			? (v.enumValue(String(seatPreferenceRaw).trim(), SEAT_PREFERENCES as readonly string[], 'seatPreference') ?? null)
			: null;
	const bedPreferenceRaw = form.get('bedPreference');
	const bedPreference =
		bedPreferenceRaw && String(bedPreferenceRaw).trim()
			? (v.enumValue(String(bedPreferenceRaw).trim(), BED_PREFERENCES as readonly string[], 'bedPreference') ?? null)
			: null;
	const accessibilityNeeds = v.optionalString(
		String(form.get('accessibilityNeeds') ?? ''),
		'accessibilityNeeds',
		{ max: 1000 }
	);
	const roomNotes = v.optionalString(String(form.get('roomNotes') ?? ''), 'roomNotes', { max: 1000 });
	if (!v.ok()) {
		return {
			name: name ?? '',
			category,
			notes,
			dietary,
			allergies,
			medicalNotes,
			needsCarSeat,
			needsStroller,
			needsCrib,
			needsKidsMeal,
			childTicketDiscount,
			seatPreference,
			bedPreference,
			accessibilityNeeds,
			roomNotes,
			errors: v.errors
		};
	}
	return {
		name: name!,
		category,
		notes,
		dietary,
		allergies,
		medicalNotes,
		needsCarSeat,
		needsStroller,
		needsCrib,
		needsKidsMeal,
		childTicketDiscount,
		seatPreference,
		bedPreference,
		accessibilityNeeds,
		roomNotes
	};
}

export function insertTripCompanion(userId: number, tripId: number, input: CompanionInput) {
	requireEditableTrip(userId, tripId);
	const c = db
		.insert(tripCompanions)
		.values({
			tripId,
			name: input.name,
			category: input.category,
			notes: input.notes ?? null,
			dietary: input.dietary ?? null,
			allergies: input.allergies ?? null,
			medicalNotes: input.medicalNotes ?? null,
			needsCarSeat: input.needsCarSeat ?? false,
			needsStroller: input.needsStroller ?? false,
			needsCrib: input.needsCrib ?? false,
			needsKidsMeal: input.needsKidsMeal ?? false,
			childTicketDiscount: input.childTicketDiscount ?? null,
			seatPreference: input.seatPreference ?? null,
			bedPreference: input.bedPreference ?? null,
			accessibilityNeeds: input.accessibilityNeeds ?? null,
			roomNotes: input.roomNotes ?? null
		})
		.returning()
		.get();
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'create', 'trip_companion', c.id, { tripId, name: c.name });
	return c;
}

function nullablePatchField(value: string | undefined): string | null | undefined {
	return value === undefined ? undefined : (value ?? null);
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
			notes: nullablePatchField(input.notes),
			dietary: nullablePatchField(input.dietary),
			allergies: nullablePatchField(input.allergies),
			medicalNotes: nullablePatchField(input.medicalNotes),
			needsCarSeat: input.needsCarSeat,
			needsStroller: input.needsStroller,
			needsCrib: input.needsCrib,
			needsKidsMeal: input.needsKidsMeal,
			childTicketDiscount: nullablePatchField(input.childTicketDiscount),
			seatPreference: input.seatPreference,
			bedPreference: input.bedPreference,
			accessibilityNeeds: nullablePatchField(input.accessibilityNeeds),
			roomNotes: nullablePatchField(input.roomNotes)
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
	const { user: u, tripId, formData: form } = await withTripAction(event);
	const input = validateCompanionInput(form);
	if (input.errors) {
		return fail(400, { error: 'Please fix the highlighted fields.', errors: input.errors });
	}
	insertTripCompanion(u.id, tripId, input);
	throw redirect(303, `/trips/${tripId}`);
}

export async function updateCompanion(event: RequestEvent) {
	const { user: u, tripId, formData: form } = await withTripAction(event);
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
	const { user: u, tripId, formData: form } = await withTripAction(event);
	const companionId = Number(form.get('companionId'));
	if (!Number.isFinite(companionId) || companionId <= 0) throw error(400, 'Invalid companion');
	removeTripCompanion(u.id, tripId, companionId);
	throw redirect(303, `/trips/${tripId}`);
}
