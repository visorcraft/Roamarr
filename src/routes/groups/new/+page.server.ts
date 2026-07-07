import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createGroup } from '$lib/server/repositories/tripsRepo';
import { logAudit } from '$lib/server/audit';
import { checkRateLimit } from '$lib/server/rateLimit';
import { Validator } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);

		const limit = checkRateLimit(getClientAddress(), 'groups:create');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const rawName = String(f.get('name') ?? '');
		const v = new Validator();
		const name = v.requiredString(rawName, 'name', { max: 200 });
		if (!v.ok()) {
			return fail(400, { error: v.failMessage(), errors: v.errors, values: { name: rawName } });
		}
		const group = createGroup({ ownerId: u.id, name: name! });
		logAudit(u.id, 'group_create', 'group', group.id);
		throw redirect(303, '/groups');
	}
};
