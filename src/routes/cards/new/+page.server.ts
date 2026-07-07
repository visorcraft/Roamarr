import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createCard } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import { Validator, sanitizeLast4 } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

const allowedNetworks = ['visa', 'mc', 'amex', 'disc', 'other'] as const;

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const nickname = v.requiredString(f.get('nickname'), 'nickname', { max: 200 });
		const network = v.enumValue(f.get('network'), allowedNetworks, 'network');
		const last4Raw = v.optionalString(f.get('last4'), 'last4');
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 2000 });
		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					nickname: String(f.get('nickname') || '').trim(),
					network: String(f.get('network') || ''),
					last4: String(f.get('last4') || ''),
					notes: String(f.get('notes') || '').trim()
				}
			});
		}
		const card = createCard(u.id, {
			nickname: nickname!,
			network: network!,
			last4: sanitizeLast4(last4Raw),
			notes
		});
		logAudit(u.id, 'card_create', 'card', card.id);
		throw redirect(303, '/cards');
	}
};
