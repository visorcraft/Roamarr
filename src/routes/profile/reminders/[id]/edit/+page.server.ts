import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
import { DateTime } from 'luxon';
import {
	getReminderById,
	updateReminderUserFields
} from '$lib/server/repositories/remindersRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { listTravelDocuments } from '$lib/server/repositories/profileRepo';
import type { PageServerLoad } from './$types';

function parseId(params: { id?: string }): number {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	return id;
}

function resolveLinkedName(refType: string, refId: number, userId: number): string | null {
	if (!refId) return null;
	if (refType === 'trip') {
		const t = tripsRepo.listTripsForUser(userId).find((x) => x.id === refId);
		return t?.name ?? null;
	}
	if (refType === 'document') {
		const d = listTravelDocuments(userId).find((x) => x.id === refId);
		return d ? d.type : null;
	}
	return null;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const u = requireUser(locals);
	const id = parseId(params);
	const reminder = getReminderById(id);
	if (!reminder || reminder.userId !== u.id) throw error(404, 'Not found');
	return {
		timezone: u.timezone,
		reminder,
		linkedName: resolveLinkedName(reminder.refType, reminder.refId, u.id)
	};
};

export const actions: Actions = {
	update: async ({ params, request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		const existing = getReminderById(id);
		if (!existing || existing.userId !== u.id) throw error(404, 'Not found');

		const limit = checkRateLimit(getClientAddress(), 'reminders:update');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const v = new Validator();
		// Name is optional on edit — system-generated reminders may stay unnamed.
		const name = v.optionalString(f.get('name'), 'name', { max: 200 });
		const description = v.optionalString(f.get('description'), 'description', { max: 2000 });

		const fireAtLocal = String(f.get('fireAt') ?? '').trim();
		let fireAtIso: string | undefined;
		if (!fireAtLocal) {
			v.addError('fireAt', 'fireAt is required');
		} else {
			const dt = DateTime.fromISO(fireAtLocal, { zone: u.timezone });
			if (!dt.isValid) {
				v.addError('fireAt', 'fireAt must be a valid date and time');
			} else {
				fireAtIso = dt.toUTC().toISO()!;
			}
		}

		const isSystem = existing.kind !== 'custom';
		let refId = existing.refId;
		const refIdRaw = f.get('refId');
		if (!isSystem) {
			if (refIdRaw == null || String(refIdRaw) === '') {
				refId = 0;
			} else {
				const parsed = v.positiveId(refIdRaw, 'refId');
				if (parsed != null) refId = parsed;
			}
		}

		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					name: String(f.get('name') || '').trim(),
					description: String(f.get('description') || '').trim(),
					fireAt: String(f.get('fireAt') || ''),
					refId: String(f.get('refId') || '')
				}
			});
		}

		// Safe update: never touches status / sent_at / attempts, so a fired
		// reminder cannot re-arm through edits. The scheduler solely manages
		// those fields; the only way to re-fire is delete + recreate.
		updateReminderUserFields(id, {
			name,
			description,
			fireAt: fireAtIso!,
			refId
		});
		logAudit(u.id, 'reminder_update', 'reminder', id);
		throw redirect(303, '/profile/reminders');
	}
};
