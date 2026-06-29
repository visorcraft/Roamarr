import { fail, redirect, type Actions } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	generateSecret,
	verifyTotp,
	getTwoFactorState,
	enableTwoFactor,
	disableTwoFactor,
	regenerateBackupCodes
} from '$lib/server/twoFactor';
import { verifyPassword } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const u = requireUser(locals);
	const state = getTwoFactorState(u.id);
	const setupSecret = url.searchParams.get('setup');
	if (setupSecret && !state.enabled) {
		const setup = generateSecret(u.email);
		const qr = await QRCode.toDataURL(setup.otpauthUri, { width: 200, margin: 1 });
		return { state, setup: { secret: setup.secret, otpauthUri: setup.otpauthUri, qr } };
	}
	return { state };
};

export const actions: Actions = {
	enable: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const secret = String(f.get('secret') ?? '');
		const token = String(f.get('token') ?? '').trim();
		if (!secret || !/^\d{6}$/.test(token)) {
			return fail(400, { error: 'Enter the 6-digit code from your authenticator app.' });
		}
		const result = enableTwoFactor(u.id, secret, token);
		if (!result.ok) return fail(400, { error: result.error });
		setFlash(cookies, 'Two-factor authentication enabled. Save your backup codes.');
		throw redirect(303, '/profile/security?codes=1');
	},
	disable: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const password = String(f.get('password') ?? '');
		if (!(await verifyPassword(u.passwordHash, password))) {
			return fail(401, { error: 'Incorrect password.' });
		}
		disableTwoFactor(u.id);
		setFlash(cookies, 'Two-factor authentication disabled.');
		throw redirect(303, '/profile/security');
	},
	regenerate: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const token = String(f.get('token') ?? '').trim();
		if (!/^\d{6}$/.test(token)) {
			return fail(400, { error: 'Enter your current 6-digit code to regenerate backup codes.' });
		}
		const result = regenerateBackupCodes(u.id, token);
		if (!result.ok) return fail(400, { error: result.error });
		setFlash(cookies, 'Backup codes regenerated. Save the new codes.');
		throw redirect(303, '/profile/security?codes=1');
	}
};

export { verifyTotp };
