import { redirect, type RequestEvent } from '@sveltejs/kit';
import { eq, asc } from 'drizzle-orm';
import { db } from './db';
import { tripHomeTasks } from './db/schema';
import { requireEditableTrip, requireOwnedTripRow } from './ownership';
import { logAudit } from './audit';
import { Validator, formFail } from './validation';
import { withTripAction } from './actions';
import { tripCrudFactory } from './crud';

const homeTaskCrud = tripCrudFactory({
	table: tripHomeTasks,
	auditEntity: 'trip_home_task',
	orderBy: [asc(tripHomeTasks.sortOrder), asc(tripHomeTasks.createdAt)],
	validate(input: { text: string; dueDate?: string | null }) {
		const v = new Validator();
		v.requiredString(input.text, 'text', { max: 200 });
		v.date(input.dueDate, 'dueDate');
		if (!v.ok()) throw formFail(v);
	},
	buildInsert(input, tripId) {
		return { tripId, text: input.text, dueDate: input.dueDate ?? null };
	}
});

export const listHomeTasks = homeTaskCrud.list;
export const addHomeTask = homeTaskCrud.add;
export const deleteHomeTask = homeTaskCrud.remove;

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

export async function addHomeTaskAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const text = String(formData.get('text') || '');
	const dueDateRaw = formData.get('dueDate');
	const dueDate = typeof dueDateRaw === 'string' && dueDateRaw ? dueDateRaw : null;
	addHomeTask(user.id, tripId, { text, dueDate });
	throw redirect(303, `/trips/${tripId}`);
}
