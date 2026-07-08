import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
import { DateTime } from 'luxon';
import { createReminder } from '$lib/server/repositories/remindersRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { timezone: u.timezone };
};

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'reminders:create');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const v = new Validator();
		const reminderType = String(f.get('reminderType') ?? 'trip');
		if (reminderType !== 'trip' && reminderType !== 'document') {
			v.addError('reminderType', 'Pick Trip or Document');
		}
		const name = v.requiredString(f.get('name'), 'name', { max: 200 });
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

		let refId = 0;
		const refIdRaw = f.get('refId');
		if (refIdRaw != null && String(refIdRaw) !== '') {
			const parsed = v.positiveId(refIdRaw, 'refId');
			if (parsed != null) refId = parsed;
		}

		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					reminderType,
					name: String(f.get('name') || '').trim(),
					description: String(f.get('description') || '').trim(),
					fireAt: String(f.get('fireAt') || ''),
					refId: String(f.get('refId') || '')
				}
			});
		}

		const reminder = createReminder({
			userId: u.id,
			kind: 'custom',
			refType: reminderType === 'trip' ? 'trip' : 'document',
			refId,
			fireAt: fireAtIso!,
			name,
			description
		});
		logAudit(u.id, 'reminder_create', 'reminder', reminder.id);
		throw redirect(303, '/profile/reminders');
	}
};
