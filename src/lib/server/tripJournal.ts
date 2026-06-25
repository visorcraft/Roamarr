import { desc, eq } from 'drizzle-orm';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { db } from './db';
import { tripJournalEntries } from './db/schema';
import { logAudit } from './audit';
import { requireEditableTrip } from './ownership';
import { Validator, formFail, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';

export function listJournalEntries(tripId: number) {
	return db
		.select()
		.from(tripJournalEntries)
		.where(eq(tripJournalEntries.tripId, tripId))
		.orderBy(desc(tripJournalEntries.entryDate), desc(tripJournalEntries.createdAt))
		.all();
}

export interface JournalEntryInput {
	entryDate: string;
	title: string;
	body: string;
}

function validateFields(input: Partial<JournalEntryInput>) {
	const v = new Validator();
	const entryDate = input.entryDate != null ? v.requiredDate(input.entryDate, 'entryDate') : undefined;
	const title =
		input.title != null ? v.requiredString(input.title, 'title', { max: 200 }) : undefined;
	const body = input.body != null ? v.requiredString(input.body, 'body', { max: 10000 }) : undefined;
	if (!v.ok()) {
		throw error(400, v.failMessage());
	}
	return { entryDate: entryDate!, title: title!, body: body! };
}

export function createJournalEntry(userId: number, tripId: number, input: JournalEntryInput) {
	const { entryDate, title, body } = validateFields(input);
	requireEditableTrip(userId, tripId);
	const entry = db
		.insert(tripJournalEntries)
		.values({ tripId, entryDate, title, body })
		.returning()
		.get();
	logAudit(userId, 'create', 'journal_entry', entry.id, { tripId, entryDate, title });
	return entry;
}

export function modifyJournalEntry(
	userId: number,
	entryId: number,
	input: Partial<JournalEntryInput>
) {
	const existing = db
		.select()
		.from(tripJournalEntries)
		.where(eq(tripJournalEntries.id, entryId))
		.get();
	if (!existing) throw error(404, 'Not found');
	const { entryDate, title, body } = validateFields({
		entryDate: input.entryDate ?? existing.entryDate,
		title: input.title ?? existing.title,
		body: input.body ?? existing.body
	});
	requireEditableTrip(userId, existing.tripId);
	const entry = db
		.update(tripJournalEntries)
		.set({ entryDate, title, body, updatedAt: DateTime.utc().toISO() })
		.where(eq(tripJournalEntries.id, entryId))
		.returning()
		.get();
	logAudit(userId, 'update', 'journal_entry', entry.id, { tripId: existing.tripId, entryDate, title });
	return entry;
}

export function removeJournalEntry(userId: number, entryId: number) {
	const existing = db
		.select()
		.from(tripJournalEntries)
		.where(eq(tripJournalEntries.id, entryId))
		.get();
	if (!existing) throw error(404, 'Not found');
	requireEditableTrip(userId, existing.tripId);
	db.delete(tripJournalEntries).where(eq(tripJournalEntries.id, entryId)).run();
	logAudit(userId, 'delete', 'journal_entry', entryId, { tripId: existing.tripId });
}

export async function addJournalEntry(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const v = new Validator();
	const entryDate = v.requiredDate(formData.get('entryDate'), 'entryDate');
	const title = v.requiredString(formData.get('title'), 'title', { max: 200 });
	const body = v.requiredString(formData.get('body'), 'body', { max: 10000 });
	if (!v.ok()) {
		return formFail(v);
	}
	createJournalEntry(user.id, tripId, {
		entryDate: entryDate!,
		title: title!,
		body: body!
	});
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteJournalEntry(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const entryIdResult = positiveIdFromForm(formData.get('entryId'), 'entryId');
	if (!entryIdResult.ok) return fail(400, { error: entryIdResult.error });
	removeJournalEntry(user.id, entryIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
