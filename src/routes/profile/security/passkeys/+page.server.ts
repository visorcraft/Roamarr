import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	listPasskeys,
	renamePasskey,
	deletePasskey,
	passkeyCount,
	isPasskeyAvailable,
	MAX_PASSKEY_NAME_LENGTH
} from '$lib/server/passkeys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		passkeys: listPasskeys(u.id),
		available: isPasskeyAvailable()
	};
};

export const actions: Actions = {
	rename: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		const name = String(f.get('name') || '').trim();
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid passkey' });
		if (!name) return fail(400, { error: 'Name is required' });
		if (name.length > MAX_PASSKEY_NAME_LENGTH) return fail(400, { error: 'Name is too long' });
		const ok = renamePasskey(u.id, id, name);
		if (!ok) return fail(400, { error: 'Passkey not found' });
		setFlash(cookies, 'Passkey renamed.');
		throw redirect(303, '/profile/security/passkeys');
	},
	delete: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid passkey' });
		const count = passkeyCount(u.id);
		const hasPassword = Boolean(u.passwordHash);
		if (count <= 1 && !hasPassword) {
			return fail(400, { error: 'Cannot delete your last credential without a password on the account.' });
		}
		const ok = deletePasskey(u.id, id);
		if (!ok) return fail(400, { error: 'Passkey not found' });
		setFlash(cookies, 'Passkey deleted.');
		throw redirect(303, '/profile/security/passkeys');
	}
};
