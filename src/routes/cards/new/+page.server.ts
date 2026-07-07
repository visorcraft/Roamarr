import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createCard } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const card = createCard(u.id, {
			nickname: String(f.get('nickname') || ''),
			network: String(f.get('network') || ''),
			last4: String(f.get('last4') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		logAudit(u.id, 'card_create', 'card', card.id);
		throw redirect(303, '/cards');
	}
};
