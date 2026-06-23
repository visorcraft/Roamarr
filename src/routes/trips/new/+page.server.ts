import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createTrip } from '../shared';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const t = createTrip(u.id, {
			name: String(f.get('name') ?? 'Untitled'),
			destination: String(f.get('destination') ?? ''),
			startDate: String(f.get('startDate') ?? ''),
			endDate: String(f.get('endDate') ?? ''),
			notes: String(f.get('notes') ?? ''),
			defaultVisibility: String(f.get('defaultVisibility') ?? 'private')
		});
		throw redirect(303, `/trips/${t.id}`);
	}
};
