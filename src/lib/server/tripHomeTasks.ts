import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { tripHomeTasks } from './db/schema';
import { requireUser } from './auth';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { parseTripId } from './params';
import { Validator } from './validation';

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
	if (!v.ok()) throw error(400, v.failMessage());
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
	const existing = db
		.select()
		.from(tripHomeTasks)
		.where(and(eq(tripHomeTasks.id, taskId), eq(tripHomeTasks.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Task not found');
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
	const result = db
		.delete(tripHomeTasks)
		.where(and(eq(tripHomeTasks.id, taskId), eq(tripHomeTasks.tripId, tripId)))
		.run();
	if (result.changes === 0) throw error(404, 'Task not found');
	logAudit(userId, 'delete', 'trip_home_task', taskId, { tripId });
}

export async function addHomeTaskAction(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = parseTripId(event.params);
	const f = await event.request.formData();
	const text = String(f.get('text') || '');
	const dueDateRaw = f.get('dueDate');
	const dueDate = typeof dueDateRaw === 'string' && dueDateRaw ? dueDateRaw : null;
	addHomeTask(u.id, tripId, { text, dueDate });
	throw redirect(303, `/trips/${tripId}`);
}
