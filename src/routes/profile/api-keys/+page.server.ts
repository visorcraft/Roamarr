import { fail, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	createApiKey,
	getApiKeyScopes,
	listApiKeys,
	renameApiKey,
	revokeApiKey,
	MAX_API_KEY_NAME_LENGTH
} from '$lib/server/apiKeys';
import type { Scope } from '$lib/server/oauth';
import { SCOPE_DESCRIPTIONS } from '$lib/oauthScopes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const u = requireUser(locals);
	return {
		keys: listApiKeys(u.id),
		grantableScopes: getApiKeyScopes(),
		scopeDescriptions: SCOPE_DESCRIPTIONS
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		const scopes = f.getAll('scopes').map(String) as Scope[];
		const expiryRaw = String(f.get('expiresAt') ?? '').trim();
		// Date inputs carry no time component; expire at end of the chosen day (UTC).
		const expiresAt = expiryRaw ? new Date(`${expiryRaw}T23:59:59Z`).toISOString() : null;

		if (!name) return fail(400, { error: 'Key name is required.' });
		if (name.length > MAX_API_KEY_NAME_LENGTH) return fail(400, { error: 'Key name is too long.' });
		if (scopes.length === 0) return fail(400, { error: 'Select at least one scope.' });

		try {
			const { token } = createApiKey(u.id, { name, scopes, expiresAt });
			// The plaintext token is returned exactly once; only its hash is stored.
			return { createdToken: token, createdName: name };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to create API key' });
		}
	},

	rename: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		const name = String(f.get('name') ?? '').trim();
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid API key.' });
		if (!name || name.length > MAX_API_KEY_NAME_LENGTH) return fail(400, { error: 'Invalid name.' });
		if (!renameApiKey(u.id, id, name)) return fail(400, { error: 'API key not found.' });
		setFlash(cookies, 'API key renamed.');
	},

	revoke: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid API key.' });
		if (!revokeApiKey(u.id, id)) return fail(400, { error: 'API key not found or already revoked.' });
		setFlash(cookies, 'API key revoked.');
	}
};
