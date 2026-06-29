import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { listPasskeys, renamePasskey, deletePasskey, passkeyCount, isPasskeyAvailable } from '$lib/server/passkeys';
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
		renamePasskey(u.id, id, name);
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
		deletePasskey(u.id, id);
		setFlash(cookies, 'Passkey deleted.');
		throw redirect(303, '/profile/security/passkeys');
	}
};
