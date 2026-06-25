import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	listLoyaltyPrograms,
	addLoyaltyProgram,
	updateLoyaltyProgram,
	deleteLoyaltyProgram
} from '$lib/server/loyaltyPrograms';
import { positiveIdFromForm } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { programs: listLoyaltyPrograms(u.id) };
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		addLoyaltyProgram(u.id, {
			programName: String(f.get('programName')),
			membershipNumber: String(f.get('membershipNumber') || ''),
			balance: f.get('balance') ? Number(f.get('balance')) : null,
			notes: String(f.get('notes') || '')
		});
		throw redirect(303, '/profile/loyalty');
	},
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		updateLoyaltyProgram(u.id, idResult.value, {
			programName: String(f.get('programName')),
			membershipNumber: String(f.get('membershipNumber') || '') || null,
			balance: f.get('balance') ? Number(f.get('balance')) : null,
			notes: String(f.get('notes') || '') || null
		});
		throw redirect(303, '/profile/loyalty');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		deleteLoyaltyProgram(u.id, idResult.value);
		throw redirect(303, '/profile/loyalty');
	}
};
