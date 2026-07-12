import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq as kitEq, and as kitAnd, asc } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { tripCompanions } from '$lib/server/db/mongrelSchema';
import {
	COMPANION_CATEGORIES,
	SEAT_PREFERENCES,
	BED_PREFERENCES,
	type CompanionCategory
} from '$lib/server/db/mongrelSchema';
import { withTripAction } from '$lib/server/actions';
import { requireEditableTrip, requireOwnedTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
import { bumpTripUpdatedAt } from './tripUpdatedAt';
import { getUserByEmail, getUserById } from './repositories/usersRepo';
import { emailTripShare, parseSharePermission, validateShareEmail } from './tripSharing';
import { setFlash } from './flash';

export interface TripCompanion {
	id: number;
	tripId: number;
	userId: number | null;
	name: string;
	category: CompanionCategory;
	dietary: string | null;
	allergies: string | null;
	medicalNotes: string | null;
	needsCarSeat: boolean;
	needsStroller: boolean;
	needsCrib: boolean;
	needsKidsMeal: boolean;
	childTicketDiscount: string | null;
	seatPreference: string | null;
	bedPreference: string | null;
	accessibilityNeeds: string | null;
	roomNotes: string | null;
	notes: string | null;
	createdAt: string;
}

function toCompanion(row: Record<string, unknown>): TripCompanion {
	return {
		id: Number(row.id),
		tripId: Number(row.trip_id),
		userId: row.user_id == null ? null : Number(row.user_id),
		name: row.name as string,
		category: row.category as CompanionCategory,
		dietary: (row.dietary as string | null) ?? null,
		allergies: (row.allergies as string | null) ?? null,
		medicalNotes: (row.medical_notes as string | null) ?? null,
		needsCarSeat: Boolean(row.needs_car_seat),
		needsStroller: Boolean(row.needs_stroller),
		needsCrib: Boolean(row.needs_crib),
		needsKidsMeal: Boolean(row.needs_kids_meal),
		childTicketDiscount: (row.child_ticket_discount as string | null) ?? null,
		seatPreference: (row.seat_preference as string | null) ?? null,
		bedPreference: (row.bed_preference as string | null) ?? null,
		accessibilityNeeds: (row.accessibility_needs as string | null) ?? null,
		roomNotes: (row.room_notes as string | null) ?? null,
		notes: (row.notes as string | null) ?? null,
		createdAt: row.created_at as string
	};
}

export function listTripCompanions(tripId: number): TripCompanion[] {
	const rows = kit
		.selectFrom(tripCompanions)
		.where(kitEq(tripCompanions.trip_id, BigInt(tripId)))
		.orderBy(asc(tripCompanions.created_at))
		.executeSync();
	return rows.map(toCompanion);
}

export function getCompanionTripId(companionId: number): number | null {
	const c = kit
		.selectFrom(tripCompanions)
		.where(kitEq(tripCompanions.id, BigInt(companionId)))
		.executeSync()[0];
	return c ? Number(c.trip_id) : null;
}

function requireCompanion(tripId: number, companionId: number) {
	const c = kit
		.selectFrom(tripCompanions)
		.where(
			kitAnd(
				kitEq(tripCompanions.id, BigInt(companionId)),
				kitEq(tripCompanions.trip_id, BigInt(tripId))
			)
		)
		.executeSync()[0];
	if (!c) throw error(404, 'Companion not found');
	return toCompanion(c);
}

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

function buildCompanionValues(input: CompanionInput): Record<string, unknown> {
	return {
		name: input.name,
		category: input.category ?? 'adult',
		notes: input.notes ?? null,
		dietary: input.dietary ?? null,
		allergies: input.allergies ?? null,
		medical_notes: input.medicalNotes ?? null,
		needs_car_seat: input.needsCarSeat ?? false,
		needs_stroller: input.needsStroller ?? false,
		needs_crib: input.needsCrib ?? false,
		needs_kids_meal: input.needsKidsMeal ?? false,
		child_ticket_discount: input.childTicketDiscount ?? null,
		seat_preference: input.seatPreference ?? null,
		bed_preference: input.bedPreference ?? null,
		accessibility_needs: input.accessibilityNeeds ?? null,
		room_notes: input.roomNotes ?? null
	};
}

// Get-or-create the "self" companion that links a trip editor (typically the
// trip owner) to a row in trip_companions. Used by MCP tools that record
// owner-attributed actions (e.g. a poll vote by the trip owner without a
// separate companion row). The lookup keys on `user_id`, which is unique per
// (trip, user) at the schema level — this avoids the prior name-match approach
// that could silently hijack an existing companion who happened to share the
// user's display name, or collide across same-named editors on shared trips.
export function getOrCreateOwnerCompanion(userId: number, tripId: number) {
	const user = getUserById(userId);
	const name = user?.display_name ?? 'Trip owner';
	const existing = kit
		.selectFrom(tripCompanions)
		.where(
			kitAnd(
				kitEq(tripCompanions.trip_id, BigInt(tripId)),
				kitEq(tripCompanions.user_id, BigInt(userId))
			)
		)
		.executeSync()[0];
	if (existing) return toCompanion(existing);
	const inserted = kit
		.insertInto(tripCompanions)
		.values({
			trip_id: BigInt(tripId),
			user_id: BigInt(userId),
			name,
			category: 'adult'
		} as never)
		.executeSync();
	const companion = toCompanion(inserted);
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'create', 'trip_companion', companion.id, { tripId, name, self: true });
	return companion;
}

export function insertTripCompanion(userId: number, tripId: number, input: CompanionInput) {
	requireEditableTrip(userId, tripId);
	const c = kit
		.insertInto(tripCompanions)
		.values({ trip_id: BigInt(tripId), ...buildCompanionValues(input) } as never)
		.executeSync();
	const companion = toCompanion(c);
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'create', 'trip_companion', companion.id, { tripId, name: companion.name });
	return companion;
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
	const set: Record<string, unknown> = {};
	if (input.name !== undefined) set.name = input.name;
	if (input.category !== undefined) set.category = input.category;
	if (input.notes !== undefined) set.notes = nullablePatchField(input.notes);
	if (input.dietary !== undefined) set.dietary = nullablePatchField(input.dietary);
	if (input.allergies !== undefined) set.allergies = nullablePatchField(input.allergies);
	if (input.medicalNotes !== undefined) set.medical_notes = nullablePatchField(input.medicalNotes);
	if (input.needsCarSeat !== undefined) set.needs_car_seat = input.needsCarSeat;
	if (input.needsStroller !== undefined) set.needs_stroller = input.needsStroller;
	if (input.needsCrib !== undefined) set.needs_crib = input.needsCrib;
	if (input.needsKidsMeal !== undefined) set.needs_kids_meal = input.needsKidsMeal;
	if (input.childTicketDiscount !== undefined)
		set.child_ticket_discount = nullablePatchField(input.childTicketDiscount);
	if (input.seatPreference !== undefined) set.seat_preference = input.seatPreference;
	if (input.bedPreference !== undefined) set.bed_preference = input.bedPreference;
	if (input.accessibilityNeeds !== undefined)
		set.accessibility_needs = nullablePatchField(input.accessibilityNeeds);
	if (input.roomNotes !== undefined) set.room_notes = nullablePatchField(input.roomNotes);

	const rows = kit
		.updateTable(tripCompanions)
		.set(set as never)
		.where(kitEq(tripCompanions.id, BigInt(companionId)))
		.executeSync();
	const c = rows[0];
	if (!c) throw error(404, 'Companion not found');
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'update', 'trip_companion', companionId, { tripId });
	return toCompanion(c);
}

export function removeTripCompanion(userId: number, tripId: number, companionId: number) {
	requireEditableTrip(userId, tripId);
	requireCompanion(tripId, companionId);
	kit
		.deleteFrom(tripCompanions)
		.where(
			kitAnd(
				kitEq(tripCompanions.id, BigInt(companionId)),
				kitEq(tripCompanions.trip_id, BigInt(tripId))
			)
		)
		.executeSync();
	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'delete', 'trip_companion', companionId, { tripId });
}

export async function addCompanion(event: RequestEvent) {
	const { user: u, tripId, formData: form } = await withTripAction(event);
	const input = validateCompanionInput(form);
	if (input.errors) {
		return fail(400, { error: 'Please fix the highlighted fields.', errors: input.errors });
	}
	const selectedUserId = Number(form.get('selectedUserId'));
	if (Number.isInteger(selectedUserId) && selectedUserId > 0) {
		const selectedUser = getUserById(selectedUserId);
		if (!selectedUser || selectedUser.disabled) return fail(400, { error: 'Choose an active Roamarr user.', errors: {} });
		input.name = selectedUser.display_name || input.name;
	}
	const invite = String(form.get('invite')) === '1';
	let inviteEmail = '';
	const permission = parseSharePermission(form.get('permission'));
	if (invite) {
		if (input.category === 'guide' || input.category === 'driver') {
			return fail(400, { error: 'Guides and drivers cannot be invited to a trip.', errors: {} });
		}
		if (!permission) return fail(400, { error: 'Invalid permission', errors: {} });
		requireOwnedTrip(u.id, tripId);
		inviteEmail = validateShareEmail(String(form.get('email') ?? '')) ?? '';
		if (!inviteEmail) return fail(400, { error: 'Enter a valid email address.', errors: {} });
		const invitedUser = getUserByEmail(inviteEmail);
		if (invitedUser?.disabled) return fail(400, { error: 'That Roamarr user is disabled.', errors: {} });
		if (selectedUserId > 0 && Number(invitedUser?.id) !== selectedUserId) return fail(400, { error: 'The email does not match the selected Roamarr user.', errors: {} });
		if (invitedUser && selectedUserId === Number(invitedUser.id)) input.name = invitedUser.display_name || input.name;
	}
	const companion = insertTripCompanion(u.id, tripId, input);
	if (invite) {
		try {
			const result = await emailTripShare(u.id, tripId, inviteEmail, permission!, event.url.origin);
			setFlash(event.cookies, result.sent ? 'Person added and invitation sent.' : { message: 'Person added and access created, but SMTP is not configured or delivery failed.', variant: 'warning' });
		} catch (cause) {
			removeTripCompanion(u.id, tripId, companion.id);
			throw cause;
		}
	}
	throw redirect(303, `/trips/${tripId}#people`);
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
	throw redirect(303, `/trips/${tripId}#people`);
}
