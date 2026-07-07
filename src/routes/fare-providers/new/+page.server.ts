import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { createProvider, registry } from '$lib/server/fareproviders';
import { logAudit } from '$lib/server/audit';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { PageServerLoad } from './$types';

function parseCreate(formData: FormData) {
	const providerKey = String(formData.get('providerKey'));
	const label = String(formData.get('label') || '');
	const apiKey = String(formData.get('apiKey') || '');
	const enabled = formData.get('enabled') === 'on';
	return { providerKey, label, apiKey, enabled };
}

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
		const parsed = parseCreate(f);
		try {
			const provider = createProvider(
				admin.id,
				parsed.providerKey,
				parsed.label,
				parsed.apiKey,
				parsed.enabled
			);
			logAudit(admin.id, 'fare_provider_create', 'fare_provider', provider.id);
			throw redirect(303, '/fare-providers');
		} catch (e) {
			if (e instanceof Error && e.message.includes('Label is required')) {
				return fail(400, {
					error: e.message,
					values: { providerKey: parsed.providerKey, label: parsed.label, enabled: parsed.enabled }
				});
			}
			throw e;
		}
	}
};
