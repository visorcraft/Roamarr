import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSession, sessionCookieOptions } from '$lib/server/auth';
import { getInvitationByToken, claimInvitation } from '$lib/server/tripSharing';
import { getUserByEmail } from '$lib/server/repositories/usersRepo';
import { registerUser } from '$lib/server/users';
import { checkRateLimit } from '$lib/server/rateLimit';

export const load: PageServerLoad = ({ params, locals }) => {
	const invitation = getInvitationByToken(params.token);
	if (!invitation) throw error(404, 'Invitation not found or expired');
	return { email: invitation.email, signedIn: Boolean(locals.user), existingUser: Boolean(getUserByEmail(invitation.email)), loginHref: `/login?next=${encodeURIComponent(`/invite/${params.token}`)}` };
};

export const actions: Actions = {
	default: async ({ params, locals, request, cookies, getClientAddress }) => {
		const invitation = getInvitationByToken(params.token);
		if (!invitation) return fail(404, { error: 'Invitation not found or expired.' });
		if (locals.user) throw redirect(303, `/trips/${claimInvitation(params.token, locals.user.id)}`);
		if (getUserByEmail(invitation.email)) throw redirect(303, `/login?next=${encodeURIComponent(`/invite/${params.token}`)}`);
		const limit = checkRateLimit(getClientAddress(), 'register');
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Try again later.' });
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		if (password !== String(form.get('confirmPassword') ?? '')) return fail(400, { error: 'Passwords do not match.' });
		let createdUserId: number | null = null;
		try {
			const user = await registerUser(invitation.email, password, String(form.get('displayName') ?? ''));
			createdUserId = user.id;
			const tripId = claimInvitation(params.token, user.id);
			cookies.set('session', createSession(user.id, getClientAddress(), request.headers.get('user-agent') ?? undefined), sessionCookieOptions());
			throw redirect(303, `/trips/${tripId}`);
		} catch (cause) {
			if (cause && typeof cause === 'object' && 'status' in cause && Number(cause.status) >= 300 && Number(cause.status) < 400) throw cause;
			if (createdUserId) {
				const { deleteUser } = await import('$lib/server/repositories/usersRepo');
				deleteUser(createdUserId);
			}
			const message = cause && typeof cause === 'object' && 'body' in cause && cause.body && typeof cause.body === 'object' && 'message' in cause.body
				? String(cause.body.message)
				: cause instanceof Error ? cause.message : 'Could not create account.';
			return fail(400, { error: message });
		}
	}
};
