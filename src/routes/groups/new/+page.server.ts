import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createGroup } from '$lib/server/repositories/tripsRepo';
import { logAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		const group = createGroup({ ownerId: u.id, name });
		logAudit(u.id, 'group_create', 'group', group.id);
		throw redirect(303, '/groups');
	}
};
