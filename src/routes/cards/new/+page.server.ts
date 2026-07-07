import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createCard } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

const allowedNetworks = new Set(['visa', 'mc', 'amex', 'disc', 'other']);

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const nickname = String(f.get('nickname') || '').trim();
		const network = String(f.get('network') || '').trim();
		if (!nickname) return fail(400, { error: 'Nickname is required' });
		if (!allowedNetworks.has(network)) return fail(400, { error: 'Unsupported network' });
		const card = createCard(u.id, {
			nickname,
			network,
			last4: String(f.get('last4') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		logAudit(u.id, 'card_create', 'card', card.id);
		throw redirect(303, '/cards');
	}
};
