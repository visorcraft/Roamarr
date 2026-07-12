import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { listUsers } from '$lib/server/repositories/usersRepo';
import { getAdminStats, listAuditLogs } from '$lib/server/repositories/auditRepo';
import { adminCreateUser, adminDeleteUser, adminSendPasswordReset, adminUpdateUser } from '$lib/server/users';

const publicUser = (user: ReturnType<typeof listUsers>[number]) => ({
	id: Number(user.id), email: user.email, displayName: user.display_name ?? '', role: user.role,
	disabled: user.disabled, mustResetPassword: user.must_reset_password, createdAt: user.created_at
});

export const GET: RequestHandler = ({ locals }) => {
	requireAdmin(locals);
	const audit = listAuditLogs({ limit: 50 });
	return json({ users: listUsers().map(publicUser), stats: getAdminStats(), audit: audit.logs, auditTotal: audit.total });
};

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const admin = requireAdmin(locals);
	const body = await request.json().catch(() => { throw error(400, 'Invalid JSON'); }) as Record<string, unknown>;
	const action = String(body.action ?? '');
	if (action === 'create') {
		const created = await adminCreateUser(admin.id, {
			displayName: String(body.displayName ?? ''), email: String(body.email ?? ''), role: body.role === 'admin' ? 'admin' : 'user'
		});
		return json({ user: publicUser(created.user), temporaryPassword: created.temporaryPassword }, { status: 201 });
	}
	const userId = Number(body.userId);
	if (!Number.isSafeInteger(userId) || userId < 1) throw error(400, 'userId must be a positive integer');
	if (action === 'update') {
		await adminUpdateUser(admin.id, userId, {
			displayName: String(body.displayName ?? ''), email: String(body.email ?? ''), role: body.role === 'admin' ? 'admin' : 'user',
			disabled: body.disabled === true, mustResetPassword: body.mustResetPassword === true
		});
		return json({ ok: true });
	}
	if (action === 'delete') { await adminDeleteUser(admin.id, userId); return new Response(null, { status: 204 }); }
	if (action === 'reset') { await adminSendPasswordReset(userId, url.origin); return json({ ok: true }); }
	throw error(400, 'Unknown action');
};
