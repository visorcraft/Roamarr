import { redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { invalidateSession } from '$lib/server/auth';

export const load: PageServerLoad = () => {
	throw redirect(308, '/');
};

export const actions: Actions = {
	default: async ({ cookies }) => {
		const t = cookies.get('session');
		if (t) invalidateSession(t);
		cookies.delete('session', { path: '/' });
		throw redirect(303, '/login');
	}
};
