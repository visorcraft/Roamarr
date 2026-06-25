import { redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { tripHomeTasks } from './db/schema';
import { requireEditableTrip, requireOwnedTripRow } from './ownership';
import { logAudit } from './audit';
import { Validator, formFail } from './validation';
import { withTripAction } from './actions';

export function listHomeTasks(tripId: number) {
	return db
		.select()
		.from(tripHomeTasks)
		.where(eq(tripHomeTasks.tripId, tripId))
		.orderBy(tripHomeTasks.sortOrder, tripHomeTasks.createdAt)
		.all();
}

export function addHomeTask(
	userId: number,
	tripId: number,
	input: { text: string; dueDate?: string | null }
) {
	requireEditableTrip(userId, tripId);
	const v = new Validator();
	const text = v.requiredString(input.text, 'text', { max: 200 });
	const dueDate = v.date(input.dueDate, 'dueDate');
	if (!v.ok()) throw formFail(v);
	const inserted = db
		.insert(tripHomeTasks)
		.values({ tripId, text: text!, dueDate: dueDate ?? null })
		.returning()
		.get();
	logAudit(userId, 'create', 'trip_home_task', inserted.id, { tripId });
	return inserted;
}

export function toggleHomeTask(userId: number, tripId: number, taskId: number) {
	requireEditableTrip(userId, tripId);
	const existing = requireOwnedTripRow(tripHomeTasks, tripId, taskId, 'Task not found');
	const updated = db
		.update(tripHomeTasks)
		.set({ done: !existing.done })
		.where(eq(tripHomeTasks.id, taskId))
		.returning()
		.get();
	logAudit(userId, 'toggle', 'trip_home_task', taskId, { tripId, done: updated.done });
	return updated;
}

export function deleteHomeTask(userId: number, tripId: number, taskId: number) {
	requireEditableTrip(userId, tripId);
	requireOwnedTripRow(tripHomeTasks, tripId, taskId, 'Task not found');
	db.delete(tripHomeTasks).where(eq(tripHomeTasks.id, taskId)).run();
	logAudit(userId, 'delete', 'trip_home_task', taskId, { tripId });
}

export async function addHomeTaskAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const text = String(formData.get('text') || '');
	const dueDateRaw = formData.get('dueDate');
	const dueDate = typeof dueDateRaw === 'string' && dueDateRaw ? dueDateRaw : null;
	addHomeTask(user.id, tripId, { text, dueDate });
	throw redirect(303, `/trips/${tripId}`);
}
