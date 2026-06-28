import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	listHomeTasksForTrip,
	createHomeTask as repoCreateHomeTask,
	updateHomeTask as repoUpdateHomeTask,
	deleteHomeTask as repoDeleteHomeTask,
	getHomeTaskById
} from './repositories/tripMiscRepo';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';

export function listHomeTasks(tripId: number) {
	return listHomeTasksForTrip(tripId);
}

export function addHomeTask(
	userId: number,
	tripId: number,
	input: { text: string; dueDate?: string | null }
) {
	requireEditableTrip(userId, tripId);
	const v = new Validator();
	v.requiredString(input.text, 'text', { max: 200 });
	v.date(input.dueDate, 'dueDate');
	if (!v.ok()) throw error(400, v.failMessage());

	const task = repoCreateHomeTask({ tripId, text: input.text, dueDate: input.dueDate ?? null });
	logAudit(userId, 'create', 'trip_home_task', task.id, { tripId });
	return task;
}

export function toggleHomeTask(userId: number, tripId: number, taskId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getHomeTaskById(taskId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Task not found');
	const updated = repoUpdateHomeTask(taskId, { done: !existing.done });
	if (!updated) throw error(404, 'Task not found');
	logAudit(userId, 'toggle', 'trip_home_task', taskId, { tripId, done: updated.done });
	return updated;
}

export function deleteHomeTask(userId: number, tripId: number, taskId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getHomeTaskById(taskId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Task not found');
	repoDeleteHomeTask(taskId);
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

export async function toggleHomeTaskAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const taskIdResult = positiveIdFromForm(formData.get('taskId'), 'taskId');
	if (!taskIdResult.ok) return fail(400, { error: taskIdResult.error });
	toggleHomeTask(user.id, tripId, taskIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteHomeTaskAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const taskIdResult = positiveIdFromForm(formData.get('taskId'), 'taskId');
	if (!taskIdResult.ok) return fail(400, { error: taskIdResult.error });
	deleteHomeTask(user.id, tripId, taskIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
