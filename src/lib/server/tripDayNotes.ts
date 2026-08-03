import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from '@visorcraft/mongreldb-kit';
import type { ColumnSpec, Insert, Row, Update } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { tripDayNotes } from '$lib/server/db/mongrelSchema';
import { ICON_PATHS, type IconName } from '$lib/icons';
import { logAudit } from './audit';
import { publishTripChanged } from './eventBus';
import { requireEditableTrip, requireViewableTrip } from './ownership';
import { Validator, formFail } from './validation';
import { withTripAction } from './actions';

const BODY_MAX = 10000;

export interface DayNote {
	id: number;
	tripId: number;
	/** Local trip day, YYYY-MM-DD. */
	date: string;
	icon: IconName | null;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export interface DayNoteInput {
	icon?: string | null;
	body: string;
}

function toDayNote(row: Row<typeof tripDayNotes>): DayNote {
	return {
		id: Number(row.id),
		tripId: Number(row.trip_id),
		date: row.date,
		icon: (row.icon as IconName | null) ?? null,
		body: row.body,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function validateDayNoteFields(date: unknown, input: DayNoteInput) {
	const v = new Validator();
	const validDate = v.requiredDate(date, 'date');
	const body = v.requiredString(input.body, 'body', { max: BODY_MAX });
	const icon = input.icon?.trim() || null;
	if (icon != null && !(icon in ICON_PATHS)) {
		v.addError('icon', 'icon must be a known icon name');
	}
	if (!v.ok()) throw error(400, v.failMessage());
	return { date: validDate!, body: body!, icon: icon as IconName | null };
}

function findDayNoteRow(tripId: number, date: string): Row<typeof tripDayNotes> | undefined {
	return kit
		.selectFrom(tripDayNotes)
		.where(and(eq(tripDayNotes.trip_id, BigInt(tripId)), eq(tripDayNotes.date, date)))
		.executeSync()[0];
}

// updateTable cannot clear a nullable column to NULL (see places.ts);
// delete + reinsert with the merged row instead.
function kitReinsertWithId(
	table: { id: ColumnSpec; columns: readonly ColumnSpec[] },
	existing: Record<string, unknown>,
	patch: Record<string, unknown>
): Record<string, unknown> {
	const updated = { ...existing, ...patch };
	kit.deleteFrom(table as never).where(eq(table.id, existing.id as bigint)).executeSync();
	return kit.insertInto(table as never).values(updated as Insert<never>).executeSync();
}

export function listDayNotes(userId: number, tripId: number): DayNote[] {
	requireViewableTrip(userId, tripId);
	return listDayNotesForTrip(tripId);
}

export function listDayNotesForTrip(tripId: number): DayNote[] {
	const rows = kit
		.selectFrom(tripDayNotes)
		.where(eq(tripDayNotes.trip_id, BigInt(tripId)))
		.executeSync();
	return rows.map(toDayNote).sort((a, b) => a.date.localeCompare(b.date));
}

export function getDayNote(userId: number, tripId: number, date: string): DayNote | null {
	requireViewableTrip(userId, tripId);
	const row = findDayNoteRow(tripId, date);
	return row ? toDayNote(row) : null;
}

/** Upsert the note for a trip day; (trip_id, date) is unique. */
export function setDayNote(userId: number, tripId: number, date: unknown, input: DayNoteInput): DayNote {
	const fields = validateDayNoteFields(date, input);
	requireEditableTrip(userId, tripId);
	const existing = findDayNoteRow(tripId, fields.date);
	if (existing) {
		let row: Row<typeof tripDayNotes>;
		if (fields.icon === null && existing.icon != null) {
			// Clearing the icon writes NULL, which updateTable cannot do.
			row = kitReinsertWithId(
				tripDayNotes,
				existing as Record<string, unknown>,
				{ icon: null, body: fields.body }
			) as Row<typeof tripDayNotes>;
		} else {
			// null icon here means "already null": only the body changes.
			const patch: Record<string, unknown> =
				fields.icon === null ? { body: fields.body } : { icon: fields.icon, body: fields.body };
			row = kit
				.updateTable(tripDayNotes)
				.set(patch as Update<typeof tripDayNotes>)
				.where(eq(tripDayNotes.id, existing.id))
				.executeSync()[0]!;
		}
		logAudit(userId, 'update', 'trip_day_note', Number(existing.id), { tripId, date: fields.date });
		publishTripChanged(tripId);
		return toDayNote(row);
	}
	const row = kit
		.insertInto(tripDayNotes)
		.values({
			trip_id: BigInt(tripId),
			date: fields.date,
			icon: fields.icon,
			body: fields.body
		} as Insert<typeof tripDayNotes>)
		.executeSync();
	logAudit(userId, 'create', 'trip_day_note', Number(row.id), { tripId, date: fields.date });
	publishTripChanged(tripId);
	return toDayNote(row);
}

export function deleteDayNote(userId: number, tripId: number, date: unknown): void {
	const v = new Validator();
	const validDate = v.requiredDate(date, 'date');
	if (!v.ok()) throw error(400, v.failMessage());
	requireEditableTrip(userId, tripId);
	const existing = findDayNoteRow(tripId, validDate!);
	if (!existing) throw error(404, 'Not found');
	kit.deleteFrom(tripDayNotes).where(eq(tripDayNotes.id, existing.id)).executeSync();
	logAudit(userId, 'delete', 'trip_day_note', Number(existing.id), { tripId, date: validDate });
	publishTripChanged(tripId);
}

export async function setDayNoteAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const v = new Validator();
	const date = v.requiredDate(formData.get('date'), 'date');
	const body = v.requiredString(formData.get('body'), 'body', { max: BODY_MAX });
	const icon = String(formData.get('icon') ?? '').trim() || null;
	if (icon != null && !(icon in ICON_PATHS)) {
		v.addError('icon', 'icon must be a known icon name');
	}
	if (!v.ok()) {
		return formFail(v);
	}
	setDayNote(user.id, tripId, date!, { icon, body: body! });
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteDayNoteAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	deleteDayNote(user.id, tripId, formData.get('date'));
	throw redirect(303, `/trips/${tripId}`);
}
