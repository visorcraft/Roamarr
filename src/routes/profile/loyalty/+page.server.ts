import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	listLoyaltyPrograms,
	createLoyaltyProgram,
	updateLoyaltyProgram,
	deleteLoyaltyProgram
} from '$lib/server/repositories/profileRepo';
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
		createLoyaltyProgram(u.id, {
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
		updateLoyaltyProgram(idResult.value, u.id, {
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
		deleteLoyaltyProgram(idResult.value, u.id);
		throw redirect(303, '/profile/loyalty');
	}
};
