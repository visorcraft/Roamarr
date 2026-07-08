import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	createEmergencyContact as addEmergencyContact,
	deleteEmergencyContact,
	listEmergencyContacts,
	updateEmergencyContact
} from '$lib/server/repositories/profileRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { emergencyContacts: listEmergencyContacts(u.id) };
};

export const actions: Actions = {
	addEmergencyContact: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		try {
			addEmergencyContact(u.id, {
				name: String(f.get('name') ?? ''),
				relationship: String(f.get('relationship') || '') || undefined,
				phone: String(f.get('phone') || '') || undefined,
				email: String(f.get('email') || '') || undefined,
				isPrimary: f.get('isPrimary') === 'on'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to add contact' });
		}
		setFlash(cookies, 'Emergency contact added.');
		throw redirect(303, '/profile/contacts');
	},
	updateEmergencyContact: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid contact' });
		try {
			updateEmergencyContact(id, u.id, {
				name: String(f.get('name') ?? ''),
				relationship: String(f.get('relationship') || '') || undefined,
				phone: String(f.get('phone') || '') || undefined,
				email: String(f.get('email') || '') || undefined,
				isPrimary: f.get('isPrimary') === 'on'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to update contact' });
		}
		setFlash(cookies, 'Emergency contact updated.');
		throw redirect(303, '/profile/contacts');
	},
	deleteEmergencyContact: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid contact' });
		try {
			deleteEmergencyContact(id, u.id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to delete contact' });
		}
		setFlash(cookies, 'Emergency contact deleted.');
		throw redirect(303, '/profile/contacts');
	}
};
