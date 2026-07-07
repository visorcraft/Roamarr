import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { createProvider, registry } from '$lib/server/fareproviders';
import { logAudit } from '$lib/server/audit';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {
		providers: Object.values(registry).map((p) => ({ key: p.key, label: p.label }))
	};
};

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const admin = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'fare-providers:create');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const provider = createProvider(
			admin.id,
			String(f.get('providerKey')),
			String(f.get('label') || ''),
			String(f.get('apiKey') || ''),
			f.get('enabled') === 'on'
		);
		logAudit(admin.id, 'fare_provider_create', 'fare_provider', provider.id);
		throw redirect(303, '/fare-providers');
	}
};
