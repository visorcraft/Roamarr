import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	listClients,
	createClient,
	deleteClient,
	listUserTokens,
	ALL_SCOPES,
	type Scope
} from '$lib/server/oauth';
import type { PageServerLoad } from './$types';

const SCOPE_DESCRIPTIONS: Record<string, string> = {
	'trips:read': 'View trips and itinerary',
	'trips:write': 'Create and update trips',
	'packing:write': 'Manage packing lists',
	'budgets:write': 'Manage budgets and expenses',
	'places:write': 'Mark visited places',
	'reminders:write': 'Create reminders',
	'profile:read': 'Read profile info'
};

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		clients: listClients(u.id),
		tokens: listUserTokens(u.id),
		allScopes: ALL_SCOPES,
		scopeDescriptions: SCOPE_DESCRIPTIONS
	};
};

export const actions: Actions = {
	create: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const clientName = String(f.get('clientName') ?? '').trim();
		const redirectUris = String(f.get('redirectUris') ?? '')
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		const scopes = f.getAll('scopes').map(String) as Scope[];
		const isPublic = f.get('isPublic') === 'on';

		if (!clientName) return fail(400, { error: 'Client name is required' });
		if (redirectUris.length === 0) return fail(400, { error: 'At least one redirect URI is required' });

		const result = createClient(u.id, { clientName, redirectUris, scopes, isPublic });
		setFlash(cookies, `Client created. Save the secret — it won't be shown again.`);
		return { clientSecret: result.plaintextSecret, clientId: result.client.clientId };
	},
	delete: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const clientId = String(f.get('clientId') ?? '');
		deleteClient(u.id, clientId);
		setFlash(cookies, 'Client and all its tokens deleted.');
		throw redirect(303, '/profile/security/connections');
	}
};

export { ALL_SCOPES };
