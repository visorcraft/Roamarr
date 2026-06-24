import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createTrip } from '../shared';
import { Validator } from '$lib/server/validation';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();

		const name = v.requiredString(f.get('name'), 'name', { max: 200 });
		const destination = v.optionalString(f.get('destination'), 'destination', { max: 200 });
		const startDate = v.date(f.get('startDate'), 'startDate');
		const endDate = v.date(f.get('endDate'), 'endDate');
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 5000 });
		const defaultVisibility = v.enumValue(
			String(f.get('defaultVisibility') || 'private'),
			['private', 'groups', 'public'] as const,
			'defaultVisibility'
		);
		v.dateRange(startDate, endDate);

		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

		const t = createTrip(u.id, {
			name: name!,
			destination,
			startDate,
			endDate,
			notes,
			defaultVisibility
		});
		throw redirect(303, `/trips/${t.id}`);
	}
};
