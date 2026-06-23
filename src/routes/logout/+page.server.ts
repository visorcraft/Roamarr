import { redirect, type Actions } from '@sveltejs/kit';
import { invalidateSession } from '$lib/server/auth';

export const actions: Actions = {
	default: async ({ cookies }) => {
		const t = cookies.get('session');
		if (t) invalidateSession(t);
		cookies.delete('session', { path: '/' });
		throw redirect(303, '/login');
	}
};
