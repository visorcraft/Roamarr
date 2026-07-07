import { requireAdmin } from '$lib/server/auth';
import { registry } from '$lib/server/fareproviders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {
		providers: Object.values(registry).map((p) => ({ key: p.key, label: p.label }))
	};
};
