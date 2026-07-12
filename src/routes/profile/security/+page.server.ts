import { fail, redirect, type Actions } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { requireUser, verifyPassword } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	getTwoFactorState,
	enableTwoFactor,
	disableTwoFactor,
	regenerateBackupCodes,
	verifyTwoFactor,
	generateSecret
} from '$lib/server/twoFactor';
import { _updatePassword } from '$lib/server/profileActions';
import {
	listPasskeys,
	renamePasskey,
	deletePasskey,
	passkeyCount,
	isPasskeyAvailable,
	MAX_PASSKEY_NAME_LENGTH
} from '$lib/server/passkeys';
import {
	listClients,
	createClient,
	deleteClient,
	listUserTokens,
	revokeTokenByIdForUser,
	ALL_SCOPES,
	type Scope
} from '$lib/server/oauth';
import { SCOPE_DESCRIPTIONS } from '$lib/oauthScopes';
import type { PageServerLoad } from './$types';

function securityUrl(tab: string) {
	return `/profile/security?tab=${tab}`;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (url.searchParams.get('tab') === 'api-clients') throw redirect(303, '/profile/mcp-clients');
	const u = requireUser(locals);
	const state = getTwoFactorState(u.id);
	const setup = generateSecret(u.email);
	const qr = await QRCode.toDataURL(setup.otpauthUri, { width: 200, margin: 1 });

	return {
		state,
		setup: { secret: setup.secret, otpauthUri: setup.otpauthUri, qr },
		passkeys: listPasskeys(u.id),
		available: isPasskeyAvailable(),
		clients: listClients(u.id),
		tokens: listUserTokens(u.id),
		allScopes: ALL_SCOPES,
		scopeDescriptions: SCOPE_DESCRIPTIONS,
		mcpUrl: `${url.origin}/mcp`
	};
};

export const actions: Actions = {
	updatePassword: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const oldPassword = String(f.get('oldPassword') ?? '');
		const newPassword = String(f.get('newPassword') ?? '');
		const confirmPassword = String(f.get('confirmPassword') ?? '');
		const token = cookies.get('session');
		if (!token) throw redirect(302, '/login');
		try {
			await _updatePassword(u.id, token, { oldPassword, newPassword, confirmPassword });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Password update failed' });
		}
		setFlash(cookies, 'Password changed.');
		throw redirect(303, securityUrl('password'));
	},

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
		return { backupCodes: result.backupCodes };
	},

	disable: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const password = String(f.get('password') ?? '');
		const totpCode = String(f.get('totpCode') ?? '').trim();
		if (!(await verifyPassword(u.passwordHash, password))) {
			return fail(401, { error: 'Incorrect password.' });
		}
		if (!verifyTwoFactor(u.id, totpCode)) {
			return fail(401, { error: 'Invalid TOTP code or backup code.' });
		}
		disableTwoFactor(u.id);
		setFlash(cookies, 'Two-factor authentication disabled.');
		throw redirect(303, securityUrl('2fa'));
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
		return { backupCodes: result.backupCodes };
	},

	renamePasskey: async ({ request, locals, cookies }) => {
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
		throw redirect(303, securityUrl('passkeys'));
	},

	deletePasskey: async ({ request, locals, cookies }) => {
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
		throw redirect(303, securityUrl('passkeys'));
	},

	createClient: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const clientName = String(f.get('clientName') ?? '').trim();
		const redirectUris = String(f.get('redirectUris') ?? '')
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		const scopes = f.getAll('scopes').map(String) as Scope[];
		const isPublic = f.get('isPublic') === 'on';

		if (!clientName) return fail(400, { error: 'Client name is required' });
		if (redirectUris.length === 0) return fail(400, { error: 'At least one redirect URI is required' });

		try {
			const result = createClient(u.id, { clientName, redirectUris, scopes, isPublic });
			setFlash(cookies, `Client created. Save the secret — it won't be shown again.`);
			return { clientSecret: result.plaintextSecret, clientId: result.client.clientId };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to create client' });
		}
	},

	deleteClient: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const clientId = String(f.get('clientId') ?? '');
		deleteClient(u.id, clientId);
		setFlash(cookies, 'Client and all its tokens deleted.');
		throw redirect(303, securityUrl('api-clients'));
	},

	revokeToken: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const tokenId = Number(f.get('tokenId') ?? '');
		if (!Number.isFinite(tokenId) || tokenId <= 0) return fail(400, { error: 'Token ID is required' });
		const revoked = revokeTokenByIdForUser(u.id, tokenId);
		if (!revoked) return fail(400, { error: 'Token not found or not owned by you' });
		setFlash(cookies, 'Token revoked.');
		throw redirect(303, securityUrl('api-clients'));
	}
};
