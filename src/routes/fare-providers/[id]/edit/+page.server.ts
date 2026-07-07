import { error, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { getFareProviderByIdAndUser, registry, updateProvider } from '$lib/server/fareproviders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	const provider = getFareProviderByIdAndUser(id, u.id);
	if (!provider) throw error(404, 'Not found');
	return {
		provider: {
			id: provider.id,
			providerKey: provider.providerKey,
			label: provider.label,
			enabled: provider.enabled,
			hasKey: !!provider.apiKey
		},
		providers: Object.values(registry).map((p) => ({ key: p.key, label: p.label }))
	};
};

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		updateProvider(
			u.id,
			id,
			String(f.get('label') || ''),
			String(f.get('apiKey') || ''),
			f.get('enabled') === 'on'
		);
		throw redirect(303, '/fare-providers');
	}
};
