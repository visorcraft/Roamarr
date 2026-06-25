import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createTrip } from '../shared';
import { listTripTemplates, createTripFromTemplate } from '$lib/server/tripTemplates';
import { Validator } from '$lib/server/validation';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { tripTemplates: listTripTemplates(u.id) };
};

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
		const tags = v.optionalString(f.get('tags'), 'tags', { max: 200 });
		const defaultVisibility = v.enumValue(
			String(f.get('defaultVisibility') || 'private'),
			['private', 'groups', 'public'] as const,
			'defaultVisibility'
		);
		const templateIdRaw = f.get('templateId');
		const templateId =
			templateIdRaw && String(templateIdRaw).trim()
				? v.positiveId(templateIdRaw, 'templateId')
				: undefined;
		v.dateRange(startDate, endDate);

		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

		let t;
		if (templateId) {
			t = createTripFromTemplate(u.id, templateId, {
				name: name!,
				destination,
				startDate,
				endDate
			});
		} else {
			t = createTrip(u.id, {
				name: name!,
				destination,
				startDate,
				endDate,
				notes,
				tags,
				defaultVisibility
			});
		}
		throw redirect(303, `/trips/${t.id}`);
	}
};
