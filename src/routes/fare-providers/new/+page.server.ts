import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createProvider, registry } from '$lib/server/fareproviders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {
		providers: Object.values(registry).map((p) => ({ key: p.key, label: p.label }))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		createProvider(
			u.id,
			String(f.get('providerKey')),
			String(f.get('label') || ''),
			String(f.get('apiKey') || ''),
			f.get('enabled') === 'on'
		);
		throw redirect(303, '/fare-providers');
	}
};
