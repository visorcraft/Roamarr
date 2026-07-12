import { error, type Actions } from '@sveltejs/kit';
import { getSettings } from '$lib/server/settings';
import { actions as securityActions, load as securityLoad } from '../security/+page.server';
import type { PageServerLoad } from './$types';

function requireEnabled() {
	if (!getSettings().allowUserMcpClients) throw error(404, 'MCP Clients are disabled by the administrator.');
}

export const load: PageServerLoad = async (event) => {
	requireEnabled();
	return securityLoad(event as never);
};

export const actions: Actions = {
	createClient: async (event) => { requireEnabled(); return securityActions.createClient!(event); },
	deleteClient: async (event) => { requireEnabled(); return securityActions.deleteClient!(event); },
	revokeToken: async (event) => { requireEnabled(); return securityActions.revokeToken!(event); }
};
