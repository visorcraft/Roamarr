import { createHash } from 'node:crypto';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { nowIso } from '$lib/server/tz';
import type { PageServerLoad } from './$types';

function tokenHash(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

export const load: PageServerLoad = ({ locals, cookies }) => {
	const u = requireUser(locals);
	const currentToken = cookies.get('session');
	const currentHash = currentToken ? tokenHash(currentToken) : null;
	const sessionRows = usersRepo.listSessionsForUser(u.id);
	const userSessions = sessionRows
		.filter((s) => s.expires_at >= nowIso())
		.map((s) => ({
			id: Number(s.id),
			createdAt: s.created_at,
			expiresAt: s.expires_at,
			lastIp: s.last_ip,
			userAgent: s.user_agent,
			current: s.token_hash === currentHash
		}));
	return { sessions: userSessions };
};

export const actions: Actions = {
	revokeSession: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid session' });
		const currentToken = cookies.get('session');
		const currentHash = currentToken ? tokenHash(currentToken) : null;
		usersRepo.deleteSessionByIdAndUserId(id, u.id);
		if (currentHash) {
			const removed = usersRepo.getSessionByTokenHash(currentHash);
			if (!removed) {
				cookies.delete('session', { path: '/' });
				throw redirect(303, '/login');
			}
		}
		setFlash(cookies, 'Session revoked.');
		throw redirect(303, '/profile/sessions');
	}
};
