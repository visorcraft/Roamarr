import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getFareProviderByIdAndUser, registry, updateProvider } from '$lib/server/fareproviders';
import { logAudit } from '$lib/server/audit';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	const provider = getFareProviderByIdAndUser(id, admin.id);
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
	update: async ({ params, request, locals, getClientAddress }) => {
		const admin = requireAdmin(locals);
		const id = Number(params.id);
		if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
		const limit = checkRateLimit(getClientAddress(), 'fare-providers:update');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		updateProvider(
			admin.id,
			id,
			String(f.get('label') || ''),
			String(f.get('apiKey') || ''),
			f.get('enabled') === 'on'
		);
		logAudit(admin.id, 'fare_provider_update', 'fare_provider', id);
		throw redirect(303, '/fare-providers');
	}
};
