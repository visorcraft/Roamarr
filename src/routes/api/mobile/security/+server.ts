import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword, invalidateAllSessions, requireUser, verifyPassword } from '$lib/server/auth';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { deletePasskey, listPasskeys, passkeyCount, renamePasskey } from '$lib/server/passkeys';
import { disableTwoFactor, enableTwoFactor, generateSecret, getTwoFactorState, regenerateBackupCodes, verifyTwoFactor } from '$lib/server/twoFactor';
import { deleteClient, listClients, listUserTokens, revokeTokenByIdForUser } from '$lib/server/oauth';
import { logAudit } from '$lib/server/audit';
import { nowIso } from '$lib/server/tz';
import { _changeEmail } from '$lib/server/profileActions';

export const GET: RequestHandler = ({ locals }) => {
	const user = requireUser(locals), setup = generateSecret(user.email);
	return json({
		twoFactor: getTwoFactorState(user.id), setup,
		passkeys: listPasskeys(user.id), clients: listClients(user.id), tokens: listUserTokens(user.id),
		sessions: usersRepo.listSessionsForUser(user.id).filter((session) => session.expires_at >= nowIso()).map((session) => ({ id: Number(session.id), createdAt: session.created_at, expiresAt: session.expires_at, lastIp: session.last_ip, userAgent: session.user_agent }))
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals), body = await request.json().catch(() => { throw error(400, 'Invalid JSON'); }) as Record<string, unknown>, action = String(body.action ?? '');
	if (action === 'password') {
		if (!(await verifyPassword(user.passwordHash, String(body.oldPassword ?? '')))) throw error(401, 'Current password is incorrect');
		const next = String(body.newPassword ?? ''); if (next !== String(body.confirmPassword ?? '')) throw error(400, 'New passwords do not match');
		usersRepo.updateUser(user.id, { password_hash: await hashPassword(next) }); invalidateAllSessions(user.id); logAudit(user.id, 'password_change', 'user', user.id); return json({ ok: true });
	}
	if (action === 'email') { await _changeEmail(user.id, { currentPassword: String(body.currentPassword ?? ''), newEmail: String(body.newEmail ?? ''), confirmEmail: String(body.confirmEmail ?? '') }); return json({ ok: true }); }
	if (action === 'enable-2fa') { const result = enableTwoFactor(user.id, String(body.secret ?? ''), String(body.token ?? '')); if (!result.ok) throw error(400, result.error); return json(result); }
	if (action === 'disable-2fa') { if (!(await verifyPassword(user.passwordHash, String(body.password ?? ''))) || !verifyTwoFactor(user.id, String(body.token ?? ''))) throw error(401, 'Invalid password or code'); disableTwoFactor(user.id); return json({ ok: true }); }
	if (action === 'regenerate-codes') { const result = regenerateBackupCodes(user.id, String(body.token ?? '')); if (!result.ok) throw error(400, result.error); return json(result); }
	if (action === 'delete-client') { if (!deleteClient(user.id, String(body.clientId ?? ''))) throw error(404, 'Client not found'); return new Response(null, { status: 204 }); }
	const id = Number(body.id); if (!Number.isSafeInteger(id) || id < 1) throw error(400, 'Invalid id');
	if (action === 'revoke-session') usersRepo.deleteSessionByIdAndUserId(id, user.id);
	else if (action === 'rename-passkey') { if (!renamePasskey(user.id, id, String(body.name ?? ''))) throw error(404, 'Passkey not found'); }
	else if (action === 'delete-passkey') { if (passkeyCount(user.id) <= 1 && !user.passwordHash) throw error(400, 'Cannot delete your last credential'); if (!deletePasskey(user.id, id)) throw error(404, 'Passkey not found'); }
	else if (action === 'revoke-token') { if (!revokeTokenByIdForUser(user.id, id)) throw error(404, 'Token not found'); }
	else throw error(400, 'Unknown action');
	return new Response(null, { status: 204 });
};
